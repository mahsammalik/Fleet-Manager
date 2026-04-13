-- Vehicle rental fee on earnings rows: use full vehicle_rentals.total_rent_amount (no daily proration).
-- Payout rollup: sum each distinct rental at most once per payout period (MAX fee per vehicle_rental_id).

CREATE OR REPLACE FUNCTION earnings_records_match_vehicle_rental()
RETURNS TRIGGER AS $$
DECLARE
  rid UUID;
  v_total NUMERIC(12, 2);
  v_vehicle_id UUID;
  daily_rent NUMERIC(10, 2);
BEGIN
  IF NEW.driver_id IS NULL OR NEW.trip_date IS NULL THEN
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

CREATE OR REPLACE FUNCTION refresh_driver_payout_vehicle_fees(p_org_id UUID)
RETURNS INTEGER AS $$
DECLARE
  n INT;
BEGIN
  UPDATE driver_payouts dp
  SET vehicle_rental_fee = COALESCE(agg.s, 0)
  FROM (
    SELECT dp2.id,
           COALESCE((
             SELECT SUM(sub.mx)
             FROM (
               SELECT er.vehicle_rental_id,
                      MAX(er.vehicle_rental_fee) AS mx
               FROM earnings_records er
               INNER JOIN earnings_imports ei ON ei.id = er.import_id
               WHERE er.driver_id = dp2.driver_id
                 AND ei.organization_id = dp2.organization_id
                 AND ei.week_start = dp2.payment_period_start
                 AND ei.week_end = dp2.payment_period_end
                 AND er.vehicle_rental_id IS NOT NULL
                 AND er.vehicle_rental_fee IS NOT NULL
               GROUP BY er.vehicle_rental_id
             ) sub
           ), 0) AS s
    FROM driver_payouts dp2
    WHERE dp2.organization_id = p_org_id
  ) agg
  WHERE dp.id = agg.id AND dp.organization_id = p_org_id;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$ LANGUAGE plpgsql;

-- Backfill row-level fees to full contract amount where rental is linked.
UPDATE earnings_records er
SET vehicle_rental_fee = ROUND(v.total_rent_amount::numeric, 2)
FROM vehicle_rentals v
WHERE er.vehicle_rental_id = v.id
  AND v.total_rent_amount IS NOT NULL;

-- Recompute all payout rollups for every org.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM organizations
  LOOP
    PERFORM refresh_driver_payout_vehicle_fees(r.id);
  END LOOP;
END $$;
