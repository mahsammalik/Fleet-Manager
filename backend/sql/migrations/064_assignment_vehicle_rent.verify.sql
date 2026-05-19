-- After 064: payout fees match assignment-based calculate_rental_fee.
SELECT 'calculate_rental_fee missing'::text AS check_name
WHERE NOT EXISTS (
  SELECT 1
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'calculate_rental_fee'
    AND pg_get_function_identity_arguments(p.oid) = 'uuid, uuid, date, date'
);

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
  'assigned_vehicle_zero_fee'::text AS check_name,
  dp.id::text AS payout_id,
  dp.driver_id::text AS driver_id
FROM driver_payouts dp
INNER JOIN drivers d ON d.id = dp.driver_id AND d.organization_id = dp.organization_id
INNER JOIN vehicles v ON v.id = d.current_vehicle_id AND v.organization_id = d.organization_id
WHERE COALESCE(v.weekly_rent, 0) > 0
  AND COALESCE(dp.vehicle_rental_fee, 0) = 0
LIMIT 200;
