-- Vehicle Management Schema (reference)
-- Full app schema is in backend/sql/schema.sql. Use migrations in backend/sql/migrations/ for existing DBs.

-- Vehicles Table
CREATE TABLE IF NOT EXISTS vehicles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    vehicle_type VARCHAR(50) NOT NULL,
    make VARCHAR(100) NOT NULL,
    model VARCHAR(100) NOT NULL,
    year INTEGER,
    color VARCHAR(50),
    license_plate VARCHAR(20) UNIQUE NOT NULL,
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
    current_driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add current_vehicle_id to drivers (run after vehicles table exists)
ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS current_vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_drivers_current_vehicle ON drivers(current_vehicle_id);

-- Vehicle Rentals Table (full history)
CREATE TABLE IF NOT EXISTS vehicle_rentals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    driver_id UUID REFERENCES drivers(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    rental_start_date DATE NOT NULL,
    rental_end_date DATE NOT NULL,
    rental_type VARCHAR(50) DEFAULT 'daily'
        CHECK (rental_type IN ('daily', 'weekly', 'monthly')),
    total_rent_amount DECIMAL(10, 2),
    deposit_amount DECIMAL(10, 2) DEFAULT 0.00,
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

-- Vehicle Maintenance Table
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_vehicles_organization ON vehicles(organization_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_status ON vehicles(status);
CREATE INDEX IF NOT EXISTS idx_vehicles_license_plate ON vehicles(license_plate);
CREATE INDEX IF NOT EXISTS idx_vehicle_rentals_vehicle ON vehicle_rentals(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_rentals_driver ON vehicle_rentals(driver_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_rentals_status ON vehicle_rentals(status);
CREATE INDEX IF NOT EXISTS idx_vehicle_rentals_period ON vehicle_rentals(rental_start_date, rental_end_date);
CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_vehicle ON vehicle_maintenance(vehicle_id);
