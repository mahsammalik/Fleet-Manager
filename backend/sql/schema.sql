-- Fleet Manager - Initial schema
-- Run the ENTIRE file once (e.g. psql -f sql/schema.sql or paste all in pgAdmin Query Tool).
-- If you see "relation X does not exist", the real error is usually earlier in the script; run from the start.

BEGIN;

-- Enable UUID extension (required for uuid_generate_v4())
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Organizations table
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE,
    phone VARCHAR(20),
    address TEXT,
    logo_url VARCHAR(500),
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- B2B subcontractors (manage driver groups; fleet bills rent + pays bulk to sub)
CREATE TABLE IF NOT EXISTS subcontractors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    legal_name VARCHAR(255) NOT NULL,
    registration_type VARCHAR(50) NOT NULL DEFAULT 'srl'
        CHECK (registration_type IN ('srl', 'sa', 'other')),
    registration_number VARCHAR(100),
    tax_id VARCHAR(100),
    email VARCHAR(255),
    phone VARCHAR(30),
    address TEXT,
    bank_name VARCHAR(255),
    bank_account_iban VARCHAR(100),
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    contract_start_date DATE,
    contract_end_date DATE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subcontractors_org ON subcontractors(organization_id);
CREATE INDEX IF NOT EXISTS idx_subcontractors_org_status ON subcontractors(organization_id, status);

-- Users table with roles: admin, accountant, driver
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'accountant', 'driver')),
    avatar_url VARCHAR(500),
    is_active BOOLEAN DEFAULT true,
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS drivers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID CONSTRAINT fk_drivers_organization REFERENCES organizations(id) ON DELETE CASCADE,
    subcontractor_id UUID REFERENCES subcontractors(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(20) NOT NULL,
    date_of_birth DATE,
    address TEXT,
    license_number VARCHAR(50),
    license_expiry DATE,
    license_class VARCHAR(20),
    hire_date DATE,
    employment_status VARCHAR(50) DEFAULT 'active' CHECK (employment_status IN ('active', 'suspended', 'terminated')),
    commission_rate DECIMAL(5, 2) DEFAULT 10.00,
    base_commission_rate DECIMAL(5, 2) DEFAULT 10.00,
    commission_type VARCHAR(50) DEFAULT 'percentage' CHECK (commission_type IN ('percentage', 'fixed_amount', 'hybrid')),
    fixed_commission_amount DECIMAL(10, 2) DEFAULT 0.00,
    minimum_commission DECIMAL(10, 2) DEFAULT 0.00,
    uber_driver_id VARCHAR(100),
    bolt_driver_id VARCHAR(100),
    glovo_courier_id VARCHAR(100),
    bolt_courier_id VARCHAR(100),
    wolt_courier_id VARCHAR(100),
    wolt_courier_verified BOOLEAN DEFAULT false,
    wolt_courier_verified_at TIMESTAMP,
    notes TEXT,
    profile_photo_url VARCHAR(500),
    profile_photo_updated_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Unique on (organization_id, license_number) only when license_number is set
CREATE UNIQUE INDEX IF NOT EXISTS idx_drivers_org_license
    ON drivers (organization_id, license_number)
    WHERE license_number IS NOT NULL;

-- Driver documents
CREATE TABLE IF NOT EXISTS driver_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    driver_id UUID REFERENCES drivers(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    document_type VARCHAR(50) NOT NULL CHECK (document_type IN ('trc_card', 'drivers_license', 'contract', 'insurance', 'vehicle_permit', 'passport', 'other')),
    file_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_size INTEGER,
    mime_type VARCHAR(100),
    expiry_date DATE,
    is_verified BOOLEAN DEFAULT false,
    verified_by UUID REFERENCES users(id),
    verified_at TIMESTAMP,
    uploaded_by UUID REFERENCES users(id),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_organization ON users(organization_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_drivers_organization ON drivers(organization_id);
CREATE INDEX IF NOT EXISTS idx_drivers_subcontractor ON drivers(subcontractor_id) WHERE subcontractor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_drivers_status ON drivers(employment_status);
CREATE INDEX IF NOT EXISTS idx_drivers_profile_photo ON drivers(profile_photo_url);
CREATE INDEX IF NOT EXISTS idx_drivers_glovo_id ON drivers(glovo_courier_id);
CREATE INDEX IF NOT EXISTS idx_drivers_bolt_courier_id ON drivers(bolt_courier_id);
CREATE INDEX IF NOT EXISTS idx_drivers_wolt_courier_id ON drivers(wolt_courier_id);
CREATE INDEX IF NOT EXISTS idx_driver_documents_driver ON driver_documents(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_documents_organization ON driver_documents(organization_id);
CREATE INDEX IF NOT EXISTS idx_driver_documents_type ON driver_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_driver_documents_verified ON driver_documents(is_verified);

-- Driver activity history
CREATE TABLE IF NOT EXISTS driver_activities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    driver_id UUID REFERENCES drivers(id) ON DELETE CASCADE,
    activity_type VARCHAR(50) NOT NULL,
    activity_description TEXT,
    performed_by UUID REFERENCES users(id),
    old_values JSONB,
    new_values JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_driver_activities_driver ON driver_activities(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_activities_created ON driver_activities(created_at DESC);

-- Earnings imports (must exist before earnings_records)
CREATE TABLE IF NOT EXISTS earnings_imports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    file_name VARCHAR(255),
    import_date DATE NOT NULL,
    week_start DATE NOT NULL,
    week_end DATE NOT NULL,
    platform VARCHAR(50) NOT NULL CHECK (platform IN ('uber', 'bolt', 'glovo', 'bolt_courier', 'wolt_courier')),
    total_gross DECIMAL(12, 2),
    total_trips INTEGER,
    record_count INTEGER,
    imported_by UUID REFERENCES users(id),
    status VARCHAR(50) NOT NULL DEFAULT 'completed' CHECK (status IN ('preview', 'completed', 'failed')),
    detection_meta JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS earnings_import_staging (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    import_id UUID NOT NULL REFERENCES earnings_imports(id) ON DELETE CASCADE,
    row_index INTEGER NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS earnings_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    import_id UUID REFERENCES earnings_imports(id) ON DELETE CASCADE,
    driver_id UUID REFERENCES drivers(id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL,
    trip_date DATE NOT NULL,
    trip_count INTEGER,
    gross_earnings DECIMAL(10, 2),
    platform_fee DECIMAL(10, 2),
    -- Net after fleet commission on import (matches driver_payout; not raw platform net)
    net_earnings DECIMAL(10, 2),
    total_transfer_earnings DECIMAL(10, 2),
    daily_cash DECIMAL(10, 2),
    account_opening_fee DECIMAL(10, 2),
    has_cash_commission BOOLEAN GENERATED ALWAYS AS (COALESCE(daily_cash, 0) <> 0) STORED,
    company_commission DECIMAL(10, 2),
    commission_base NUMERIC(12, 6),
    tips DECIMAL(10, 2),
    driver_payout DECIMAL(10, 2),
    driver_payout_after_cash DECIMAL(10, 2)
      GENERATED ALWAYS AS (
        ROUND(
          (
            CASE
              WHEN COALESCE(platform_fee, 0) < 0 THEN
                COALESCE(gross_earnings, 0) + COALESCE(tips, 0) + COALESCE(platform_fee, 0)
              ELSE
                COALESCE(gross_earnings, 0) + COALESCE(tips, 0) - COALESCE(platform_fee, 0)
            END
            - COALESCE(company_commission, 0)
            - ABS(COALESCE(daily_cash, 0))
          )::numeric,
          2
        )
      ) STORED,
    commission_type VARCHAR(50),
    vehicle_rental_id UUID,
    vehicle_rental_fee DECIMAL(10, 2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Driver payouts (period rollups)
CREATE TABLE IF NOT EXISTS driver_payouts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    driver_id UUID REFERENCES drivers(id) ON DELETE CASCADE,
    platform_id VARCHAR(255),
    payment_period_start DATE NOT NULL,
    payment_period_end DATE NOT NULL,
    income NUMERIC(12, 6) NOT NULL DEFAULT 0,
    tips NUMERIC(12, 6) NOT NULL DEFAULT 0,
    total_gross_earnings NUMERIC(12, 6) GENERATED ALWAYS AS (income + tips) STORED,
    total_platform_fees DECIMAL(10, 2),
    total_net_earnings DECIMAL(12, 2),
    total_daily_cash DECIMAL(12, 2) DEFAULT 0,
    account_opening_fee NUMERIC(12, 6) DEFAULT 0,
    company_commission DECIMAL(10, 2),
    gross_income NUMERIC(12, 6),
    net_income NUMERIC(12, 6),
    commission_base NUMERIC(12, 6),
    commission_rate NUMERIC(6, 5),
    commission_base_type VARCHAR(50) DEFAULT 'net_income',
    bonuses DECIMAL(10, 2) DEFAULT 0,
    penalties DECIMAL(10, 2) DEFAULT 0,
    adjustments DECIMAL(10, 2) DEFAULT 0,
    raw_net_amount DECIMAL(12, 2) DEFAULT 0,
    debt_amount DECIMAL(12, 2) DEFAULT 0,
    debt_applied_amount DECIMAL(12, 2) DEFAULT 0,
    remaining_debt_amount DECIMAL(12, 2) DEFAULT 0,
    net_driver_payout DECIMAL(10, 2),
    vehicle_rental_id UUID,
    vehicle_rental_fee DECIMAL(12, 2) DEFAULT 0,
    payment_status VARCHAR(50) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'processing', 'approved', 'paid', 'failed', 'hold', 'debt')),
    payment_date DATE,
    payment_method VARCHAR(50),
    transaction_ref VARCHAR(100),
    notes TEXT,
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subcontractor_rent_charges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    subcontractor_id UUID NOT NULL REFERENCES subcontractors(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'invoiced', 'paid', 'waived')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_subcontractor_rent_charge_period UNIQUE (organization_id, subcontractor_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_sub_rent_charges_org_period ON subcontractor_rent_charges(organization_id, period_start, period_end);

-- Payment tracking only; financial totals are SUM(driver_payouts.*), not stored here.
CREATE TABLE IF NOT EXISTS subcontractor_payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    subcontractor_id UUID NOT NULL REFERENCES subcontractors(id) ON DELETE CASCADE,
    payment_period_start DATE NOT NULL,
    payment_period_end DATE NOT NULL,
    payment_status VARCHAR(30) NOT NULL DEFAULT 'pending'
        CHECK (payment_status IN ('pending', 'paid', 'partial', 'overdue', 'cancelled')),
    payment_date DATE,
    payment_method VARCHAR(50),
    payment_reference VARCHAR(150),
    paid_amount NUMERIC(12, 2),
    notes TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_subcontractor_payout_period UNIQUE (
        organization_id, subcontractor_id, payment_period_start, payment_period_end
    )
);

CREATE INDEX IF NOT EXISTS idx_sub_payouts_org_period
    ON subcontractor_payouts(organization_id, payment_period_start, payment_period_end);
CREATE INDEX IF NOT EXISTS idx_sub_payouts_org_status
    ON subcontractor_payouts(organization_id, payment_status);
CREATE INDEX IF NOT EXISTS idx_sub_payouts_subcontractor
    ON subcontractor_payouts(subcontractor_id);

ALTER TABLE driver_payouts
    ADD COLUMN IF NOT EXISTS subcontractor_payout_id UUID REFERENCES subcontractor_payouts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_driver_payouts_sub_payout
    ON driver_payouts(subcontractor_payout_id) WHERE subcontractor_payout_id IS NOT NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_earnings_imports_org ON earnings_imports(organization_id);
CREATE INDEX IF NOT EXISTS idx_earnings_staging_import ON earnings_import_staging(import_id);
CREATE INDEX IF NOT EXISTS idx_earnings_staging_org ON earnings_import_staging(organization_id);
CREATE INDEX IF NOT EXISTS idx_earnings_records_driver ON earnings_records(driver_id);
CREATE INDEX IF NOT EXISTS idx_earnings_records_date ON earnings_records(trip_date);
CREATE INDEX IF NOT EXISTS idx_earnings_records_import ON earnings_records(import_id);
CREATE INDEX IF NOT EXISTS idx_earnings_records_vehicle_rental ON earnings_records(vehicle_rental_id)
    WHERE vehicle_rental_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_driver_payouts_driver ON driver_payouts(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_payouts_platform_id ON driver_payouts(platform_id);
CREATE INDEX IF NOT EXISTS idx_driver_payouts_status ON driver_payouts(payment_status);
CREATE INDEX IF NOT EXISTS idx_driver_payouts_period ON driver_payouts(payment_period_start, payment_period_end);
CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_payouts_org_driver_period ON driver_payouts (organization_id, driver_id, payment_period_start, payment_period_end);

-- Manual debt adjustments (audit)
CREATE TABLE IF NOT EXISTS payout_adjustments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    payout_id UUID NOT NULL REFERENCES driver_payouts(id) ON DELETE CASCADE,
    amount NUMERIC(12, 2) NOT NULL,
    reason TEXT,
    adjustment_type VARCHAR(32) NOT NULL
        CHECK (adjustment_type IN ('adjust', 'forgive', 'cash_received', 'carry_forward')),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    previous_remaining_debt NUMERIC(12, 2),
    new_remaining_debt NUMERIC(12, 2),
    applied_amount NUMERIC(12, 2)
);

CREATE INDEX IF NOT EXISTS idx_payout_adjustments_org_payout
    ON payout_adjustments (organization_id, payout_id);

CREATE INDEX IF NOT EXISTS idx_payout_adjustments_org_created
    ON payout_adjustments (organization_id, created_at DESC);

-- Vehicles (company-owned, rented to drivers)
CREATE TABLE IF NOT EXISTS vehicles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID CONSTRAINT fk_vehicles_organization REFERENCES organizations(id) ON DELETE CASCADE,
    vehicle_type VARCHAR(50) NOT NULL,
    make VARCHAR(100) NOT NULL,
    model VARCHAR(100) NOT NULL,
    year INTEGER,
    color VARCHAR(50),
    license_plate VARCHAR(20) NOT NULL,
    vin VARCHAR(100),
    fuel_type VARCHAR(50),
    transmission VARCHAR(50),
    seating_capacity INTEGER,
    daily_rent DECIMAL(10, 2) DEFAULT 0.00,
    weekly_rent DECIMAL(10, 2) DEFAULT 0.00,
    monthly_rent DECIMAL(10, 2) DEFAULT 0.00,
    insurance_expiry DATE,
    registration_expiry DATE,
    status VARCHAR(50) DEFAULT 'available'
        CHECK (status IN ('available', 'rented', 'maintenance', 'sold', 'scrapped')),
    current_driver_id UUID CONSTRAINT fk_vehicles_current_driver REFERENCES drivers(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Drivers: track current vehicle (must run after vehicles table exists)
ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS current_vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_drivers_current_vehicle ON drivers(current_vehicle_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_org_license
    ON vehicles (organization_id, license_plate);

CREATE INDEX IF NOT EXISTS idx_vehicles_organization ON vehicles(organization_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_status ON vehicles(status);
CREATE INDEX IF NOT EXISTS idx_vehicles_license_plate ON vehicles(license_plate);
CREATE INDEX IF NOT EXISTS idx_vehicles_current_driver ON vehicles(current_driver_id);

-- Vehicle rentals
CREATE TABLE IF NOT EXISTS vehicle_rentals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id UUID CONSTRAINT fk_rentals_vehicle REFERENCES vehicles(id) ON DELETE CASCADE,
    driver_id UUID CONSTRAINT fk_rentals_driver REFERENCES drivers(id) ON DELETE CASCADE,
    organization_id UUID CONSTRAINT fk_rentals_organization REFERENCES organizations(id) ON DELETE CASCADE,
    rental_start_date DATE NOT NULL,
    rental_end_date DATE NOT NULL,
    rental_type VARCHAR(50) DEFAULT 'daily'
        CHECK (rental_type IN ('daily', 'weekly', 'monthly')),
    total_rent_amount DECIMAL(10, 2),
    deposit_amount DECIMAL(10, 2) DEFAULT 0.00,
    deposit_status VARCHAR(50) DEFAULT 'pending'
        CHECK (deposit_status IN ('pending', 'paid', 'refunded', 'partial')),
    deposit_paid_at TIMESTAMP,
    deposit_refunded_at TIMESTAMP,
    deposit_deduction_amount DECIMAL(10, 2) DEFAULT 0.00,
    deposit_deduction_reason TEXT,
    payment_status VARCHAR(50) DEFAULT 'pending'
        CHECK (payment_status IN ('pending', 'paid', 'partial', 'overdue')),
    payment_date DATE,
    payment_method VARCHAR(50),
    payment_reference VARCHAR(100),
    rent_paid_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    is_recurring BOOLEAN DEFAULT false,
    auto_renew_interval INTEGER DEFAULT 7,
    max_renewal_date DATE,
    renewed_from_id UUID REFERENCES vehicle_rentals(id),
    status VARCHAR(50) DEFAULT 'active'
        CHECK (status IN ('active', 'completed', 'cancelled', 'overdue')),
    notes TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rentals_vehicle ON vehicle_rentals(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_rentals_driver ON vehicle_rentals(driver_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_rentals_organization ON vehicle_rentals(organization_id);
CREATE INDEX IF NOT EXISTS idx_rentals_status ON vehicle_rentals(status);
CREATE INDEX IF NOT EXISTS idx_vehicle_rentals_period ON vehicle_rentals(rental_start_date, rental_end_date);
CREATE INDEX IF NOT EXISTS idx_vehicle_rentals_renewal
    ON vehicle_rentals(rental_end_date, is_recurring, status)
    WHERE is_recurring = true AND status = 'active';

CREATE TABLE IF NOT EXISTS payout_rent_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_payout_id UUID NOT NULL REFERENCES driver_payouts(id) ON DELETE CASCADE,
    vehicle_rental_id UUID REFERENCES vehicle_rentals(id) ON DELETE SET NULL,
    entry_type VARCHAR(50) NOT NULL CHECK (entry_type IN ('current_week', 'overdue', 'adjustment')),
    amount NUMERIC(12, 2) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payout_rent_entries_payout ON payout_rent_entries(driver_payout_id);
CREATE INDEX IF NOT EXISTS idx_payout_rent_entries_rental ON payout_rent_entries(vehicle_rental_id);

ALTER TABLE earnings_records DROP CONSTRAINT IF EXISTS fk_earnings_records_vehicle_rental;
ALTER TABLE earnings_records
    ADD CONSTRAINT fk_earnings_records_vehicle_rental
    FOREIGN KEY (vehicle_rental_id) REFERENCES vehicle_rentals(id) ON DELETE SET NULL;

ALTER TABLE driver_payouts DROP CONSTRAINT IF EXISTS fk_driver_payouts_vehicle_rental;
ALTER TABLE driver_payouts
    ADD CONSTRAINT fk_driver_payouts_vehicle_rental
    FOREIGN KEY (vehicle_rental_id) REFERENCES vehicle_rentals(id) ON DELETE SET NULL;

-- Deposit transactions for rentals
CREATE TABLE IF NOT EXISTS deposit_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rental_id UUID REFERENCES vehicle_rentals(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    transaction_type VARCHAR(50) NOT NULL
        CHECK (transaction_type IN ('payment', 'refund', 'deduction')),
    amount DECIMAL(10, 2) NOT NULL,
    payment_method VARCHAR(50) DEFAULT 'cash',
    payment_status VARCHAR(50) DEFAULT 'completed'
        CHECK (payment_status IN ('pending', 'completed', 'failed')),
    transaction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_deposit_transactions_rental ON deposit_transactions(rental_id);
CREATE INDEX IF NOT EXISTS idx_deposit_transactions_status ON deposit_transactions(payment_status);
CREATE INDEX IF NOT EXISTS idx_deposit_transactions_date ON deposit_transactions(transaction_date);

-- Rent payments ledger: links payroll-deducted rent (driver_payouts) to vehicle_rentals
-- with per-rental allocation. UNIQUE (driver_payout_id, vehicle_rental_id) keeps
-- mark-as-paid idempotent across retries.
CREATE TABLE IF NOT EXISTS rent_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL CONSTRAINT fk_rent_payments_org
        REFERENCES organizations(id) ON DELETE CASCADE,
    vehicle_rental_id UUID NOT NULL CONSTRAINT fk_rent_payments_rental
        REFERENCES vehicle_rentals(id) ON DELETE CASCADE,
    driver_payout_id UUID NOT NULL CONSTRAINT fk_rent_payments_payout
        REFERENCES driver_payouts(id) ON DELETE CASCADE,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    payment_method VARCHAR(50) NOT NULL DEFAULT 'payroll_deduction',
    paid_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_rent_payments_payout_rental UNIQUE (driver_payout_id, vehicle_rental_id)
);

CREATE INDEX IF NOT EXISTS idx_rent_payments_rental ON rent_payments(vehicle_rental_id);
CREATE INDEX IF NOT EXISTS idx_rent_payments_payout ON rent_payments(driver_payout_id);
CREATE INDEX IF NOT EXISTS idx_rent_payments_org_paid_at ON rent_payments(organization_id, paid_at);

-- Vehicle maintenance
CREATE TABLE IF NOT EXISTS vehicle_maintenance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    maintenance_type VARCHAR(50) NOT NULL,
    description TEXT,
    cost DECIMAL(10, 2),
    scheduled_date DATE,
    completed_date DATE,
    status VARCHAR(50) DEFAULT 'pending'
        CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
    mechanic_name VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_vehicle ON vehicle_maintenance(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_status ON vehicle_maintenance(status);

-- Vehicle documents
CREATE TABLE IF NOT EXISTS vehicle_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    document_type VARCHAR(50) NOT NULL,
    document_number VARCHAR(100),
    file_name VARCHAR(255),
    file_path VARCHAR(500),
    file_size INTEGER,
    expiry_date DATE,
    issue_date DATE,
    is_verified BOOLEAN DEFAULT false,
    verified_by UUID REFERENCES users(id),
    verified_at TIMESTAMP,
    notes TEXT,
    uploaded_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_vehicle_documents_vehicle ON vehicle_documents(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_documents_type ON vehicle_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_vehicle_documents_expiry ON vehicle_documents(expiry_date);
CREATE INDEX IF NOT EXISTS idx_vehicle_documents_verified ON vehicle_documents(is_verified);
CREATE INDEX IF NOT EXISTS idx_vehicle_documents_organization ON vehicle_documents(organization_id);

-- Match earnings row to vehicle rental by driver + trip_date (full total_rent_amount, or vehicle.daily_rent if amount unset).
CREATE OR REPLACE FUNCTION earnings_records_match_vehicle_rental()
RETURNS TRIGGER AS $$
DECLARE
  rid UUID;
  v_total NUMERIC(12, 2);
  v_vehicle_id UUID;
  daily_rent NUMERIC(10, 2);
  sub_id UUID;
BEGIN
  IF NEW.driver_id IS NULL OR NEW.trip_date IS NULL THEN
    NEW.vehicle_rental_id := NULL;
    NEW.vehicle_rental_fee := NULL;
    RETURN NEW;
  END IF;

  SELECT d.subcontractor_id INTO sub_id FROM drivers d WHERE d.id = NEW.driver_id;
  IF sub_id IS NOT NULL THEN
    NEW.vehicle_rental_id := NULL;
    NEW.vehicle_rental_fee := NULL;
    RETURN NEW;
  END IF;

  SELECT v.id, v.total_rent_amount, v.vehicle_id
  INTO rid, v_total, v_vehicle_id
  FROM vehicle_rentals v
  INNER JOIN drivers d ON d.id = NEW.driver_id AND d.organization_id = v.organization_id
  WHERE v.driver_id = NEW.driver_id
    AND NEW.trip_date >= v.rental_start_date
    AND NEW.trip_date <= v.rental_end_date
    AND v.status IN ('active', 'completed')
  ORDER BY v.rental_start_date DESC, v.id
  LIMIT 1;

  IF rid IS NULL THEN
    NEW.vehicle_rental_id := NULL;
    NEW.vehicle_rental_fee := NULL;
    RETURN NEW;
  END IF;

  NEW.vehicle_rental_id := rid;

  IF v_total IS NOT NULL THEN
    NEW.vehicle_rental_fee := ROUND(v_total::numeric, 2);
  ELSE
    SELECT ve.daily_rent INTO daily_rent FROM vehicles ve WHERE ve.id = v_vehicle_id;
    IF daily_rent IS NULL THEN
      NEW.vehicle_rental_fee := NULL;
    ELSE
      NEW.vehicle_rental_fee := ROUND(daily_rent::numeric, 2);
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_earnings_records_match_vehicle_rental ON earnings_records;
CREATE TRIGGER trg_earnings_records_match_vehicle_rental
  BEFORE INSERT OR UPDATE OF driver_id, trip_date ON earnings_records
  FOR EACH ROW
  EXECUTE FUNCTION earnings_records_match_vehicle_rental();

CREATE OR REPLACE FUNCTION calculate_rental_fee(
  p_organization_id UUID,
  p_driver_id UUID,
  p_week_start DATE,
  p_week_end DATE,
  p_ignore_subcontractor BOOLEAN DEFAULT false
) RETURNS NUMERIC AS $$
DECLARE
  sum_fee NUMERIC(14, 6) := 0;
  rec RECORD;
  overlap_days INT;
  rental_span INT;
  daily_amt NUMERIC(14, 6);
  piece NUMERIC(14, 6);
BEGIN
  IF NOT p_ignore_subcontractor THEN
    IF EXISTS (
      SELECT 1 FROM drivers d
      WHERE d.id = p_driver_id AND d.subcontractor_id IS NOT NULL
    ) THEN
      RETURN 0;
    END IF;
  END IF;

  FOR rec IN
    SELECT
      vr.rental_start_date,
      vr.rental_end_date,
      vr.rental_type,
      vr.total_rent_amount,
      vr.vehicle_id
    FROM vehicle_rentals vr
    WHERE vr.organization_id = p_organization_id
      AND vr.driver_id = p_driver_id
      AND vr.status IN ('active', 'completed')
      AND vr.rental_end_date >= p_week_start
      AND vr.rental_start_date <= p_week_end
  LOOP
    overlap_days := (LEAST(rec.rental_end_date, p_week_end)
      - GREATEST(rec.rental_start_date, p_week_start) + 1)::INT;
    IF overlap_days <= 0 THEN
      CONTINUE;
    END IF;

    rental_span := GREATEST((rec.rental_end_date - rec.rental_start_date + 1), 1);

    IF rec.rental_type = 'weekly' AND rec.total_rent_amount IS NOT NULL THEN
      piece := rec.total_rent_amount::numeric * overlap_days::numeric / 7::numeric;
    ELSIF rec.rental_type = 'monthly' AND rec.total_rent_amount IS NOT NULL THEN
      piece := rec.total_rent_amount::numeric * overlap_days::numeric / rental_span::numeric;
    ELSIF rec.total_rent_amount IS NOT NULL THEN
      piece := rec.total_rent_amount::numeric * overlap_days::numeric / rental_span::numeric;
    ELSE
      SELECT ve.daily_rent::numeric INTO daily_amt FROM vehicles ve WHERE ve.id = rec.vehicle_id;
      IF daily_amt IS NULL THEN
        piece := 0;
      ELSE
        piece := daily_amt * overlap_days::numeric;
      END IF;
    END IF;

    sum_fee := sum_fee + ROUND(COALESCE(piece, 0)::numeric, 2);
  END LOOP;

  RETURN ROUND(COALESCE(sum_fee, 0)::numeric, 2);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION calculate_rental_fee(UUID, UUID, DATE, DATE, BOOLEAN) IS
  'Fleet-week vehicle rent for driver payroll. Returns 0 when driver is sub-managed unless p_ignore_subcontractor is true.';

-- Per-rental breakdown of calculate_rental_fee math. Returns one row per contributing
-- rental with its prorated piece. Sum of rows for the same (org, driver, week) equals
-- calculate_rental_fee(...) within rounding. Used by mark-as-paid to write rent_payments.
CREATE OR REPLACE FUNCTION allocate_rental_fee(
  p_organization_id UUID,
  p_driver_id UUID,
  p_week_start DATE,
  p_week_end DATE
) RETURNS TABLE (vehicle_rental_id UUID, amount NUMERIC) AS $$
DECLARE
  rec RECORD;
  overlap_days INT;
  rental_span INT;
  daily_amt NUMERIC(14, 6);
  piece NUMERIC(14, 6);
BEGIN
  IF EXISTS (
    SELECT 1 FROM drivers d WHERE d.id = p_driver_id AND d.subcontractor_id IS NOT NULL
  ) THEN
    RETURN;
  END IF;

  FOR rec IN
    SELECT vr.id, vr.rental_start_date, vr.rental_end_date, vr.rental_type,
           vr.total_rent_amount, vr.vehicle_id
    FROM vehicle_rentals vr
    WHERE vr.organization_id = p_organization_id
      AND vr.driver_id = p_driver_id
      AND vr.status IN ('active', 'completed')
      AND vr.rental_end_date >= p_week_start
      AND vr.rental_start_date <= p_week_end
  LOOP
    overlap_days := (LEAST(rec.rental_end_date, p_week_end)
      - GREATEST(rec.rental_start_date, p_week_start) + 1)::INT;
    IF overlap_days <= 0 THEN
      CONTINUE;
    END IF;

    rental_span := GREATEST((rec.rental_end_date - rec.rental_start_date + 1), 1);

    IF rec.rental_type = 'weekly' AND rec.total_rent_amount IS NOT NULL THEN
      piece := rec.total_rent_amount::numeric * overlap_days::numeric / 7::numeric;
    ELSIF rec.total_rent_amount IS NOT NULL THEN
      piece := rec.total_rent_amount::numeric * overlap_days::numeric / rental_span::numeric;
    ELSE
      SELECT ve.daily_rent::numeric INTO daily_amt FROM vehicles ve WHERE ve.id = rec.vehicle_id;
      IF daily_amt IS NULL THEN
        piece := 0;
      ELSE
        piece := daily_amt * overlap_days::numeric;
      END IF;
    END IF;

    piece := ROUND(COALESCE(piece, 0)::numeric, 2);
    IF piece > 0 THEN
      vehicle_rental_id := rec.id;
      amount := piece;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION allocate_rental_fee(UUID, UUID, DATE, DATE) IS
    'Per-rental breakdown of calculate_rental_fee: returns (rental_id, prorated_amount) rows.';

CREATE OR REPLACE FUNCTION allocate_vehicle_rent_pieces(
    p_organization_id UUID,
    p_driver_id UUID,
    p_week_start DATE,
    p_week_end DATE,
    p_include_completed BOOLEAN
) RETURNS TABLE (vehicle_rental_id UUID, amount NUMERIC) AS $$
DECLARE
    rec RECORD;
    overlap_days INT;
    rental_span INT;
    daily_amt NUMERIC(14, 6);
    piece NUMERIC(14, 6);
BEGIN
    IF EXISTS (
      SELECT 1 FROM drivers d WHERE d.id = p_driver_id AND d.subcontractor_id IS NOT NULL
    ) THEN
      RETURN;
    END IF;

    FOR rec IN
        SELECT vr.id, vr.rental_start_date, vr.rental_end_date, vr.rental_type,
               vr.total_rent_amount, vr.vehicle_id
        FROM vehicle_rentals vr
        WHERE vr.organization_id = p_organization_id
          AND vr.driver_id = p_driver_id
          AND (
            CASE WHEN p_include_completed
              THEN vr.status IN ('active', 'completed')
              ELSE vr.status = 'active'
            END
          )
          AND vr.rental_end_date >= p_week_start
          AND vr.rental_start_date <= p_week_end
    LOOP
        overlap_days := (LEAST(rec.rental_end_date, p_week_end)
            - GREATEST(rec.rental_start_date, p_week_start) + 1)::INT;
        IF overlap_days <= 0 THEN
            CONTINUE;
        END IF;

        rental_span := GREATEST((rec.rental_end_date - rec.rental_start_date + 1), 1);

        IF rec.rental_type = 'weekly' AND rec.total_rent_amount IS NOT NULL THEN
            piece := rec.total_rent_amount::numeric * overlap_days::numeric / 7::numeric;
        ELSIF rec.rental_type = 'monthly' AND rec.total_rent_amount IS NOT NULL THEN
            piece := rec.total_rent_amount::numeric * overlap_days::numeric / rental_span::numeric;
        ELSIF rec.total_rent_amount IS NOT NULL THEN
            piece := rec.total_rent_amount::numeric * overlap_days::numeric / rental_span::numeric;
        ELSE
            SELECT ve.daily_rent::numeric INTO daily_amt FROM vehicles ve WHERE ve.id = rec.vehicle_id;
            IF daily_amt IS NULL THEN
                piece := 0;
            ELSE
                piece := daily_amt * overlap_days::numeric;
            END IF;
        END IF;

        piece := ROUND(COALESCE(piece, 0)::numeric, 2);
        IF piece > 0 THEN
            vehicle_rental_id := rec.id;
            amount := piece;
            RETURN NEXT;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION allocate_vehicle_rent_pieces(UUID, UUID, DATE, DATE, BOOLEAN) IS
    'Fleet-week proration per rental; active-only vs active+completed via flag (matches calculate_rental_fee math).';

CREATE OR REPLACE FUNCTION refresh_subcontractor_rent_charges(
  p_organization_id UUID,
  p_period_start DATE,
  p_period_end DATE
) RETURNS INTEGER AS $$
DECLARE
  n INT := 0;
  r RECORD;
  amt NUMERIC(12, 2);
BEGIN
  FOR r IN
    SELECT s.id AS subcontractor_id
    FROM subcontractors s
    WHERE s.organization_id = p_organization_id
      AND s.status = 'active'
  LOOP
    SELECT ROUND(COALESCE(SUM(
      calculate_rental_fee(p_organization_id, d.id, p_period_start, p_period_end, true)
    ), 0)::numeric, 2) INTO amt
    FROM drivers d
    WHERE d.organization_id = p_organization_id
      AND d.subcontractor_id = r.subcontractor_id;

    IF COALESCE(amt, 0) = 0 THEN
      DELETE FROM subcontractor_rent_charges c
      WHERE c.organization_id = p_organization_id
        AND c.subcontractor_id = r.subcontractor_id
        AND c.period_start = p_period_start
        AND c.period_end = p_period_end;
    ELSE
      INSERT INTO subcontractor_rent_charges (
        organization_id, subcontractor_id, period_start, period_end, amount, status, notes
      ) VALUES (
        p_organization_id, r.subcontractor_id, p_period_start, p_period_end, amt, 'pending',
        'Prorated vehicle rent for sub-managed drivers (period)'
      )
      ON CONFLICT (organization_id, subcontractor_id, period_start, period_end)
      DO UPDATE SET
        amount = EXCLUDED.amount,
        updated_at = NOW();
    END IF;
    n := n + 1;
  END LOOP;

  RETURN n;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION refresh_subcontractor_rent_charges(UUID, DATE, DATE) IS
  'Rebuild subcontractor_rent_charges for all active subs in an org for the given inclusive period.';

CREATE OR REPLACE FUNCTION subcontractor_settlement_totals(
    p_organization_id UUID,
    p_period_start DATE,
    p_period_end DATE
) RETURNS TABLE (
    subcontractor_id UUID,
    driver_payout_count INT,
    total_gross_income NUMERIC(12, 2),
    total_tips NUMERIC(12, 2),
    total_commission NUMERIC(12, 2),
    total_vehicle_rent NUMERIC(12, 2),
    total_account_opening_fee NUMERIC(12, 2),
    total_platform_fees NUMERIC(12, 2),
    total_daily_cash NUMERIC(12, 2),
    total_payable NUMERIC(12, 2)
) AS $$
BEGIN
    RETURN QUERY
    SELECT d.subcontractor_id,
           COUNT(*)::int,
           ROUND(COALESCE(SUM(dp.total_gross_earnings), 0)::numeric, 2),
           ROUND(COALESCE(SUM(dp.tips), 0)::numeric, 2),
           ROUND(COALESCE(SUM(dp.company_commission), 0)::numeric, 2),
           ROUND(COALESCE(SUM(dp.vehicle_rental_fee), 0)::numeric, 2),
           ROUND(COALESCE(SUM(dp.account_opening_fee), 0)::numeric, 2),
           ROUND(COALESCE(SUM(dp.total_platform_fees), 0)::numeric, 2),
           ROUND(COALESCE(SUM(dp.total_daily_cash), 0)::numeric, 2),
           ROUND(COALESCE(SUM(dp.net_driver_payout), 0)::numeric, 2)
    FROM driver_payouts dp
    INNER JOIN drivers d
      ON d.id = dp.driver_id
     AND d.organization_id = dp.organization_id
    WHERE dp.organization_id = p_organization_id
      AND dp.payment_period_start = p_period_start
      AND dp.payment_period_end = p_period_end
      AND d.subcontractor_id IS NOT NULL
    GROUP BY d.subcontractor_id;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION subcontractor_settlement_totals(UUID, DATE, DATE) IS
    'Per-subcontractor SUM of driver_payouts for the period. total_commission = SUM(company_commission); total_payable = SUM(net_driver_payout). subcontractor_payouts has no commission columns.';

CREATE OR REPLACE FUNCTION refresh_subcontractor_payouts(
    p_organization_id UUID,
    p_period_start DATE,
    p_period_end DATE
) RETURNS INTEGER AS $$
DECLARE
    n INT := 0;
    r RECORD;
    sp_id UUID;
BEGIN
    DELETE FROM subcontractor_payouts sp
    WHERE sp.organization_id = p_organization_id
      AND sp.payment_period_start = p_period_start
      AND sp.payment_period_end = p_period_end
      AND NOT EXISTS (
          SELECT 1
          FROM driver_payouts dp
          INNER JOIN drivers d
            ON d.id = dp.driver_id
           AND d.organization_id = dp.organization_id
           AND d.subcontractor_id = sp.subcontractor_id
          WHERE dp.organization_id = p_organization_id
            AND dp.payment_period_start = p_period_start
            AND dp.payment_period_end = p_period_end
      );

    FOR r IN
        SELECT DISTINCT d.subcontractor_id AS sid
        FROM driver_payouts dp
        INNER JOIN drivers d
          ON d.id = dp.driver_id
         AND d.organization_id = dp.organization_id
        WHERE dp.organization_id = p_organization_id
          AND dp.payment_period_start = p_period_start
          AND dp.payment_period_end = p_period_end
          AND d.subcontractor_id IS NOT NULL
    LOOP
        INSERT INTO subcontractor_payouts (
            organization_id,
            subcontractor_id,
            payment_period_start,
            payment_period_end
        ) VALUES (
            p_organization_id,
            r.sid,
            p_period_start,
            p_period_end
        )
        ON CONFLICT ON CONSTRAINT uq_subcontractor_payout_period
        DO UPDATE SET updated_at = NOW()
        RETURNING id INTO sp_id;

        UPDATE driver_payouts dp
        SET subcontractor_payout_id = sp_id
        FROM drivers d
        WHERE d.id = dp.driver_id
          AND d.organization_id = dp.organization_id
          AND d.subcontractor_id = r.sid
          AND dp.organization_id = p_organization_id
          AND dp.payment_period_start = p_period_start
          AND dp.payment_period_end = p_period_end;
        n := n + 1;
    END LOOP;

    UPDATE driver_payouts dp
    SET subcontractor_payout_id = NULL
    FROM drivers d
    WHERE d.id = dp.driver_id
      AND d.organization_id = dp.organization_id
      AND dp.organization_id = p_organization_id
      AND dp.payment_period_start = p_period_start
      AND dp.payment_period_end = p_period_end
      AND d.subcontractor_id IS NULL
      AND dp.subcontractor_payout_id IS NOT NULL;

    RETURN n;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION refresh_subcontractor_payouts(UUID, DATE, DATE) IS
    'Ensure payment-tracking subcontractor_payouts rows exist and link sub-managed driver_payouts; does not store financial totals.';

CREATE OR REPLACE FUNCTION refresh_driver_payout_vehicle_fees(p_org_id UUID)
RETURNS INTEGER AS $$
DECLARE
  n INT;
BEGIN
  UPDATE driver_payouts dp
  SET
    vehicle_rental_fee = rf.calc,
    raw_net_amount = ROUND(
      (
        COALESCE(dp.total_net_earnings, 0)::numeric
        - ABS(COALESCE(dp.account_opening_fee, 0)::numeric)
        - rf.calc
      )::numeric,
      2
    )
  FROM (
    SELECT
      id,
      calculate_rental_fee(organization_id, driver_id, payment_period_start, payment_period_end, false)::numeric AS calc
    FROM driver_payouts
    WHERE organization_id = p_org_id
  ) rf
  WHERE dp.id = rf.id;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$ LANGUAGE plpgsql;

-- Earnings payout: platform net minus fleet commission minus **magnitude** of daily cash.
CREATE OR REPLACE FUNCTION trg_enforce_driver_payout_after_cash()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  ni numeric;
  payout numeric;
BEGIN
  ni := CASE
    WHEN COALESCE(NEW.platform_fee, 0) < 0 THEN
      COALESCE(NEW.gross_earnings, 0) + COALESCE(NEW.tips, 0) + COALESCE(NEW.platform_fee, 0)
    ELSE
      COALESCE(NEW.gross_earnings, 0) + COALESCE(NEW.tips, 0) - COALESCE(NEW.platform_fee, 0)
  END;

  payout := ROUND((
    ni
    - COALESCE(NEW.company_commission, 0)
    - ABS(COALESCE(NEW.daily_cash, 0))
  )::numeric, 2);

  NEW.driver_payout := payout;
  NEW.net_earnings := payout;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_earnings_records_payout_after_cash ON earnings_records;
CREATE TRIGGER trg_earnings_records_payout_after_cash
BEFORE INSERT OR UPDATE OF
  gross_earnings,
  platform_fee,
  tips,
  company_commission,
  daily_cash,
  total_transfer_earnings
ON earnings_records
FOR EACH ROW
EXECUTE FUNCTION trg_enforce_driver_payout_after_cash();

COMMIT;