-- Settlement = vertical SUM of driver_payouts per subcontractor; integrity check on net_driver_payout.
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
    total_payable NUMERIC(12, 2),
    amount_expected NUMERIC(12, 2),
    integrity_ok BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    WITH agg AS (
        SELECT d.subcontractor_id AS sid,
               COUNT(*)::int AS cnt,
               ROUND(COALESCE(SUM(dp.gross_income), 0)::numeric, 2) AS gross_sum,
               ROUND(COALESCE(SUM(dp.tips), 0)::numeric, 2) AS tips_sum,
               ROUND(COALESCE(SUM(dp.total_platform_fees), 0)::numeric, 2) AS platform_sum,
               ROUND(COALESCE(SUM(dp.company_commission), 0)::numeric, 2) AS fleet_sum,
               ROUND(COALESCE(SUM(dp.account_opening_fee), 0)::numeric, 2) AS account_fee_sum,
               ROUND(COALESCE(SUM(dp.vehicle_rental_fee), 0)::numeric, 2) AS vehicle_rent_sum,
               ROUND(COALESCE(SUM(dp.total_daily_cash), 0)::numeric, 2) AS daily_cash_sum,
               ROUND(COALESCE(SUM(dp.net_driver_payout), 0)::numeric, 2) AS payable_sum
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
           a.cnt,
           a.gross_sum,
           a.tips_sum,
           a.platform_sum,
           a.fleet_sum,
           a.account_fee_sum,
           a.vehicle_rent_sum,
           a.daily_cash_sum,
           a.payable_sum,
           ROUND((
               a.gross_sum + a.tips_sum - a.platform_sum - a.fleet_sum
               - a.account_fee_sum - a.vehicle_rent_sum - a.daily_cash_sum
           )::numeric, 2) AS expected_sum,
           ABS(
               a.payable_sum - ROUND((
                   a.gross_sum + a.tips_sum - a.platform_sum - a.fleet_sum
                   - a.account_fee_sum - a.vehicle_rent_sum - a.daily_cash_sum
               )::numeric, 2)
           ) < 0.01
    FROM agg a;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION subcontractor_settlement_totals(UUID, DATE, DATE) IS
    'Vertical SUM of sub-managed driver_payouts; total_payable = SUM(net_driver_payout); integrity_ok when it matches gross+tips-fees-commission-account-rent-cash.';

COMMIT;
