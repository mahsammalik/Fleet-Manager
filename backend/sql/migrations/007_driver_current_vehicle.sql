-- Migration: Add current_vehicle_id to drivers; add rental period index
-- Run after 006_vehicle_management.sql. Safe to re-run (uses IF NOT EXISTS where possible).

-- Update drivers table to track current vehicle
ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS current_vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL;

-- Index for lookups by current vehicle
CREATE INDEX IF NOT EXISTS idx_drivers_current_vehicle ON drivers(current_vehicle_id);

-- Index for rental period queries
CREATE INDEX IF NOT EXISTS idx_vehicle_rentals_period ON vehicle_rentals(rental_start_date, rental_end_date);
