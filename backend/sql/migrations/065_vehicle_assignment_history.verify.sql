SELECT 'vehicle_assignment_history missing'::text AS check_name
WHERE NOT EXISTS (
  SELECT 1
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name = 'vehicle_assignment_history'
);

SELECT 'open_assignment_unique_index missing'::text AS check_name
WHERE NOT EXISTS (
  SELECT 1
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'vehicle_assignment_history'
    AND indexname = 'uq_vehicle_assignment_history_driver_open'
);
