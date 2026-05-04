-- Run after 044_driver_payouts_updated_at.sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'driver_payouts'
  AND column_name = 'updated_at';
