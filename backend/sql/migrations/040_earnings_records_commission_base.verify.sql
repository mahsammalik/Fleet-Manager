-- After 040: expect no rows (column must exist).
SELECT 'missing commission_base on earnings_records' AS check_name
WHERE NOT EXISTS (
  SELECT 1
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'earnings_records'
    AND c.column_name = 'commission_base'
);

-- Post-deploy: net_income commission base uses platform net (gross + tips ± taxa), not TVT.
