-- Fix return type: rent_charge_status must be varchar(50), not text.
BEGIN;

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

COMMIT;
