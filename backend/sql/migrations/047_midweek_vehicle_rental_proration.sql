-- Mid-week fleet proration for driver_payouts.vehicle_rental_fee (weekly =
-- total_rent_amount * overlap_days / 7). Refresh + backfill raw_net_amount.
-- If historical rows had debt based on older raw_net, re-run debt carry-forward /
-- reconciliation for affected orgs after validating differences.

CREATE OR REPLACE FUNCTION calculate_rental_fee(
  p_organization_id UUID,
  p_driver_id UUID,
  p_week_start DATE,
  p_week_end DATE
) RETURNS NUMERIC AS $$
DECLARE
  sum_fee NUMERIC(14, 6) := 0;
  rec RECORD;
  overlap_days INT;
  rental_span INT;
  daily_amt NUMERIC(14, 6);
  piece NUMERIC(14, 6);
BEGIN
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
      -- daily (or weekly/monthly contract without lump amount): share by rental span
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

COMMENT ON FUNCTION calculate_rental_fee(UUID, UUID, DATE, DATE) IS
  'Fleet-week vehicle rent: sums prorated overlap with payment period (weekly uses amount * days / 7).';

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
  ) rf
  WHERE dp.id = rf.id;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$ LANGUAGE plpgsql;

-- Backfill all orgs; net_driver_payout debt chains need a TS/SQL recompute after this if raw_net shifted.
DO $$
DECLARE
  org RECORD;
BEGIN
  FOR org IN SELECT id FROM organizations
  LOOP
    PERFORM refresh_driver_payout_vehicle_fees(org.id);
  END LOOP;
END $$;
