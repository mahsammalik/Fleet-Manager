-- After 039: expect zero rows in each check.

SELECT 'earnings_records still has leg columns' AS check_name, c.column_name::text
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name = 'earnings_records'
  AND c.column_name IN ('transfer_commission', 'cash_commission')
LIMIT 1;

SELECT 'driver_payouts still has leg columns' AS check_name, c.column_name::text
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name = 'driver_payouts'
  AND c.column_name IN ('transfer_commission', 'cash_commission', 'total_commission')
LIMIT 1;

-- Payout matches generated helper (numeric tolerance)
SELECT 'earnings_records payout drift' AS check_name, er.id::text
FROM earnings_records er
WHERE er.driver_payout IS DISTINCT FROM er.driver_payout_after_cash;

-- Post-deploy note: fleet commission totals will differ from the pre-039 dual-leg (transfer+cash) model.
-- Re-run debt allocation / refresh payouts if business rules require reconciled net_driver_payout after bulk UPDATE.
