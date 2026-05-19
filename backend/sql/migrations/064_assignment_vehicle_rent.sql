-- Assignment-based payroll rent: drivers.current_vehicle_id + vehicles.weekly_rent (full week, no proration).
BEGIN;

DROP FUNCTION IF EXISTS count_overlapping_vehicle_rentals(uuid, uuid, date, date, boolean);
DROP FUNCTION IF EXISTS count_overlapping_vehicle_rentals(uuid, uuid, date, date);
DROP FUNCTION IF EXISTS prorate_vehicle_rent_piece(character varying, numeric, integer, integer, uuid);

CREATE OR REPLACE FUNCTION calculate_rental_fee(
  p_organization_id UUID,
  p_driver_id UUID,
  p_week_start DATE,
  p_week_end DATE
) RETURNS NUMERIC AS $$
DECLARE
  fee NUMERIC(12, 2);
BEGIN
  SELECT ROUND(COALESCE(v.weekly_rent, 0)::numeric, 2) INTO fee
  FROM drivers d
  LEFT JOIN vehicles v
    ON v.id = d.current_vehicle_id
   AND v.organization_id = d.organization_id
  WHERE d.id = p_driver_id
    AND d.organization_id = p_organization_id;

  RETURN COALESCE(fee, 0);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION calculate_rental_fee(UUID, UUID, DATE, DATE) IS
  'Payroll vehicle rent: vehicles.weekly_rent when drivers.current_vehicle_id is set; else 0. Week dates ignored.';

CREATE OR REPLACE FUNCTION allocate_rental_fee(
  p_organization_id UUID,
  p_driver_id UUID,
  p_week_start DATE,
  p_week_end DATE
) RETURNS TABLE (vehicle_rental_id UUID, amount NUMERIC) AS $$
DECLARE
  fee NUMERIC(12, 2);
BEGIN
  fee := calculate_rental_fee(p_organization_id, p_driver_id, p_week_start, p_week_end);
  IF fee > 0 THEN
    vehicle_rental_id := NULL;
    amount := fee;
    RETURN NEXT;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION allocate_rental_fee(UUID, UUID, DATE, DATE) IS
  'Payroll rent breakdown: one row (no vehicle_rentals FK) matching calculate_rental_fee.';

CREATE OR REPLACE FUNCTION allocate_vehicle_rent_pieces(
  p_organization_id UUID,
  p_driver_id UUID,
  p_week_start DATE,
  p_week_end DATE,
  p_include_completed BOOLEAN
) RETURNS TABLE (vehicle_rental_id UUID, amount NUMERIC) AS $$
BEGIN
  RETURN QUERY
  SELECT NULL::uuid, a.amount
  FROM allocate_rental_fee(p_organization_id, p_driver_id, p_week_start, p_week_end) a;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION allocate_vehicle_rent_pieces(UUID, UUID, DATE, DATE, BOOLEAN) IS
  'Matches allocate_rental_fee; p_include_completed ignored (assignment-based rent).';

DO $$
DECLARE
  org RECORD;
BEGIN
  FOR org IN SELECT id FROM organizations
  LOOP
    PERFORM refresh_driver_payout_vehicle_fees(org.id);
  END LOOP;
END $$;

COMMIT;
