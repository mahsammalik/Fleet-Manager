-- B2B settlement payable: SUM(total_gross_earnings) - fleet - vehicle_rent - other_fleet_fees.
BEGIN;

DROP FUNCTION IF EXISTS subcontractor_settlement_totals(UUID, DATE, DATE);

CREATE OR REPLACE FUNCTION subcontractor_settlement_totals(
    p_organization_id UUID,
    p_period_start DATE,
    p_period_end DATE
) RETURNS TABLE (
    subcontractor_id UUID,
    driver_payout_count INT,
    total_gross_income NUMERIC(12, 2),
    total_tips NUMERIC(12, 2),
    total_platform_fees NUMERIC(12, 2),
    total_fleet_commission NUMERIC(12, 2),
    total_account_opening_fee NUMERIC(12, 2),
    total_vehicle_rent NUMERIC(12, 2),
    total_daily_cash NUMERIC(12, 2),
    total_other_fleet_fees NUMERIC(12, 2),
    total_payable NUMERIC(12, 2),
    amount_expected NUMERIC(12, 2),
    integrity_ok BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    WITH agg AS (
        SELECT d.subcontractor_id AS sid,
               COUNT(*)::int AS cnt,
               ROUND(COALESCE(SUM(dp.total_gross_earnings), 0)::numeric, 2) AS gross_sum,
               ROUND(COALESCE(SUM(dp.tips), 0)::numeric, 2) AS tips_sum,
               ROUND(COALESCE(SUM(dp.total_platform_fees), 0)::numeric, 2) AS platform_sum,
               ROUND(COALESCE(SUM(dp.company_commission), 0)::numeric, 2) AS fleet_sum,
               ROUND(COALESCE(SUM(dp.account_opening_fee), 0)::numeric, 2) AS account_fee_sum,
               ROUND(COALESCE(SUM(dp.vehicle_rental_fee), 0)::numeric, 2) AS vehicle_rent_sum,
               ROUND(COALESCE(SUM(dp.total_daily_cash), 0)::numeric, 2) AS daily_cash_sum
        FROM driver_payouts dp
        INNER JOIN drivers d
          ON d.id = dp.driver_id
         AND d.organization_id = dp.organization_id
        WHERE dp.organization_id = p_organization_id
          AND dp.payment_period_start = p_period_start
          AND dp.payment_period_end = p_period_end
          AND d.subcontractor_id IS NOT NULL
        GROUP BY d.subcontractor_id
    ),
    calc AS (
        SELECT a.*,
               ROUND((a.platform_sum + a.account_fee_sum + a.daily_cash_sum)::numeric, 2) AS other_fees_sum,
               GREATEST(
                   0::numeric,
                   ROUND((
                       a.gross_sum - a.fleet_sum - a.vehicle_rent_sum
                       - a.platform_sum - a.account_fee_sum - a.daily_cash_sum
                   )::numeric, 2)
               ) AS payable_sum
        FROM agg a
    )
    SELECT c.sid,
           c.cnt,
           c.gross_sum,
           c.tips_sum,
           c.platform_sum,
           c.fleet_sum,
           c.account_fee_sum,
           c.vehicle_rent_sum,
           c.daily_cash_sum,
           c.other_fees_sum,
           c.payable_sum,
           c.payable_sum,
           true
    FROM calc c;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION subcontractor_settlement_totals(UUID, DATE, DATE) IS
    'B2B wire to subcontractor: SUM(total_gross_earnings) - fleet commission - vehicle rent - platform/account/cash fees.';

COMMIT;
