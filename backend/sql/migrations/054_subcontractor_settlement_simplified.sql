-- B2B settlement: payable = income + tips - fleet commission - rent (sub commission / driver net audit-only).
BEGIN;

ALTER TABLE subcontractor_payouts
    ADD COLUMN IF NOT EXISTS total_income NUMERIC(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_tips NUMERIC(12, 2) NOT NULL DEFAULT 0;

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
               ROUND(COALESCE(SUM(dp.income), 0)::numeric, 2) AS income_sum,
               ROUND(COALESCE(SUM(dp.tips), 0)::numeric, 2) AS tips_sum,
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
            ROUND((r.income_sum + r.tips_sum - r.fleet - v_rent)::numeric, 2)
        );

        INSERT INTO subcontractor_payouts (
            organization_id,
            subcontractor_id,
            payment_period_start,
            payment_period_end,
            total_income,
            total_tips,
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
            r.income_sum,
            r.tips_sum,
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
            total_income = EXCLUDED.total_income,
            total_tips = EXCLUDED.total_tips,
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
    'Upsert subcontractor_payouts: payable = income + tips - fleet commission - rent; audit columns for sub commission and driver net retained.';

DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN
        SELECT DISTINCT sp.organization_id AS org_id,
               sp.payment_period_start AS p_start,
               sp.payment_period_end AS p_end
        FROM subcontractor_payouts sp
    LOOP
        PERFORM refresh_subcontractor_payouts(rec.org_id, rec.p_start, rec.p_end);
    END LOOP;
END $$;

COMMIT;
