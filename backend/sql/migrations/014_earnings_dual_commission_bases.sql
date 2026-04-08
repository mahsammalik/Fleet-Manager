-- Earnings import: TVT (total transfer) and daily cash bases + commission split audit columns

ALTER TABLE earnings_records
  ADD COLUMN IF NOT EXISTS total_transfer_earnings DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS daily_cash DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS transfer_commission DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS cash_commission DECIMAL(10, 2);

ALTER TABLE driver_payments
  ADD COLUMN IF NOT EXISTS total_daily_cash DECIMAL(12, 2) DEFAULT 0;
