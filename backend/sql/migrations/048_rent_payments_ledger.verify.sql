-- After 048: rent_payments table + rent_paid_amount column + allocate_rental_fee exist;
-- allocator sum equals calculate_rental_fee for any existing payout (sample 200).

SELECT 'rent_payments_table_missing'::text AS check_name
WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'rent_payments'
);

SELECT 'rent_payments_unique_constraint_missing'::text AS check_name
WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'rent_payments'
      AND constraint_name = 'uq_rent_payments_payout_rental'
);

SELECT 'vehicle_rentals_rent_paid_amount_missing'::text AS check_name
WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'vehicle_rentals'
      AND column_name = 'rent_paid_amount'
);

SELECT 'allocate_rental_fee_missing'::text AS check_name
WHERE NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'allocate_rental_fee'
);

-- Allocator sum must match aggregator within rounding for any payout we sample.
SELECT
    'allocate_vs_calculate_mismatch'::text AS check_name,
    dp.id::text AS payout_id
FROM driver_payouts dp
CROSS JOIN LATERAL (
    SELECT
        calculate_rental_fee(
            dp.organization_id, dp.driver_id,
            dp.payment_period_start, dp.payment_period_end
        )::numeric AS expected_total,
        COALESCE((
            SELECT SUM(amount)
            FROM allocate_rental_fee(
                dp.organization_id, dp.driver_id,
                dp.payment_period_start, dp.payment_period_end
            )
        ), 0)::numeric AS allocator_total
) calc
WHERE ABS(ROUND(calc.expected_total, 2) - ROUND(calc.allocator_total, 2)) > 0.02
LIMIT 200;
