-- Add period-level account opening fee rollup on driver_payouts and backfill from earnings_records.
BEGIN;

ALTER TABLE driver_payouts
  ADD COLUMN IF NOT EXISTS account_opening_fee NUMERIC(12, 6) DEFAULT 0;

COMMENT ON COLUMN driver_payouts.account_opening_fee IS
  'Period sum of row-level account_opening_fee imported from earnings_records.';

WITH agg AS (
  SELECT
    ei.organization_id,
    er.driver_id,
    ei.week_start AS payment_period_start,
    ei.week_end AS payment_period_end,
    ROUND(SUM(COALESCE(er.driver_payout, 0))::numeric, 2) AS payout_before_fee,
    ROUND(SUM(ABS(COALESCE(er.account_opening_fee, 0)))::numeric, 2) AS opening_fee
  FROM earnings_records er
  INNER JOIN earnings_imports ei ON ei.id = er.import_id
  GROUP BY ei.organization_id, er.driver_id, ei.week_start, ei.week_end
)
UPDATE driver_payouts dp
SET
  account_opening_fee = COALESCE(agg.opening_fee, 0)::numeric(12, 6),
  raw_net_amount = ROUND((COALESCE(agg.payout_before_fee, 0) - COALESCE(agg.opening_fee, 0))::numeric, 2),
  total_net_earnings = ROUND((COALESCE(agg.payout_before_fee, 0) - COALESCE(agg.opening_fee, 0))::numeric, 2)
FROM agg
WHERE dp.organization_id = agg.organization_id
  AND dp.driver_id = agg.driver_id
  AND dp.payment_period_start = agg.payment_period_start
  AND dp.payment_period_end = agg.payment_period_end;

COMMIT;
