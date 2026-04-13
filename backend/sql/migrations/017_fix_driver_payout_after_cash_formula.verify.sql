-- Verify strict ABS formula fix
SELECT
  COUNT(*) AS broken_rows
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
            ) - ABS(COALESCE(er.transfer_commission, 0)) - ABS(COALESCE(er.cash_commission, 0))
          )::numeric,
          2
        )
      )::numeric(12, 2);

SELECT
  er.id,
  er.total_transfer_earnings,
  er.transfer_commission,
  er.cash_commission,
  er.driver_payout,
  er.driver_payout_after_cash,
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
        ) - ABS(COALESCE(er.transfer_commission, 0)) - ABS(COALESCE(er.cash_commission, 0))
      )::numeric,
      2
    )
  ) AS expected_payout
FROM earnings_records er
WHERE er.id = '244e8273-c8ed-4a15-a54a-c76931e38e8d'::uuid;
