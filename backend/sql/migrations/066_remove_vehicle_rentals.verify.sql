-- Post-066 checks (non-empty result = issue)
SELECT 'vehicle_rentals still exists' AS issue
WHERE EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'vehicle_rentals'
);

SELECT 'rent_payments still exists' AS issue
WHERE EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'rent_payments'
);

SELECT driver_id::text, vehicle_id::text, 'multiple open assignment rows' AS issue
FROM vehicle_assignment_history
WHERE unassigned_at IS NULL
GROUP BY driver_id, vehicle_id
HAVING COUNT(*) > 1;

SELECT d.id::text AS driver_id, 'orphan current_vehicle_id' AS issue
FROM drivers d
LEFT JOIN vehicles v ON v.id = d.current_vehicle_id
WHERE d.current_vehicle_id IS NOT NULL
  AND (v.id IS NULL OR v.organization_id IS DISTINCT FROM d.organization_id);

SELECT v.id::text AS vehicle_id, 'orphan current_driver_id' AS issue
FROM vehicles v
LEFT JOIN drivers d ON d.id = v.current_driver_id
WHERE v.current_driver_id IS NOT NULL
  AND (d.id IS NULL OR d.organization_id IS DISTINCT FROM v.organization_id);
