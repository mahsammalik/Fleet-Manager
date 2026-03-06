-- Migration: Commission system – driver commission types and earnings/payments tables
-- Run after 002_soft_delete_drivers. Main schema lives in sql/schema.sql.

-- 1. Drivers: commission type and fixed/minimum amounts
ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS commission_type VARCHAR(50) DEFAULT 'percentage'
    CHECK (commission_type IN ('percentage', 'fixed_amount', 'hybrid')),
  ADD COLUMN IF NOT EXISTS fixed_commission_amount DECIMAL(10, 2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS minimum_commission DECIMAL(10, 2) DEFAULT 0.00;

-- 2. Earnings imports (parent for earnings_records; create first if missing)
CREATE TABLE IF NOT EXISTS earnings_imports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  file_name VARCHAR(255),
  import_date DATE NOT NULL,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  platform VARCHAR(50) NOT NULL CHECK (platform IN ('uber', 'bolt')),
  total_gross DECIMAL(12, 2),
  total_trips INTEGER,
  record_count INTEGER,
  imported_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Earnings records: add commission-related columns if missing
ALTER TABLE earnings_records
  ADD COLUMN IF NOT EXISTS company_commission DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS driver_payout DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS commission_type VARCHAR(50);

-- Ensure earnings_records.import_id references earnings_imports (if table was created without FK)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'earnings_records' AND constraint_name = 'earnings_records_import_id_fkey'
  ) AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'earnings_records' AND column_name = 'import_id') THEN
    ALTER TABLE earnings_records
      ADD CONSTRAINT earnings_records_import_id_fkey
      FOREIGN KEY (import_id) REFERENCES earnings_imports(id) ON DELETE CASCADE;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 4. Driver payments: add missing columns
ALTER TABLE driver_payments
  ADD COLUMN IF NOT EXISTS total_platform_fees DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS total_net_earnings DECIMAL(12, 2);

-- Add ON DELETE CASCADE to driver_payments FKs if not already (optional; skip if already set)
-- (Leaving as-is to avoid breaking existing data; schema.sql can define CASCADE for new installs.)

-- 5. Indexes
CREATE INDEX IF NOT EXISTS idx_earnings_imports_org ON earnings_imports(organization_id);
CREATE INDEX IF NOT EXISTS idx_earnings_records_import ON earnings_records(import_id);
CREATE INDEX IF NOT EXISTS idx_driver_payments_driver ON driver_payments(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_payments_period ON driver_payments(payment_period_start, payment_period_end);
