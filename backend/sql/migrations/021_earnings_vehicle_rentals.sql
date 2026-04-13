-- Earnings rows: link to vehicle_rental + pro-rated daily fee when trip_date falls in rental window.
-- Payout rollups: sum of per-row fees (maintained in app on import + refreshed via function on sync).

ALTER TABLE earnings_records
  ADD COLUMN IF NOT EXISTS vehicle_rental_id UUID REFERENCES vehicle_rentals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vehicle_rental_fee DECIMAL(10, 2);

ALTER TABLE driver_payouts
  ADD COLUMN IF NOT EXISTS vehicle_rental_id UUID REFERENCES vehicle_rentals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vehicle_rental_fee DECIMAL(12, 2) DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_earnings_records_vehicle_rental ON earnings_records(vehicle_rental_id)
  WHERE vehicle_rental_id IS NOT NULL;

CREATE OR REPLACE FUNCTION earnings_records_match_vehicle_rental()
RETURNS TRIGGER AS $$
DECLARE
  rid UUID;
  v_total NUMERIC(12, 2);
  v_start DATE;
  v_end DATE;
  v_vehicle_id UUID;
  days INT;
  daily_rent NUMERIC(10, 2);
  rfee NUMERIC(10, 2);
BEGIN
  IF NEW.driver_id IS NULL OR NEW.trip_date IS NULL THEN
    NEW.vehicle_rental_id := NULL;
    NEW.vehicle_rental_fee := NULL;
    RETURN NEW;
  END IF;

  SELECT v.id, v.total_rent_amount, v.rental_start_date, v.rental_end_date, v.vehicle_id
  INTO rid, v_total, v_start, v_end, v_vehicle_id
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
  days := GREATEST((v_end - v_start + 1), 1);

  IF v_total IS NOT NULL THEN
    rfee := ROUND((v_total / days::numeric)::numeric, 2);
    NEW.vehicle_rental_fee := rfee;
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

-- Recompute payout.vehicle_rental_fee from all earnings rows tied to imports with same week as payout period.
CREATE OR REPLACE FUNCTION refresh_driver_payout_vehicle_fees(p_org_id UUID)
RETURNS INTEGER AS $$
DECLARE
  n INT;
BEGIN
  UPDATE driver_payouts dp
  SET vehicle_rental_fee = COALESCE(agg.s, 0)
  FROM (
    SELECT dp2.id,
           COALESCE(SUM(x.vehicle_rental_fee), 0) AS s
    FROM driver_payouts dp2
    LEFT JOIN (
      SELECT er.driver_id,
             er.vehicle_rental_fee,
             ei.organization_id,
             ei.week_start,
             ei.week_end
      FROM earnings_records er
      INNER JOIN earnings_imports ei ON ei.id = er.import_id
    ) x ON x.driver_id = dp2.driver_id
      AND x.organization_id = dp2.organization_id
      AND x.week_start = dp2.payment_period_start
      AND x.week_end = dp2.payment_period_end
    WHERE dp2.organization_id = p_org_id
    GROUP BY dp2.id
  ) agg
  WHERE dp.id = agg.id AND dp.organization_id = p_org_id;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$ LANGUAGE plpgsql;
