-- Backfill assignment history from rentals, reconcile live assignments, drop rental stack.
BEGIN;

-- 1) Backfill vehicle_assignment_history from vehicle_rentals (skip duplicates)
INSERT INTO vehicle_assignment_history (
  driver_id,
  vehicle_id,
  assigned_at,
  unassigned_at,
  weekly_rent_at_time,
  notes
)
SELECT
  vr.driver_id,
  vr.vehicle_id,
  vr.rental_start_date::timestamptz,
  CASE
    WHEN vr.status IN ('completed', 'cancelled') THEN (vr.rental_end_date + INTERVAL '1 day' - INTERVAL '1 second')::timestamptz
    ELSE NULL
  END,
  ROUND(COALESCE(v.weekly_rent, 0)::numeric, 2),
  'Migrated from vehicle_rentals ' || vr.id::text
FROM vehicle_rentals vr
INNER JOIN vehicles v ON v.id = vr.vehicle_id
WHERE NOT EXISTS (
  SELECT 1
  FROM vehicle_assignment_history h
  WHERE h.driver_id = vr.driver_id
    AND h.vehicle_id = vr.vehicle_id
    AND h.assigned_at::date = vr.rental_start_date
);

-- 2) Reconcile active rentals → current_vehicle_id / current_driver_id
WITH latest_active AS (
  SELECT DISTINCT ON (vr.driver_id)
    vr.driver_id,
    vr.vehicle_id,
    vr.organization_id
  FROM vehicle_rentals vr
  WHERE vr.status = 'active'
  ORDER BY vr.driver_id, vr.rental_start_date DESC, vr.created_at DESC
)
UPDATE drivers d
SET current_vehicle_id = la.vehicle_id,
    updated_at = NOW()
FROM latest_active la
WHERE d.id = la.driver_id
  AND d.organization_id = la.organization_id;

WITH latest_active AS (
  SELECT DISTINCT ON (vr.vehicle_id)
    vr.driver_id,
    vr.vehicle_id,
    vr.organization_id
  FROM vehicle_rentals vr
  WHERE vr.status = 'active'
  ORDER BY vr.vehicle_id, vr.rental_start_date DESC, vr.created_at DESC
)
UPDATE vehicles v
SET current_driver_id = la.driver_id,
    status = 'rented',
    updated_at = NOW()
FROM latest_active la
WHERE v.id = la.vehicle_id
  AND v.organization_id = la.organization_id;

-- Clear vehicles/drivers that are out of sync (no active rental)
UPDATE vehicles v
SET current_driver_id = NULL,
    status = CASE WHEN v.status = 'rented' THEN 'available' ELSE v.status END,
    updated_at = NOW()
WHERE v.current_driver_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM vehicle_rentals vr
    WHERE vr.vehicle_id = v.id AND vr.status = 'active' AND vr.driver_id = v.current_driver_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM drivers d
    WHERE d.current_vehicle_id = v.id AND d.id = v.current_driver_id
  );

-- 3) Earnings trigger used vehicle_rentals — remove before dropping table
DROP TRIGGER IF EXISTS trg_earnings_records_match_vehicle_rental ON earnings_records;
DROP FUNCTION IF EXISTS earnings_records_match_vehicle_rental();

-- 4) Drop dependent tables / columns
DROP TABLE IF EXISTS rent_payments CASCADE;
DROP TABLE IF EXISTS deposit_transactions CASCADE;

ALTER TABLE payout_rent_entries DROP CONSTRAINT IF EXISTS payout_rent_entries_vehicle_rental_id_fkey;
DROP INDEX IF EXISTS idx_payout_rent_entries_rental;
ALTER TABLE payout_rent_entries DROP COLUMN IF EXISTS vehicle_rental_id;

ALTER TABLE earnings_records DROP CONSTRAINT IF EXISTS fk_earnings_records_vehicle_rental;
DROP INDEX IF EXISTS idx_earnings_records_vehicle_rental;
ALTER TABLE earnings_records DROP COLUMN IF EXISTS vehicle_rental_id;
ALTER TABLE earnings_records DROP COLUMN IF EXISTS vehicle_rental_fee;

ALTER TABLE driver_payouts DROP CONSTRAINT IF EXISTS fk_driver_payouts_vehicle_rental;
ALTER TABLE driver_payouts DROP COLUMN IF EXISTS vehicle_rental_id;

DROP TABLE IF EXISTS vehicle_rentals CASCADE;

DROP FUNCTION IF EXISTS prorate_vehicle_rent_piece(character varying, numeric, integer, integer, uuid);
DROP FUNCTION IF EXISTS count_overlapping_vehicle_rentals(uuid, uuid, date, date, boolean);
DROP FUNCTION IF EXISTS count_overlapping_vehicle_rentals(uuid, uuid, date, date);

COMMIT;
