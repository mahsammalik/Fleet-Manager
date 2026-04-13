-- Backup snapshot before applying 017 payout formula fix.
-- Run before 017_fix_driver_payout_after_cash_formula.sql if you want reversible data snapshots.

CREATE TABLE IF NOT EXISTS backup_017_earnings_records_cash_rows AS
SELECT
  er.*
FROM earnings_records er
WHERE COALESCE(er.cash_commission, 0) <> 0;

CREATE TABLE IF NOT EXISTS backup_017_driver_payments_cash_periods AS
SELECT dp.*
FROM driver_payments dp
WHERE EXISTS (
  SELECT 1
  FROM earnings_records er
  JOIN earnings_imports ei ON ei.id = er.import_id
  WHERE ei.organization_id = dp.organization_id
    AND er.driver_id = dp.driver_id
    AND ei.week_start = dp.payment_period_start
    AND ei.week_end = dp.payment_period_end
    AND COALESCE(er.cash_commission, 0) <> 0
);
