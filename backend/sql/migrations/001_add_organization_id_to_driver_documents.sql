-- Migration: Add organization_id to driver_documents (for existing databases)
-- Run this if driver_documents already exists without organization_id.

-- Add column (nullable first so we can backfill)
ALTER TABLE driver_documents
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

-- Backfill from drivers
UPDATE driver_documents d
SET organization_id = dr.organization_id
FROM drivers dr
WHERE d.driver_id = dr.id AND d.organization_id IS NULL;

-- Make non-nullable (optional; omit if you want to allow NULL for legacy rows)
-- ALTER TABLE driver_documents ALTER COLUMN organization_id SET NOT NULL;

-- Index for organization_id
CREATE INDEX IF NOT EXISTS idx_driver_documents_organization ON driver_documents(organization_id);
