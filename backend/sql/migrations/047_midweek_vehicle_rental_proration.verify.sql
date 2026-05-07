-- After 047: function exists + payout rows stay consistent with prorated rental + raw_net.
SELECT 'calculate_rental_fee missing'::text AS check_name
WHERE NOT EXISTS (
  SELECT 1
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'calculate_rental_fee'
);

-- Algebraic check: weekly rate * 5 / 7 = 500 when rate = 700 (no DB rows required).
SELECT 'weekly_proration_5_of_7_algebra'::text AS check_name
FROM (SELECT 1) _
WHERE (SELECT ROUND((700::numeric * 5 / 7)::numeric, 2)) IS DISTINCT FROM 500.00::numeric;

-- driver_payouts: vehicle fee must match calculator; raw_net must match rollup minus fees and rental.
SELECT
  'driver_payouts_rent_raw_mismatch'::text AS check_name,
  dp.id::text AS payout_id
FROM driver_payouts dp
CROSS JOIN LATERAL (
  SELECT calculate_rental_fee(
      dp.organization_id,
      dp.driver_id,
      dp.payment_period_start,
      dp.payment_period_end
    )::numeric AS expected_rental
) calc
WHERE ROUND(COALESCE(dp.vehicle_rental_fee, 0)::numeric, 2) <> ROUND(calc.expected_rental::numeric, 2)
   OR ROUND(COALESCE(dp.raw_net_amount, 0)::numeric, 2) <> ROUND(
        (
          COALESCE(dp.total_net_earnings, 0)::numeric
          - ABS(COALESCE(dp.account_opening_fee, 0)::numeric)
          - calc.expected_rental
        )::numeric,
        2
      )
LIMIT 200;
