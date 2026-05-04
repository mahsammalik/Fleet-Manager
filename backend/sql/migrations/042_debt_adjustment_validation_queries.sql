-- Read-only validation queries for prod/staging (run manually; do not execute as migration)
--
-- 1) Stored positive deltas on type=adjust (remaining increased). Often mistaken "forgive" via old adjust API (+request increased debt). New API: positive request amount reduces remaining.
SELECT pa.id,
       pa.payout_id,
       pa.adjustment_type,
       pa.amount AS delta_remaining,
       pa.previous_remaining_debt,
       pa.new_remaining_debt,
       pa.created_at
FROM payout_adjustments pa
WHERE pa.adjustment_type = 'adjust'
  AND pa.amount > 0
ORDER BY pa.created_at DESC
LIMIT 200;

-- 2) Forgive / cash should never increase remaining (requires 042 backfilled or new rows only)
SELECT pa.id,
       pa.payout_id,
       pa.adjustment_type,
       pa.amount,
       pa.previous_remaining_debt,
       pa.new_remaining_debt,
       CASE
           WHEN pa.new_remaining_debt IS NOT NULL
                AND pa.previous_remaining_debt IS NOT NULL
                AND pa.new_remaining_debt > pa.previous_remaining_debt
               THEN 'increased'
           ELSE 'ok'
       END AS check_result
FROM payout_adjustments pa
WHERE pa.adjustment_type IN ('forgive', 'cash_received')
ORDER BY pa.created_at DESC
LIMIT 500;

-- 3) Payouts: remaining vs period debt (spot-check UI confusion)
SELECT dp.id,
       dp.driver_id,
       dp.payment_period_end::text AS period_end,
       dp.raw_net_amount,
       dp.debt_amount AS period_shortfall,
       dp.remaining_debt_amount AS remaining_collectible,
       dp.payment_status
FROM driver_payouts dp
WHERE COALESCE(dp.remaining_debt_amount, 0) > 0
   OR COALESCE(dp.debt_amount, 0) > 0
ORDER BY dp.payment_period_end DESC
LIMIT 100;
