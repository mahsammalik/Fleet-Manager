-- After 041: row payout matches net - commission - ABS(daily_cash)
SELECT 'earnings_records payout vs formula' AS check_name, er.id::text
FROM earnings_records er
WHERE er.driver_payout IS DISTINCT FROM er.driver_payout_after_cash;

-- Optional Bilal-style check (replace UUID): expected = net_income_expr - commission - ABS(daily_cash)
-- SELECT er.driver_payout::numeric, ROUND((ni - COALESCE(er.company_commission,0) - ABS(COALESCE(er.daily_cash,0)))::numeric,2) AS expected
-- FROM earnings_records er CROSS JOIN LATERAL (
--   SELECT CASE WHEN COALESCE(er.platform_fee,0) < 0 THEN COALESCE(er.gross_earnings,0)+COALESCE(er.tips,0)+COALESCE(er.platform_fee,0)
--               ELSE COALESCE(er.gross_earnings,0)+COALESCE(er.tips,0)-COALESCE(er.platform_fee,0) END AS ni
-- ) x WHERE er.driver_id = '...'::uuid LIMIT 5;

-- Re-run debt carry-forward after migration:
--   npm run recompute-payout-debt --workspace backend
