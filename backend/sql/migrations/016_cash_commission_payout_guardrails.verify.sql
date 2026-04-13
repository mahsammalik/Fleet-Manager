-- Verification query dashboard (run after migration 016)
-- 1) Broken rows should be zero for cash-commission rows.
SELECT COUNT(*) AS broken_cash_rows
FROM earnings_records er
WHERE COALESCE(er.cash_commission, 0) < 0
  AND COALESCE(er.driver_payout, 0)::numeric(12, 2) <>
      GREATEST(
        0,
        ROUND(
          (
            COALESCE(
              er.total_transfer_earnings,
              er.net_earnings,
              COALESCE(er.gross_earnings, 0) - COALESCE(er.platform_fee, 0),
              er.gross_earnings,
              0
            ) - COALESCE(er.company_commission, 0)
          )::numeric,
          2
        )
      )::numeric(12, 2);

-- 2) Inspect latest 50 cash rows with expected payout and status.
SELECT
  er.id,
  er.driver_id,
  er.trip_date,
  er.platform,
  er.net_earnings,
  er.driver_payout,
  er.cash_commission,
  GREATEST(
    0,
    ROUND(
      (
        COALESCE(
          er.total_transfer_earnings,
          er.net_earnings,
          COALESCE(er.gross_earnings, 0) - COALESCE(er.platform_fee, 0),
          er.gross_earnings,
          0
        ) - COALESCE(er.company_commission, 0)
      )::numeric,
      2
    )
  ) AS expected_payout,
  (
    COALESCE(er.driver_payout, 0)::numeric(12, 2) =
    GREATEST(
      0,
      ROUND(
        (
          COALESCE(
            er.total_transfer_earnings,
            er.net_earnings,
            COALESCE(er.gross_earnings, 0) - COALESCE(er.platform_fee, 0),
            er.gross_earnings,
            0
          ) - COALESCE(er.company_commission, 0)
        )::numeric,
        2
      )
    )::numeric(12, 2)
  ) AS ok
FROM earnings_records er
WHERE COALESCE(er.cash_commission, 0) <> 0
ORDER BY er.trip_date DESC, er.created_at DESC
LIMIT 50;
