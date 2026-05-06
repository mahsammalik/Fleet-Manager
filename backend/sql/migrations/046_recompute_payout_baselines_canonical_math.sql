-- Recompute driver_payouts baselines from earnings_records using canonical sign rules.
BEGIN;

WITH agg AS (
  SELECT
    ei.organization_id,
    er.driver_id,
    ei.week_start AS payment_period_start,
    ei.week_end AS payment_period_end,
    ROUND(SUM(COALESCE(er.gross_earnings, 0))::numeric, 6) AS income,
    ROUND(SUM(COALESCE(er.tips, 0))::numeric, 6) AS tips,
    ROUND(SUM(ABS(COALESCE(er.platform_fee, 0)))::numeric, 2) AS total_platform_fees,
    ROUND(SUM(COALESCE(er.driver_payout, 0))::numeric, 2) AS total_net_earnings,
    ROUND(SUM(ABS(COALESCE(er.daily_cash, 0)))::numeric, 2) AS total_daily_cash,
    ROUND(SUM(ABS(COALESCE(er.account_opening_fee, 0)))::numeric, 6) AS account_opening_fee,
    ROUND(SUM(COALESCE(er.company_commission, 0))::numeric, 2) AS company_commission,
    ROUND(SUM(COALESCE(er.commission_base, 0))::numeric, 6) AS commission_base,
    ROUND(SUM(COALESCE(er.gross_earnings, 0) + COALESCE(er.tips, 0))::numeric, 6) AS gross_income,
    ROUND(SUM(COALESCE(er.gross_earnings, 0) + COALESCE(er.tips, 0) - ABS(COALESCE(er.platform_fee, 0)))::numeric, 6) AS net_income
  FROM earnings_records er
  INNER JOIN earnings_imports ei ON ei.id = er.import_id
  GROUP BY ei.organization_id, er.driver_id, ei.week_start, ei.week_end
)
UPDATE driver_payouts dp
SET
  income = COALESCE(agg.income, 0),
  tips = COALESCE(agg.tips, 0),
  total_platform_fees = COALESCE(agg.total_platform_fees, 0),
  total_net_earnings = COALESCE(agg.total_net_earnings, 0),
  total_daily_cash = COALESCE(agg.total_daily_cash, 0),
  account_opening_fee = COALESCE(agg.account_opening_fee, 0),
  company_commission = COALESCE(agg.company_commission, 0),
  commission_base = COALESCE(agg.commission_base, 0),
  gross_income = COALESCE(agg.gross_income, 0),
  net_income = COALESCE(agg.net_income, 0),
  raw_net_amount = ROUND((COALESCE(agg.total_net_earnings, 0) - ABS(COALESCE(agg.account_opening_fee, 0)))::numeric, 2)
FROM agg
WHERE dp.organization_id = agg.organization_id
  AND dp.driver_id = agg.driver_id
  AND dp.payment_period_start = agg.payment_period_start
  AND dp.payment_period_end = agg.payment_period_end;

COMMIT;
