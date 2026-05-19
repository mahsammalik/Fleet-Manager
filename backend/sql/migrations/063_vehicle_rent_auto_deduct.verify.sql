-- After 063: proration algebra + payout consistency + zero-fee validation.
SELECT 'calculate_rental_fee missing'::text AS check_name
WHERE NOT EXISTS (
  SELECT 1
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'calculate_rental_fee'
    AND pg_get_function_identity_arguments(p.oid) = 'uuid, uuid, date, date'
);

SELECT 'weekly_proration_5_of_7_algebra'::text AS check_name
FROM (SELECT 1) _
WHERE (SELECT ROUND((700::numeric * 5 / 7)::numeric, 2)) IS DISTINCT FROM 500.00::numeric;

SELECT 'monthly_proration_5_of_7_algebra'::text AS check_name
FROM (SELECT 1) _
WHERE (SELECT ROUND(((1200::numeric / 4) * 5 / 7)::numeric, 2)) IS DISTINCT FROM 214.29::numeric;

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

SELECT
  'active_rental_zero_fee'::text AS check_name,
  dp.id::text AS payout_id,
  dp.driver_id::text AS driver_id
FROM driver_payouts dp
JOIN vehicle_rentals vr
  ON vr.organization_id = dp.organization_id
 AND vr.driver_id = dp.driver_id
 AND vr.status = 'active'
 AND vr.total_rent_amount IS NOT NULL
 AND vr.rental_end_date >= dp.payment_period_start
 AND vr.rental_start_date <= dp.payment_period_end
WHERE COALESCE(dp.vehicle_rental_fee, 0) = 0
LIMIT 200;
