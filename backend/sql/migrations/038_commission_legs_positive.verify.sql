-- Expect zero rows in each query after migration 038.

-- Negative legs should not exist.
SELECT 'earnings_records negative leg' AS check_name, er.id::text
FROM earnings_records er
WHERE COALESCE(er.transfer_commission, 0) < 0
   OR COALESCE(er.cash_commission, 0) < 0;

SELECT 'driver_payouts negative leg' AS check_name, dp.id::text
FROM driver_payouts dp
WHERE COALESCE(dp.transfer_commission, 0) < 0
   OR COALESCE(dp.cash_commission, 0) < 0;

-- total_commission must match explicit sum (non-negative legs → same as ABS sum).
SELECT 'driver_payouts total_commission drift' AS check_name,
       dp.id::text,
       dp.transfer_commission::text,
       dp.cash_commission::text,
       dp.total_commission::text AS stored_total
FROM driver_payouts dp
WHERE ABS(
        (COALESCE(dp.transfer_commission, 0) + COALESCE(dp.cash_commission, 0))
        - COALESCE(dp.total_commission, 0)
      ) > 0.01;

-- earnings_records: payout matches generated after_cash.
SELECT 'earnings_records payout vs after_cash' AS check_name, er.id::text
FROM earnings_records er
WHERE er.driver_payout IS DISTINCT FROM er.driver_payout_after_cash;
