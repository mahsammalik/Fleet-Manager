-- Auto-deduct vehicle rent: unified proration, single overlapping rental, all drivers (incl. sub-managed).
BEGIN;

DROP FUNCTION IF EXISTS calculate_rental_fee(uuid, uuid, date, date, boolean);

CREATE OR REPLACE FUNCTION prorate_vehicle_rent_piece(
  p_rental_type VARCHAR,
  p_total_rent_amount NUMERIC,
  p_overlap_days INT,
  p_rental_span INT,
  p_vehicle_id UUID
) RETURNS NUMERIC AS $$
DECLARE
  daily_amt NUMERIC(14, 6);
BEGIN
  IF p_overlap_days IS NULL OR p_overlap_days <= 0 THEN
    RETURN 0;
  END IF;

  IF p_rental_type = 'weekly' AND p_total_rent_amount IS NOT NULL THEN
    RETURN p_total_rent_amount::numeric * p_overlap_days::numeric / 7::numeric;
  ELSIF p_rental_type = 'monthly' AND p_total_rent_amount IS NOT NULL THEN
    RETURN (p_total_rent_amount::numeric / 4::numeric) * p_overlap_days::numeric / 7::numeric;
  ELSIF p_total_rent_amount IS NOT NULL THEN
    RETURN p_total_rent_amount::numeric * p_overlap_days::numeric / GREATEST(p_rental_span, 1)::numeric;
  ELSIF p_rental_type = 'daily' THEN
    SELECT ve.daily_rent::numeric INTO daily_amt FROM vehicles ve WHERE ve.id = p_vehicle_id;
    IF daily_amt IS NULL THEN
      RETURN 0;
    END IF;
    RETURN daily_amt * p_overlap_days::numeric;
  END IF;

  RETURN 0;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION prorate_vehicle_rent_piece(VARCHAR, NUMERIC, INT, INT, UUID) IS
  'Prorated rent for one rental overlap: weekly/monthly use week math; daily uses contract span or vehicles.daily_rent.';

CREATE OR REPLACE FUNCTION count_overlapping_vehicle_rentals(
  p_organization_id UUID,
  p_driver_id UUID,
  p_week_start DATE,
  p_week_end DATE,
  p_include_completed BOOLEAN DEFAULT true
) RETURNS INT AS $$
  SELECT COUNT(*)::int
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
    AND vr.rental_start_date <= p_week_end;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION calculate_rental_fee(
  p_organization_id UUID,
  p_driver_id UUID,
  p_week_start DATE,
  p_week_end DATE
) RETURNS NUMERIC AS $$
DECLARE
  rec RECORD;
  overlap_days INT;
  rental_span INT;
  piece NUMERIC(14, 6);
BEGIN
  SELECT
    vr.rental_start_date,
    vr.rental_end_date,
    vr.rental_type,
    vr.total_rent_amount,
    vr.vehicle_id
  INTO rec
  FROM vehicle_rentals vr
  WHERE vr.organization_id = p_organization_id
    AND vr.driver_id = p_driver_id
    AND vr.status IN ('active', 'completed')
    AND vr.rental_end_date >= p_week_start
    AND vr.rental_start_date <= p_week_end
  ORDER BY (vr.status = 'active') DESC, vr.rental_start_date DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  overlap_days := (LEAST(rec.rental_end_date, p_week_end)
    - GREATEST(rec.rental_start_date, p_week_start) + 1)::INT;
  IF overlap_days <= 0 THEN
    RETURN 0;
  END IF;

  rental_span := GREATEST((rec.rental_end_date - rec.rental_start_date + 1), 1);
  piece := prorate_vehicle_rent_piece(
    rec.rental_type,
    rec.total_rent_amount,
    overlap_days,
    rental_span,
    rec.vehicle_id
  );

  RETURN ROUND(COALESCE(piece, 0)::numeric, 2);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION calculate_rental_fee(UUID, UUID, DATE, DATE) IS
  'Fleet-week vehicle rent on driver_payouts: one overlapping rental (prefer active, latest start); weekly and monthly proration.';

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
  piece NUMERIC(14, 6);
BEGIN
  SELECT vr.id, vr.rental_start_date, vr.rental_end_date, vr.rental_type,
         vr.total_rent_amount, vr.vehicle_id
  INTO rec
  FROM vehicle_rentals vr
  WHERE vr.organization_id = p_organization_id
    AND vr.driver_id = p_driver_id
    AND vr.status IN ('active', 'completed')
    AND vr.rental_end_date >= p_week_start
    AND vr.rental_start_date <= p_week_end
  ORDER BY (vr.status = 'active') DESC, vr.rental_start_date DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  overlap_days := (LEAST(rec.rental_end_date, p_week_end)
    - GREATEST(rec.rental_start_date, p_week_start) + 1)::INT;
  IF overlap_days <= 0 THEN
    RETURN;
  END IF;

  rental_span := GREATEST((rec.rental_end_date - rec.rental_start_date + 1), 1);
  piece := ROUND(
    prorate_vehicle_rent_piece(
      rec.rental_type,
      rec.total_rent_amount,
      overlap_days,
      rental_span,
      rec.vehicle_id
    )::numeric,
    2
  );

  IF piece > 0 THEN
    vehicle_rental_id := rec.id;
    amount := piece;
    RETURN NEXT;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

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
  piece NUMERIC(14, 6);
BEGIN
  SELECT vr.id, vr.rental_start_date, vr.rental_end_date, vr.rental_type,
         vr.total_rent_amount, vr.vehicle_id
  INTO rec
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
  ORDER BY (vr.status = 'active') DESC, vr.rental_start_date DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  overlap_days := (LEAST(rec.rental_end_date, p_week_end)
    - GREATEST(rec.rental_start_date, p_week_start) + 1)::INT;
  IF overlap_days <= 0 THEN
    RETURN;
  END IF;

  rental_span := GREATEST((rec.rental_end_date - rec.rental_start_date + 1), 1);
  piece := ROUND(
    prorate_vehicle_rent_piece(
      rec.rental_type,
      rec.total_rent_amount,
      overlap_days,
      rental_span,
      rec.vehicle_id
    )::numeric,
    2
  );

  IF piece > 0 THEN
    vehicle_rental_id := rec.id;
    amount := piece;
    RETURN NEXT;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- Deprecated: rent lives on driver_payouts; kept for legacy rows only.
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
      calculate_rental_fee(p_organization_id, d.id, p_period_start, p_period_end)
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
        'Deprecated aggregate; use SUM(driver_payouts.vehicle_rental_fee) for settlements'
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
      calculate_rental_fee(organization_id, driver_id, payment_period_start, payment_period_end)::numeric AS calc
    FROM driver_payouts
    WHERE organization_id = p_org_id
      AND payment_status NOT IN ('paid', 'approved')
  ) rf
  WHERE dp.id = rf.id;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$ LANGUAGE plpgsql;

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
