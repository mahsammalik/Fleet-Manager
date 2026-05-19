SELECT 'stale_subcontractor_commission_column' AS check_name, table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name = 'subcontractor_commission'
  AND table_name IN ('earnings_records', 'driver_payouts');

SELECT 'stale_subcontractor_commission_rate_pct' AS check_name, 1
WHERE EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'subcontractors'
      AND column_name = 'subcontractor_commission_rate_pct'
);

SELECT 'missing_commission_rate' AS check_name, 1
WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'subcontractors'
      AND column_name = 'commission_rate'
);
