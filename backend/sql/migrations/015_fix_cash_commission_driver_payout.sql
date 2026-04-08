-- Backfill: ensure cash commission is reflected in payout + net rollups.
-- Recompute payout as:
--   max(0, transfer_base - company_commission)
-- for rows that include cash context.

WITH recomputed AS (
  SELECT
    er.id,
    er.driver_id,
    er.import_id,
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
    )::numeric(10, 2) AS expected_payout
  FROM earnings_records er
  WHERE COALESCE(er.daily_cash, 0) <> 0 OR COALESCE(er.cash_commission, 0) <> 0
),
updated_rows AS (
  UPDATE earnings_records er
  SET
    driver_payout = r.expected_payout,
    net_earnings = r.expected_payout
  FROM recomputed r
  WHERE er.id = r.id
    AND (
      COALESCE(er.driver_payout, -99999999)::numeric(12, 2) <> r.expected_payout
      OR COALESCE(er.net_earnings, -99999999)::numeric(12, 2) <> r.expected_payout
    )
  RETURNING er.driver_id, er.import_id
),
impacted_periods AS (
  SELECT DISTINCT
    ei.organization_id,
    ur.driver_id,
    ei.week_start,
    ei.week_end
  FROM updated_rows ur
  JOIN earnings_imports ei ON ei.id = ur.import_id
),
period_rollups AS (
  SELECT
    ip.organization_id,
    ip.driver_id,
    ip.week_start,
    ip.week_end,
    COALESCE(SUM(er.driver_payout), 0)::numeric(10, 2) AS payout_sum,
    COALESCE(SUM(er.net_earnings), 0)::numeric(12, 2) AS net_sum
  FROM impacted_periods ip
  LEFT JOIN earnings_imports ei
    ON ei.organization_id = ip.organization_id
   AND ei.week_start = ip.week_start
   AND ei.week_end = ip.week_end
   AND ei.status = 'completed'
  LEFT JOIN earnings_records er
    ON er.import_id = ei.id
   AND er.driver_id = ip.driver_id
  GROUP BY ip.organization_id, ip.driver_id, ip.week_start, ip.week_end
)
UPDATE driver_payments dp
SET
  net_driver_payout = pr.payout_sum,
  total_net_earnings = pr.net_sum
FROM period_rollups pr
WHERE dp.organization_id = pr.organization_id
  AND dp.driver_id = pr.driver_id
  AND dp.payment_period_start = pr.week_start
  AND dp.payment_period_end = pr.week_end;
