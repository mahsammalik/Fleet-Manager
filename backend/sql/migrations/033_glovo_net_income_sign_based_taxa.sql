-- Recompute Glovo transparency net_income using sign-based Taxa aplicatie, and set commission_base = net_income
-- (ladder net only — never TVT/daily_cash blended into commission_base).

UPDATE driver_payouts dp
SET
  net_income = agg.net_inc,
  commission_base = agg.net_inc
FROM (
  SELECT
    ei.organization_id,
    er.driver_id,
    ei.week_start AS payment_period_start,
    ei.week_end AS payment_period_end,
    SUM(
      CASE
        WHEN COALESCE(er.platform_fee, 0) < 0 THEN
          COALESCE(er.gross_earnings, 0) + COALESCE(er.tips, 0) + COALESCE(er.platform_fee, 0)
        ELSE
          COALESCE(er.gross_earnings, 0) + COALESCE(er.tips, 0) - COALESCE(er.platform_fee, 0)
      END
    )::numeric(12, 6) AS net_inc
  FROM earnings_records er
  INNER JOIN earnings_imports ei ON ei.id = er.import_id AND ei.platform = 'glovo'
  INNER JOIN drivers d ON d.id = er.driver_id AND d.organization_id = ei.organization_id
  GROUP BY ei.organization_id, er.driver_id, ei.week_start, ei.week_end
) agg
WHERE dp.organization_id = agg.organization_id
  AND dp.driver_id = agg.driver_id
  AND dp.payment_period_start = agg.payment_period_start
  AND dp.payment_period_end = agg.payment_period_end;
