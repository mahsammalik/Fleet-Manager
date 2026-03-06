-- Migration: Update document types – replace id_card with trc_card, add passport
-- Run after 004_glovo_bolt_courier_ids. Main schema in sql/schema.sql.

-- Migrate existing id_card rows to trc_card before changing constraint
UPDATE driver_documents SET document_type = 'trc_card' WHERE document_type = 'id_card';

-- Drop existing check constraint (name may vary; try the standard one)
ALTER TABLE driver_documents
  DROP CONSTRAINT IF EXISTS driver_documents_document_type_check;

-- Add new check constraint with trc_card and passport
ALTER TABLE driver_documents
  ADD CONSTRAINT driver_documents_document_type_check
  CHECK (document_type IN (
    'trc_card',
    'drivers_license',
    'contract',
    'insurance',
    'vehicle_permit',
    'passport',
    'other'
  ));

-- Index for document type (idempotent)
CREATE INDEX IF NOT EXISTS idx_driver_documents_type ON driver_documents(document_type);
