-- Subcontractors: B2B partners; split commission on earnings; rent billed to sub (not driver payroll).
BEGIN;

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
    fleet_commission_rate_pct NUMERIC(5, 2) NOT NULL DEFAULT 5.00,
    subcontractor_commission_rate_pct NUMERIC(5, 2) NOT NULL DEFAULT 12.00,
    contract_start_date DATE,
    contract_end_date DATE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subcontractors_org ON subcontractors(organization_id);
CREATE INDEX IF NOT EXISTS idx_subcontractors_org_status ON subcontractors(organization_id, status);

ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS subcontractor_id UUID REFERENCES subcontractors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_drivers_subcontractor ON drivers(subcontractor_id) WHERE subcontractor_id IS NOT NULL;

ALTER TABLE earnings_records
  ADD COLUMN IF NOT EXISTS subcontractor_commission DECIMAL(10, 2) NOT NULL DEFAULT 0;

UPDATE earnings_records SET subcontractor_commission = 0 WHERE subcontractor_commission IS NULL;

ALTER TABLE driver_payouts
  ADD COLUMN IF NOT EXISTS subcontractor_commission DECIMAL(10, 2) NOT NULL DEFAULT 0;

UPDATE driver_payouts SET subcontractor_commission = 0 WHERE subcontractor_commission IS NULL;

-- Persisted fleet↔subcontractor rent for a payment period (prorated vehicle rent for sub-managed drivers).
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

-- --- driver_payout_after_cash: subtract subcontractor commission ---
ALTER TABLE earnings_records DROP COLUMN IF EXISTS driver_payout_after_cash;

ALTER TABLE earnings_records
  ADD COLUMN driver_payout_after_cash DECIMAL(10, 2)
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
          - COALESCE(subcontractor_commission, 0)
          - ABS(COALESCE(daily_cash, 0))
        )::numeric,
        2
      )
    ) STORED;

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
    - COALESCE(NEW.subcontractor_commission, 0)
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
  subcontractor_commission,
  daily_cash,
  total_transfer_earnings
ON earnings_records
FOR EACH ROW
EXECUTE FUNCTION trg_enforce_driver_payout_after_cash();

-- Skip per-driver vehicle rent on earnings rows for sub-managed drivers (fleet bills subcontractor).
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

-- Replace legacy 4-arg signature from migration 047; otherwise it overloads with the 5-arg form
-- and four-argument calls fail with PostgreSQL error 42725.
DROP FUNCTION IF EXISTS calculate_rental_fee(uuid, uuid, date, date);

-- Payroll driver rent: zero when driver is sub-managed (rent settled separately).
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

-- Upsert prorated rent owed by each subcontractor for a calendar period (fleet→sub).
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

-- Align stored driver_payout / net_earnings with generated column after column add
UPDATE earnings_records er
SET driver_payout = er.driver_payout_after_cash,
    net_earnings = er.driver_payout_after_cash
WHERE er.driver_payout IS DISTINCT FROM er.driver_payout_after_cash
   OR er.net_earnings IS DISTINCT FROM er.driver_payout_after_cash;

-- Direct-driver default fleet commission (product: 10% for non–sub-managed drivers)
ALTER TABLE drivers ALTER COLUMN commission_rate SET DEFAULT 10.00;
ALTER TABLE drivers ALTER COLUMN base_commission_rate SET DEFAULT 10.00;

COMMIT;
