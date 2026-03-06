-- Migration: Soft delete for drivers
-- Run this after the initial schema. Main schema is in sql/schema.sql.

-- Add soft delete columns to drivers
ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id);

-- Index for filtering non-deleted drivers
CREATE INDEX IF NOT EXISTS idx_drivers_is_deleted ON drivers(is_deleted);

-- driver_documents already has: FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE
-- No change needed there; soft delete does not remove rows, so CASCADE is for hard deletes only.
