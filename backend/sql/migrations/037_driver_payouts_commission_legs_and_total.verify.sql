-- Expect zero rows: total_commission must equal transfer + cash (generated invariant).
SELECT dp.id::text AS payout_id,
       d.id::text AS driver_id,
       CONCAT(d.first_name, ' ', d.last_name) AS driver_name,
       dp.transfer_commission::text,
       dp.cash_commission::text,
       (COALESCE(dp.transfer_commission, 0) + COALESCE(dp.cash_commission, 0))::text AS calculated_total,
       dp.total_commission::text AS stored_total
FROM driver_payouts dp
INNER JOIN drivers d ON d.id = dp.driver_id
WHERE ABS(
        (COALESCE(dp.transfer_commission, 0) + COALESCE(dp.cash_commission, 0)) - COALESCE(dp.total_commission, 0)
      ) >= 0.000001
LIMIT 50;
