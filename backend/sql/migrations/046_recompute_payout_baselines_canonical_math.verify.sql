-- After 046: expect no rows returned by mismatch checks.
WITH expected AS (
  SELECT
    ei.organization_id,
    er.driver_id,
    ei.week_start AS payment_period_start,
    ei.week_end AS payment_period_end,
    ROUND(SUM(COALESCE(er.driver_payout, 0))::numeric, 2) AS expected_total_net_earnings,
    ROUND(SUM(ABS(COALESCE(er.account_opening_fee, 0)))::numeric, 6) AS expected_account_opening_fee,
    ROUND(SUM(COALESCE(er.driver_payout, 0))::numeric, 2)
      - ROUND(SUM(ABS(COALESCE(er.account_opening_fee, 0)))::numeric, 2) AS expected_raw_net_amount
  FROM earnings_records er
  INNER JOIN earnings_imports ei ON ei.id = er.import_id
  GROUP BY ei.organization_id, er.driver_id, ei.week_start, ei.week_end
)
SELECT
  'driver_payouts baseline mismatch vs earnings_records' AS check_name,
  dp.id::text AS payout_id
FROM driver_payouts dp
INNER JOIN expected e
  ON e.organization_id = dp.organization_id
 AND e.driver_id = dp.driver_id
 AND e.payment_period_start = dp.payment_period_start
 AND e.payment_period_end = dp.payment_period_end
WHERE ROUND(COALESCE(dp.total_net_earnings, 0)::numeric, 2) <> ROUND(COALESCE(e.expected_total_net_earnings, 0)::numeric, 2)
   OR ROUND(COALESCE(dp.account_opening_fee, 0)::numeric, 2) <> ROUND(COALESCE(e.expected_account_opening_fee, 0)::numeric, 2)
   OR ROUND(COALESCE(dp.raw_net_amount, 0)::numeric, 2) <> ROUND(COALESCE(e.expected_raw_net_amount, 0)::numeric, 2)
LIMIT 100;
