-- Rollback for 016_cash_commission_payout_guardrails.sql
-- Note: data updates are not reversible; this rollback removes structural guardrails only.

DROP TRIGGER IF EXISTS trg_earnings_records_payout_after_cash ON earnings_records;
DROP FUNCTION IF EXISTS trg_enforce_driver_payout_after_cash();

ALTER TABLE earnings_records
  DROP COLUMN IF EXISTS driver_payout_after_cash;

ALTER TABLE earnings_records
  DROP COLUMN IF EXISTS has_cash_commission;
