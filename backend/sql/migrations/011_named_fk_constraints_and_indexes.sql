-- Migration: Name foreign key constraints and align vehicle_rentals index names
-- This migration is safe to run multiple times.

DO $$
DECLARE
  c_name text;
BEGIN
  -- drivers.organization_id -> fk_drivers_organization
  SELECT tc.constraint_name
  INTO c_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.constraint_schema = kcu.constraint_schema
  WHERE tc.table_name = 'drivers'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND kcu.column_name = 'organization_id'
  LIMIT 1;

  IF c_name IS NOT NULL AND c_name <> 'fk_drivers_organization' THEN
    EXECUTE format('ALTER TABLE drivers RENAME CONSTRAINT %I TO fk_drivers_organization', c_name);
  END IF;
END
$$;

DO $$
DECLARE
  c_name text;
BEGIN
  -- vehicles.organization_id -> fk_vehicles_organization
  SELECT tc.constraint_name
  INTO c_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.constraint_schema = kcu.constraint_schema
  WHERE tc.table_name = 'vehicles'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND kcu.column_name = 'organization_id'
  LIMIT 1;

  IF c_name IS NOT NULL AND c_name <> 'fk_vehicles_organization' THEN
    EXECUTE format('ALTER TABLE vehicles RENAME CONSTRAINT %I TO fk_vehicles_organization', c_name);
  END IF;
END
$$;

DO $$
DECLARE
  c_name text;
BEGIN
  -- vehicles.current_driver_id -> fk_vehicles_current_driver
  SELECT tc.constraint_name
  INTO c_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.constraint_schema = kcu.constraint_schema
  WHERE tc.table_name = 'vehicles'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND kcu.column_name = 'current_driver_id'
  LIMIT 1;

  IF c_name IS NOT NULL AND c_name <> 'fk_vehicles_current_driver' THEN
    EXECUTE format('ALTER TABLE vehicles RENAME CONSTRAINT %I TO fk_vehicles_current_driver', c_name);
  END IF;
END
$$;

DO $$
DECLARE
  c_name text;
BEGIN
  -- vehicle_rentals.vehicle_id -> fk_rentals_vehicle
  SELECT tc.constraint_name
  INTO c_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.constraint_schema = kcu.constraint_schema
  WHERE tc.table_name = 'vehicle_rentals'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND kcu.column_name = 'vehicle_id'
  LIMIT 1;

  IF c_name IS NOT NULL AND c_name <> 'fk_rentals_vehicle' THEN
    EXECUTE format('ALTER TABLE vehicle_rentals RENAME CONSTRAINT %I TO fk_rentals_vehicle', c_name);
  END IF;
END
$$;

DO $$
DECLARE
  c_name text;
BEGIN
  -- vehicle_rentals.driver_id -> fk_rentals_driver
  SELECT tc.constraint_name
  INTO c_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.constraint_schema = kcu.constraint_schema
  WHERE tc.table_name = 'vehicle_rentals'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND kcu.column_name = 'driver_id'
  LIMIT 1;

  IF c_name IS NOT NULL AND c_name <> 'fk_rentals_driver' THEN
    EXECUTE format('ALTER TABLE vehicle_rentals RENAME CONSTRAINT %I TO fk_rentals_driver', c_name);
  END IF;
END
$$;

DO $$
DECLARE
  c_name text;
BEGIN
  -- vehicle_rentals.organization_id -> fk_rentals_organization
  SELECT tc.constraint_name
  INTO c_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.constraint_schema = kcu.constraint_schema
  WHERE tc.table_name = 'vehicle_rentals'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND kcu.column_name = 'organization_id'
  LIMIT 1;

  IF c_name IS NOT NULL AND c_name <> 'fk_rentals_organization' THEN
    EXECUTE format('ALTER TABLE vehicle_rentals RENAME CONSTRAINT %I TO fk_rentals_organization', c_name);
  END IF;
END
$$;

-- Ensure indexes exist with the desired names and remove old vehicle_rentals index names

-- Drivers current vehicle index (already present in most schemas, kept for idempotency)
CREATE INDEX IF NOT EXISTS idx_drivers_current_vehicle ON drivers(current_vehicle_id);

-- Vehicles current driver index (already present in most schemas, kept for idempotency)
CREATE INDEX IF NOT EXISTS idx_vehicles_current_driver ON vehicles(current_driver_id);

-- Vehicle rentals indexes: rename from idx_vehicle_rentals_* to idx_rentals_*
DO $$
BEGIN
  -- Drop old index names if they exist
  IF to_regclass('public.idx_vehicle_rentals_vehicle') IS NOT NULL THEN
    DROP INDEX IF EXISTS public.idx_vehicle_rentals_vehicle;
  END IF;
  IF to_regclass('public.idx_vehicle_rentals_driver') IS NOT NULL THEN
    DROP INDEX IF EXISTS public.idx_vehicle_rentals_driver;
  END IF;
  IF to_regclass('public.idx_vehicle_rentals_status') IS NOT NULL THEN
    DROP INDEX IF EXISTS public.idx_vehicle_rentals_status;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_rentals_vehicle ON vehicle_rentals(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_rentals_driver ON vehicle_rentals(driver_id);
CREATE INDEX IF NOT EXISTS idx_rentals_status ON vehicle_rentals(status);

