-- Ledger linking driver_payouts payroll deductions to vehicle_rentals + rent_paid rollup.
-- Adds rent_payments table, vehicle_rentals.rent_paid_amount, and allocate_rental_fee()
-- which mirrors calculate_rental_fee() (047) but returns one row per contributing rental.
BEGIN;

CREATE TABLE IF NOT EXISTS rent_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL CONSTRAINT fk_rent_payments_org
        REFERENCES organizations(id) ON DELETE CASCADE,
    vehicle_rental_id UUID NOT NULL CONSTRAINT fk_rent_payments_rental
        REFERENCES vehicle_rentals(id) ON DELETE CASCADE,
    driver_payout_id UUID NOT NULL CONSTRAINT fk_rent_payments_payout
        REFERENCES driver_payouts(id) ON DELETE CASCADE,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    payment_method VARCHAR(50) NOT NULL DEFAULT 'payroll_deduction',
    paid_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_rent_payments_payout_rental UNIQUE (driver_payout_id, vehicle_rental_id)
);

CREATE INDEX IF NOT EXISTS idx_rent_payments_rental ON rent_payments(vehicle_rental_id);
CREATE INDEX IF NOT EXISTS idx_rent_payments_payout ON rent_payments(driver_payout_id);
CREATE INDEX IF NOT EXISTS idx_rent_payments_org_paid_at ON rent_payments(organization_id, paid_at);

ALTER TABLE vehicle_rentals
    ADD COLUMN IF NOT EXISTS rent_paid_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;

-- Per-rental breakdown of calculate_rental_fee math (mirrors loop in 047).
-- Returns one row per contributing rental with its prorated piece. Sum of rows
-- for the same (org, driver, week) equals calculate_rental_fee(...) within rounding.
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
            -- daily / monthly with lump amount: share by rental span (matches 047)
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

COMMENT ON FUNCTION allocate_rental_fee(UUID, UUID, DATE, DATE) IS
    'Per-rental breakdown of calculate_rental_fee: returns (rental_id, prorated_amount) rows.';

COMMIT;
