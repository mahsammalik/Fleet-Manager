-- Migration: Add Wolt courier fields to drivers
-- Run after 009_vehicle_documents.sql

ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS wolt_courier_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS wolt_courier_verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS wolt_courier_verified_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_drivers_wolt_courier_id ON drivers(wolt_courier_id);

-- Optional: insert Wolt into platform_types if table exists
DO $$
BEGIN
  IF to_regclass('platform_types') IS NOT NULL THEN
    INSERT INTO platform_types (name, code, logo_url, is_active)
    VALUES ('Wolt', 'wolt', '/images/platforms/wolt.png', true)
    ON CONFLICT (code) DO NOTHING;
  END IF;
END$$;

