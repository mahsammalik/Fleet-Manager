-- Backfill driver_payouts Glovo transparency columns from earnings_records (Glovo imports).
-- Requires 031_glovo_payout_transparency_columns.sql (tips on earnings_records).
-- commission_base matches ladder net_income (not TVT or blended cash logic).

UPDATE driver_payouts dp
SET
  gross_income = agg.gross_inc,
  net_income = agg.net_inc,
  commission_base = agg.net_inc,
  commission_rate = agg.rate_frac,
  commission_base_type = COALESCE(dp.commission_base_type, 'net_income')
FROM (
  SELECT
    ei.organization_id,
    er.driver_id,
    ei.week_start AS payment_period_start,
    ei.week_end AS payment_period_end,
    (SUM(COALESCE(er.gross_earnings, 0)) + SUM(COALESCE(er.tips, 0)))::numeric(12, 6) AS gross_inc,
    SUM(
      CASE
        WHEN COALESCE(er.platform_fee, 0) < 0 THEN
          COALESCE(er.gross_earnings, 0) + COALESCE(er.tips, 0) + COALESCE(er.platform_fee, 0)
        ELSE
          COALESCE(er.gross_earnings, 0) + COALESCE(er.tips, 0) - COALESCE(er.platform_fee, 0)
      END
    )::numeric(12, 6) AS net_inc,
    (MAX(d.commission_rate)::numeric / 100.0)::numeric(6, 5) AS rate_frac
  FROM earnings_records er
  INNER JOIN earnings_imports ei ON ei.id = er.import_id AND ei.platform = 'glovo'
  INNER JOIN drivers d ON d.id = er.driver_id AND d.organization_id = ei.organization_id
  GROUP BY ei.organization_id, er.driver_id, ei.week_start, ei.week_end
) agg
WHERE dp.organization_id = agg.organization_id
  AND dp.driver_id = agg.driver_id
  AND dp.payment_period_start = agg.payment_period_start
  AND dp.payment_period_end = agg.payment_period_end;
