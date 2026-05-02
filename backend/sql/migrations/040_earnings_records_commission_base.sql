-- Row-level audit: amount fleet commission was calculated on (matches org commission_base_type at import).
BEGIN;

ALTER TABLE earnings_records
  ADD COLUMN IF NOT EXISTS commission_base NUMERIC(12, 6);

COMMENT ON COLUMN earnings_records.commission_base IS
  'Fleet commission numerator for this row (sum rollups to driver_payouts.commission_base). NULL for rows imported before this column existed.';

COMMIT;
