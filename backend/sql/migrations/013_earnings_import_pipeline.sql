-- Earnings import: platform expansion, preview staging, import metadata, driver_payments period uniqueness

ALTER TABLE earnings_imports DROP CONSTRAINT IF EXISTS earnings_imports_platform_check;
ALTER TABLE earnings_imports
  ADD CONSTRAINT earnings_imports_platform_check
  CHECK (platform IN ('uber', 'bolt', 'glovo', 'bolt_courier', 'wolt_courier'));

ALTER TABLE earnings_imports
  ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'completed';
ALTER TABLE earnings_imports
  ADD COLUMN IF NOT EXISTS detection_meta JSONB;

ALTER TABLE earnings_imports DROP CONSTRAINT IF EXISTS earnings_imports_status_check;
ALTER TABLE earnings_imports
  ADD CONSTRAINT earnings_imports_status_check
  CHECK (status IN ('preview', 'completed', 'failed'));

CREATE TABLE IF NOT EXISTS earnings_import_staging (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  import_id UUID NOT NULL REFERENCES earnings_imports(id) ON DELETE CASCADE,
  row_index INTEGER NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_earnings_staging_import ON earnings_import_staging(import_id);
CREATE INDEX IF NOT EXISTS idx_earnings_staging_org ON earnings_import_staging(organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_payments_org_driver_period
  ON driver_payments (organization_id, driver_id, payment_period_start, payment_period_end);
