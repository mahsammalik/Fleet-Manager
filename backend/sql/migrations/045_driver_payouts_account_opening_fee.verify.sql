-- After 045: expect no rows for mismatch checks.
SELECT 'missing account_opening_fee column on driver_payouts' AS check_name
WHERE NOT EXISTS (
  SELECT 1
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'driver_payouts'
    AND c.column_name = 'account_opening_fee'
);

WITH row_fee AS (
  SELECT
    ei.organization_id,
    er.driver_id,
    ei.week_start AS payment_period_start,
    ei.week_end AS payment_period_end,
    ROUND(SUM(ABS(COALESCE(er.account_opening_fee, 0)))::numeric, 2) AS expected_fee
  FROM earnings_records er
  INNER JOIN earnings_imports ei ON ei.id = er.import_id
  GROUP BY ei.organization_id, er.driver_id, ei.week_start, ei.week_end
)
SELECT
  'driver_payouts fee mismatch vs earnings_records' AS check_name,
  dp.id::text AS payout_id
FROM driver_payouts dp
INNER JOIN row_fee rf
  ON rf.organization_id = dp.organization_id
 AND rf.driver_id = dp.driver_id
 AND rf.payment_period_start = dp.payment_period_start
 AND rf.payment_period_end = dp.payment_period_end
WHERE ROUND(COALESCE(dp.account_opening_fee, 0)::numeric, 2)
    <> ROUND(COALESCE(rf.expected_fee, 0)::numeric, 2)
LIMIT 100;

-- Post-deploy: run debt carry-forward recomputation to refresh net_driver_payout from corrected raw_net_amount.
