-- Glovo transparency: platform gross/net ladder + commission base metadata (rollup on driver_payouts).
-- earnings_records.tips: optional CSV column; gross_earnings continues to store venituri.

ALTER TABLE earnings_records
  ADD COLUMN IF NOT EXISTS tips DECIMAL(10, 2);

ALTER TABLE driver_payouts
  ADD COLUMN IF NOT EXISTS gross_income NUMERIC(12, 6),
  ADD COLUMN IF NOT EXISTS net_income NUMERIC(12, 6),
  ADD COLUMN IF NOT EXISTS commission_base NUMERIC(12, 6),
  ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(6, 5),
  ADD COLUMN IF NOT EXISTS commission_base_type VARCHAR(50) DEFAULT 'net_income';

COMMENT ON COLUMN driver_payouts.gross_income IS 'Glovo ladder: SUM(venituri+tips) for period (transparency; total_gross_earnings unchanged legacy)';
COMMENT ON COLUMN driver_payouts.net_income IS 'Glovo ladder: SUM(venituri+tips-taxa) per row (transparency)';
COMMENT ON COLUMN driver_payouts.commission_base IS 'Period sum of ladder net income (matches net_income); fleet transfer-leg bases remain per earnings row';
COMMENT ON COLUMN driver_payouts.commission_rate IS 'Driver fleet rate as fraction (e.g. 0.20 for 20%)';
COMMENT ON COLUMN driver_payouts.commission_base_type IS 'Which amount fed transfer commission base for this payout row';
