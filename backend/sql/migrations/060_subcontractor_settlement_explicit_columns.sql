-- Settlement payable = SUM(net_driver_payout); expose fee columns individually (no bundled other_fees).
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
    total_fleet_commission NUMERIC(12, 2),
    total_vehicle_rent NUMERIC(12, 2),
    total_account_opening_fee NUMERIC(12, 2),
    total_platform_fees NUMERIC(12, 2),
    total_daily_cash NUMERIC(12, 2),
    total_payable NUMERIC(12, 2)
) AS $$
BEGIN
    RETURN QUERY
    SELECT d.subcontractor_id,
           COUNT(*)::int,
           ROUND(COALESCE(SUM(dp.total_gross_earnings), 0)::numeric, 2),
           ROUND(COALESCE(SUM(dp.tips), 0)::numeric, 2),
           ROUND(COALESCE(SUM(dp.company_commission), 0)::numeric, 2),
           ROUND(COALESCE(SUM(dp.vehicle_rental_fee), 0)::numeric, 2),
           ROUND(COALESCE(SUM(dp.account_opening_fee), 0)::numeric, 2),
           ROUND(COALESCE(SUM(dp.total_platform_fees), 0)::numeric, 2),
           ROUND(COALESCE(SUM(dp.total_daily_cash), 0)::numeric, 2),
           ROUND(COALESCE(SUM(dp.net_driver_payout), 0)::numeric, 2)
    FROM driver_payouts dp
    INNER JOIN drivers d
      ON d.id = dp.driver_id
     AND d.organization_id = dp.organization_id
    WHERE dp.organization_id = p_organization_id
      AND dp.payment_period_start = p_period_start
      AND dp.payment_period_end = p_period_end
      AND d.subcontractor_id IS NOT NULL
    GROUP BY d.subcontractor_id;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION subcontractor_settlement_totals(UUID, DATE, DATE) IS
    'Per-subcontractor SUM of driver_payouts for the period. total_fleet_commission = SUM(company_commission); total_payable = SUM(net_driver_payout). Renamed to total_company_commission in migration 061.';

COMMIT;
