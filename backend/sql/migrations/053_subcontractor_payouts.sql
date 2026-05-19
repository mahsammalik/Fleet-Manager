-- Parent settlement rows: fleet pays subcontractor company per period (aggregates driver_payouts).
BEGIN;

CREATE TABLE IF NOT EXISTS subcontractor_payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    subcontractor_id UUID NOT NULL REFERENCES subcontractors(id) ON DELETE CASCADE,
    payment_period_start DATE NOT NULL,
    payment_period_end DATE NOT NULL,
    total_fleet_commission NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total_subcontractor_commission NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total_driver_net_payout NUMERIC(12, 2) NOT NULL DEFAULT 0,
    driver_payout_count INTEGER NOT NULL DEFAULT 0,
    rent_charge_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    rent_charge_status VARCHAR(50),
    amount_payable NUMERIC(12, 2) NOT NULL DEFAULT 0,
    payment_status VARCHAR(50) NOT NULL DEFAULT 'pending'
        CHECK (payment_status IN ('pending', 'processing', 'approved', 'paid', 'failed', 'hold')),
    payment_date DATE,
    payment_method VARCHAR(50),
    transaction_ref VARCHAR(100),
    notes TEXT,
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_subcontractor_payout_period UNIQUE (
        organization_id, subcontractor_id, payment_period_start, payment_period_end
    )
);

CREATE INDEX IF NOT EXISTS idx_sub_payouts_org_period
    ON subcontractor_payouts(organization_id, payment_period_start, payment_period_end);
CREATE INDEX IF NOT EXISTS idx_sub_payouts_org_status
    ON subcontractor_payouts(organization_id, payment_status);
CREATE INDEX IF NOT EXISTS idx_sub_payouts_subcontractor
    ON subcontractor_payouts(subcontractor_id);

ALTER TABLE driver_payouts
    ADD COLUMN IF NOT EXISTS subcontractor_payout_id UUID REFERENCES subcontractor_payouts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_driver_payouts_sub_payout
    ON driver_payouts(subcontractor_payout_id) WHERE subcontractor_payout_id IS NOT NULL;

CREATE OR REPLACE FUNCTION refresh_subcontractor_payouts(
    p_organization_id UUID,
    p_period_start DATE,
    p_period_end DATE
) RETURNS INTEGER AS $$
DECLARE
    n INT := 0;
    r RECORD;
    sp_id UUID;
    v_rent NUMERIC(12, 2);
    v_rent_status VARCHAR(50);
    v_payable NUMERIC(12, 2);
BEGIN
    DELETE FROM subcontractor_payouts sp
    WHERE sp.organization_id = p_organization_id
      AND sp.payment_period_start = p_period_start
      AND sp.payment_period_end = p_period_end
      AND NOT EXISTS (
          SELECT 1
          FROM driver_payouts dp
          INNER JOIN drivers d
            ON d.id = dp.driver_id
           AND d.organization_id = dp.organization_id
           AND d.subcontractor_id = sp.subcontractor_id
          WHERE dp.organization_id = p_organization_id
            AND dp.payment_period_start = p_period_start
            AND dp.payment_period_end = p_period_end
      );

    FOR r IN
        SELECT d.subcontractor_id AS sid,
               ROUND(COALESCE(SUM(dp.company_commission), 0)::numeric, 2) AS fleet,
               ROUND(COALESCE(SUM(dp.subcontractor_commission), 0)::numeric, 2) AS subc,
               ROUND(COALESCE(SUM(dp.net_driver_payout), 0)::numeric, 2) AS dnet,
               COUNT(*)::int AS cnt
        FROM driver_payouts dp
        INNER JOIN drivers d
          ON d.id = dp.driver_id
         AND d.organization_id = dp.organization_id
        WHERE dp.organization_id = p_organization_id
          AND dp.payment_period_start = p_period_start
          AND dp.payment_period_end = p_period_end
          AND d.subcontractor_id IS NOT NULL
        GROUP BY d.subcontractor_id
    LOOP
        SELECT rc.amount, rc.status::text
        INTO v_rent, v_rent_status
        FROM subcontractor_rent_charges rc
        WHERE rc.organization_id = p_organization_id
          AND rc.subcontractor_id = r.sid
          AND rc.period_start = p_period_start
          AND rc.period_end = p_period_end
        LIMIT 1;

        v_rent := COALESCE(v_rent, 0);
        v_payable := GREATEST(
            0::numeric,
            ROUND((r.dnet + r.subc - v_rent)::numeric, 2)
        );

        INSERT INTO subcontractor_payouts (
            organization_id,
            subcontractor_id,
            payment_period_start,
            payment_period_end,
            total_fleet_commission,
            total_subcontractor_commission,
            total_driver_net_payout,
            driver_payout_count,
            rent_charge_amount,
            rent_charge_status,
            amount_payable
        ) VALUES (
            p_organization_id,
            r.sid,
            p_period_start,
            p_period_end,
            r.fleet,
            r.subc,
            r.dnet,
            r.cnt,
            v_rent,
            v_rent_status,
            v_payable
        )
        ON CONFLICT ON CONSTRAINT uq_subcontractor_payout_period
        DO UPDATE SET
            total_fleet_commission = EXCLUDED.total_fleet_commission,
            total_subcontractor_commission = EXCLUDED.total_subcontractor_commission,
            total_driver_net_payout = EXCLUDED.total_driver_net_payout,
            driver_payout_count = EXCLUDED.driver_payout_count,
            rent_charge_amount = EXCLUDED.rent_charge_amount,
            rent_charge_status = EXCLUDED.rent_charge_status,
            amount_payable = EXCLUDED.amount_payable,
            updated_at = NOW()
        RETURNING id INTO sp_id;

        UPDATE driver_payouts dp
        SET subcontractor_payout_id = sp_id
        FROM drivers d
        WHERE d.id = dp.driver_id
          AND d.organization_id = dp.organization_id
          AND d.subcontractor_id = r.sid
          AND dp.organization_id = p_organization_id
          AND dp.payment_period_start = p_period_start
          AND dp.payment_period_end = p_period_end;
        n := n + 1;
    END LOOP;

    UPDATE driver_payouts dp
    SET subcontractor_payout_id = NULL
    FROM drivers d
    WHERE d.id = dp.driver_id
      AND d.organization_id = dp.organization_id
      AND dp.organization_id = p_organization_id
      AND dp.payment_period_start = p_period_start
      AND dp.payment_period_end = p_period_end
      AND d.subcontractor_id IS NULL
      AND dp.subcontractor_payout_id IS NOT NULL;

    RETURN n;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION refresh_subcontractor_payouts(UUID, DATE, DATE) IS
    'Upsert subcontractor_payouts from sub-managed driver_payouts for a period; link child rows. Does not change payment_status.';

-- Backfill existing periods
DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN
        SELECT DISTINCT dp.organization_id AS org_id,
               dp.payment_period_start AS p_start,
               dp.payment_period_end AS p_end
        FROM driver_payouts dp
        INNER JOIN drivers d
          ON d.id = dp.driver_id
         AND d.organization_id = dp.organization_id
        WHERE d.subcontractor_id IS NOT NULL
    LOOP
        PERFORM refresh_subcontractor_rent_charges(rec.org_id, rec.p_start, rec.p_end);
        PERFORM refresh_subcontractor_payouts(rec.org_id, rec.p_start, rec.p_end);
    END LOOP;
END $$;

COMMIT;
