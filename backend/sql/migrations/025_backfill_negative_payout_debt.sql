WITH recomputed AS (
  SELECT
    dp.id,
    COALESCE(
      SUM(
        (
          COALESCE(
            er.total_transfer_earnings,
            er.net_earnings,
            COALESCE(er.gross_earnings, 0) - COALESCE(er.platform_fee, 0),
            er.gross_earnings,
            0
          ) - ABS(COALESCE(er.transfer_commission, 0)) - ABS(COALESCE(er.cash_commission, 0))
        )::numeric
      ),
      0
    ) AS raw_net
  FROM driver_payouts dp
  INNER JOIN earnings_records er
    ON er.driver_id = dp.driver_id
  INNER JOIN earnings_imports ei
    ON ei.id = er.import_id
   AND ei.organization_id = dp.organization_id
   AND ei.week_start = dp.payment_period_start
   AND ei.week_end = dp.payment_period_end
  GROUP BY dp.id
)
UPDATE driver_payouts dp
SET
  raw_net_amount = ROUND(COALESCE(r.raw_net, COALESCE(dp.net_driver_payout, 0))::numeric, 2),
  debt_amount = CASE
    WHEN r.raw_net < 0 THEN ROUND(ABS(r.raw_net)::numeric, 2)
    ELSE COALESCE(dp.debt_amount, 0)
  END,
  remaining_debt_amount = CASE
    WHEN r.raw_net < 0 THEN ROUND(ABS(r.raw_net)::numeric, 2)
    ELSE COALESCE(dp.remaining_debt_amount, 0)
  END,
  net_driver_payout = CASE
    WHEN r.raw_net < 0 THEN 0
    ELSE COALESCE(dp.net_driver_payout, 0)
  END,
  payment_status = CASE
    WHEN r.raw_net < 0 THEN 'debt'
    ELSE dp.payment_status
  END
FROM recomputed r
WHERE dp.id = r.id;
