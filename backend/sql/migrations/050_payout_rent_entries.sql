-- Explicit payroll vehicle rent line items per driver payout week + allocator helper.
BEGIN;

CREATE TABLE IF NOT EXISTS payout_rent_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_payout_id UUID NOT NULL REFERENCES driver_payouts(id) ON DELETE CASCADE,
    vehicle_rental_id UUID REFERENCES vehicle_rentals(id) ON DELETE SET NULL,
    entry_type VARCHAR(50) NOT NULL CHECK (entry_type IN ('current_week', 'overdue', 'adjustment')),
    amount NUMERIC(12, 2) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payout_rent_entries_payout ON payout_rent_entries(driver_payout_id);
CREATE INDEX IF NOT EXISTS idx_payout_rent_entries_rental ON payout_rent_entries(vehicle_rental_id);

-- Same proration as calculate_rental_fee (047); filter rentals by status via p_include_completed.
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

COMMENT ON FUNCTION allocate_vehicle_rent_pieces(UUID, UUID, DATE, DATE, BOOLEAN) IS
    'Fleet-week proration per rental; active-only vs active+completed via flag (matches calculate_rental_fee math).';

COMMIT;
