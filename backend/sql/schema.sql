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
    commission_rate DECIMAL(5, 2) DEFAULT 20.00,
    base_commission_rate DECIMAL(5, 2) DEFAULT 20.00,
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
    transfer_commission DECIMAL(10, 2),
    cash_commission DECIMAL(10, 2),
    has_cash_commission BOOLEAN GENERATED ALWAYS AS (COALESCE(cash_commission, 0) < 0) STORED,
    company_commission DECIMAL(10, 2),
    driver_payout DECIMAL(10, 2),
    driver_payout_after_cash DECIMAL(10, 2)
      GENERATED ALWAYS AS (
        GREATEST(
          0,
          ROUND(
            (
              COALESCE(
                total_transfer_earnings,
                net_earnings,
                COALESCE(gross_earnings, 0) - COALESCE(platform_fee, 0),
                gross_earnings,
                0
              ) - ABS(COALESCE(transfer_commission, 0)) - ABS(COALESCE(cash_commission, 0))
            )::numeric,
            2
          )
        )
      ) STORED,
    commission_type VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Driver payouts (period rollups)
CREATE TABLE IF NOT EXISTS driver_payouts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    driver_id UUID REFERENCES drivers(id) ON DELETE CASCADE,
    payment_period_start DATE NOT NULL,
    payment_period_end DATE NOT NULL,
    total_gross_earnings DECIMAL(12, 2),
    total_platform_fees DECIMAL(10, 2),
    total_net_earnings DECIMAL(12, 2),
    total_daily_cash DECIMAL(12, 2) DEFAULT 0,
    company_commission DECIMAL(10, 2),
    bonuses DECIMAL(10, 2) DEFAULT 0,
    penalties DECIMAL(10, 2) DEFAULT 0,
    adjustments DECIMAL(10, 2) DEFAULT 0,
    net_driver_payout DECIMAL(10, 2),
    payment_status VARCHAR(50) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'approved', 'paid', 'hold')),
    payment_date DATE,
    payment_method VARCHAR(50),
    transaction_ref VARCHAR(100),
    notes TEXT,
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_earnings_imports_org ON earnings_imports(organization_id);
CREATE INDEX IF NOT EXISTS idx_earnings_staging_import ON earnings_import_staging(import_id);
CREATE INDEX IF NOT EXISTS idx_earnings_staging_org ON earnings_import_staging(organization_id);
CREATE INDEX IF NOT EXISTS idx_earnings_records_driver ON earnings_records(driver_id);
CREATE INDEX IF NOT EXISTS idx_earnings_records_date ON earnings_records(trip_date);
CREATE INDEX IF NOT EXISTS idx_earnings_records_import ON earnings_records(import_id);
CREATE INDEX IF NOT EXISTS idx_driver_payouts_driver ON driver_payouts(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_payouts_status ON driver_payouts(payment_status);
CREATE INDEX IF NOT EXISTS idx_driver_payouts_period ON driver_payouts(payment_period_start, payment_period_end);
CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_payouts_org_driver_period ON driver_payouts (organization_id, driver_id, payment_period_start, payment_period_end);

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

-- Earnings payout guardrail: always deduct full company commission (incl. cash commission).
CREATE OR REPLACE FUNCTION trg_enforce_driver_payout_after_cash()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  transfer_base numeric;
BEGIN
  transfer_base := COALESCE(
    NEW.total_transfer_earnings,
    NEW.net_earnings,
    COALESCE(NEW.gross_earnings, 0) - COALESCE(NEW.platform_fee, 0),
    NEW.gross_earnings,
    0
  );

  NEW.driver_payout := GREATEST(
    0,
    ROUND(
      (
        transfer_base
        - ABS(COALESCE(NEW.transfer_commission, 0))
        - ABS(COALESCE(NEW.cash_commission, 0))
      )::numeric,
      2
    )
  );
  NEW.net_earnings := NEW.driver_payout;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_earnings_records_payout_after_cash ON earnings_records;
CREATE TRIGGER trg_earnings_records_payout_after_cash
BEFORE INSERT OR UPDATE OF
  total_transfer_earnings, net_earnings, gross_earnings, platform_fee, company_commission
ON earnings_records
FOR EACH ROW
EXECUTE FUNCTION trg_enforce_driver_payout_after_cash();

COMMIT;