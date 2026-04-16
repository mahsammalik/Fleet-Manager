ALTER TABLE driver_payouts
  ADD COLUMN IF NOT EXISTS platform_id VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_driver_payouts_platform_id
  ON driver_payouts(platform_id);
