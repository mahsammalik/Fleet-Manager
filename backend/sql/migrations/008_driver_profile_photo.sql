-- Migration: Add driver profile photo columns
-- Run after 007_driver_current_vehicle.sql.

ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS profile_photo_url VARCHAR(500),
  ADD COLUMN IF NOT EXISTS profile_photo_updated_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_drivers_profile_photo ON drivers(profile_photo_url);
