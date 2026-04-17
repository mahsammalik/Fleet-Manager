ALTER TABLE driver_payouts
  ADD COLUMN IF NOT EXISTS raw_net_amount DECIMAL(12, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS debt_amount DECIMAL(12, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS debt_applied_amount DECIMAL(12, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remaining_debt_amount DECIMAL(12, 2) DEFAULT 0;

UPDATE driver_payouts
SET
  raw_net_amount = COALESCE(net_driver_payout, 0),
  debt_amount = COALESCE(debt_amount, 0),
  debt_applied_amount = COALESCE(debt_applied_amount, 0),
  remaining_debt_amount = COALESCE(remaining_debt_amount, 0)
WHERE raw_net_amount IS NULL
   OR debt_amount IS NULL
   OR debt_applied_amount IS NULL
   OR remaining_debt_amount IS NULL;

ALTER TABLE driver_payouts
  DROP CONSTRAINT IF EXISTS driver_payouts_payment_status_check;

ALTER TABLE driver_payouts
  ADD CONSTRAINT driver_payouts_payment_status_check
  CHECK (payment_status IN ('pending', 'approved', 'paid', 'hold', 'debt'));
