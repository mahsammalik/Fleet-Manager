-- Migration: Add Glovo and Bolt Courier ID fields to drivers
-- Run after 003_commission_system. Main schema in sql/schema.sql.

ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS glovo_courier_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS bolt_courier_id VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_drivers_glovo_id ON drivers(glovo_courier_id);
CREATE INDEX IF NOT EXISTS idx_drivers_bolt_courier_id ON drivers(bolt_courier_id);
