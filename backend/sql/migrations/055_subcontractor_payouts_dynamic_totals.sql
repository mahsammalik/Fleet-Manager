-- Payment-tracking-only subcontractor_payouts; financial totals computed via subcontractor_settlement_totals().
BEGIN;

-- Map legacy payment statuses before tightening CHECK
UPDATE subcontractor_payouts
SET payment_status = 'pending'
WHERE payment_status NOT IN ('pending', 'paid', 'partial', 'overdue', 'cancelled');

ALTER TABLE subcontractor_payouts
    DROP COLUMN IF EXISTS total_income,
    DROP COLUMN IF EXISTS total_tips,
    DROP COLUMN IF EXISTS total_fleet_commission,
    DROP COLUMN IF EXISTS total_subcontractor_commission,
    DROP COLUMN IF EXISTS total_driver_net_payout,
    DROP COLUMN IF EXISTS driver_payout_count,
    DROP COLUMN IF EXISTS rent_charge_amount,
    DROP COLUMN IF EXISTS rent_charge_status,
    DROP COLUMN IF EXISTS amount_payable,
    DROP COLUMN IF EXISTS approved_by,
    DROP COLUMN IF EXISTS approved_at;

ALTER TABLE subcontractor_payouts
    ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(12, 2),
    ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'subcontractor_payouts'
          AND column_name = 'transaction_ref'
    ) THEN
        ALTER TABLE subcontractor_payouts RENAME COLUMN transaction_ref TO payment_reference;
    END IF;
END $$;

ALTER TABLE subcontractor_payouts DROP CONSTRAINT IF EXISTS subcontractor_payouts_payment_status_check;
ALTER TABLE subcontractor_payouts DROP CONSTRAINT IF EXISTS chk_subcontractor_payouts_payment_status;

ALTER TABLE subcontractor_payouts
    ADD CONSTRAINT chk_subcontractor_payouts_payment_status
    CHECK (payment_status IN ('pending', 'paid', 'partial', 'overdue', 'cancelled'));

CREATE OR REPLACE FUNCTION subcontractor_settlement_totals(
    p_organization_id UUID,
    p_period_start DATE,
    p_period_end DATE
) RETURNS TABLE (
    subcontractor_id UUID,
    total_income NUMERIC(12, 2),
    total_tips NUMERIC(12, 2),
    total_fleet_commission NUMERIC(12, 2),
    driver_payout_count INT,
    rent_charge_amount NUMERIC(12, 2),
    rent_charge_status VARCHAR(50),
    amount_payable NUMERIC(12, 2)
) AS $$
BEGIN
    RETURN QUERY
    WITH agg AS (
        SELECT d.subcontractor_id AS sid,
               ROUND(COALESCE(SUM(dp.income), 0)::numeric, 2) AS income_sum,
               ROUND(COALESCE(SUM(dp.tips), 0)::numeric, 2) AS tips_sum,
               ROUND(COALESCE(SUM(dp.company_commission), 0)::numeric, 2) AS fleet_sum,
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
    )
    SELECT a.sid,
           a.income_sum,
           a.tips_sum,
           a.fleet_sum,
           a.cnt,
           COALESCE(rc.amount, 0)::numeric(12, 2),
           rc.status::varchar(50),
           GREATEST(
               0::numeric,
               ROUND((a.income_sum + a.tips_sum - a.fleet_sum - COALESCE(rc.amount, 0))::numeric, 2)
           )
    FROM agg a
    LEFT JOIN subcontractor_rent_charges rc
      ON rc.organization_id = p_organization_id
     AND rc.subcontractor_id = a.sid
     AND rc.period_start = p_period_start
     AND rc.period_end = p_period_end;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION subcontractor_settlement_totals(UUID, DATE, DATE) IS
    'Per-subcontractor settlement aggregates from driver_payouts; payable = income + tips - fleet commission - rent.';

CREATE OR REPLACE FUNCTION refresh_subcontractor_payouts(
    p_organization_id UUID,
    p_period_start DATE,
    p_period_end DATE
) RETURNS INTEGER AS $$
DECLARE
    n INT := 0;
    r RECORD;
    sp_id UUID;
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
        SELECT DISTINCT d.subcontractor_id AS sid
        FROM driver_payouts dp
        INNER JOIN drivers d
          ON d.id = dp.driver_id
         AND d.organization_id = dp.organization_id
        WHERE dp.organization_id = p_organization_id
          AND dp.payment_period_start = p_period_start
          AND dp.payment_period_end = p_period_end
          AND d.subcontractor_id IS NOT NULL
    LOOP
        INSERT INTO subcontractor_payouts (
            organization_id,
            subcontractor_id,
            payment_period_start,
            payment_period_end
        ) VALUES (
            p_organization_id,
            r.sid,
            p_period_start,
            p_period_end
        )
        ON CONFLICT ON CONSTRAINT uq_subcontractor_payout_period
        DO UPDATE SET updated_at = NOW()
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
    'Ensure payment-tracking subcontractor_payouts rows exist and link sub-managed driver_payouts; does not store financial totals.';

COMMIT;
