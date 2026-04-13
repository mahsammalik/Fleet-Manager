DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'driver_payments'
  ) THEN
    ALTER TABLE driver_payments RENAME TO driver_payouts;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'i' AND c.relname = 'idx_driver_payments_driver') THEN
    ALTER INDEX idx_driver_payments_driver RENAME TO idx_driver_payouts_driver;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'i' AND c.relname = 'idx_driver_payments_status') THEN
    ALTER INDEX idx_driver_payments_status RENAME TO idx_driver_payouts_status;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'i' AND c.relname = 'idx_driver_payments_period') THEN
    ALTER INDEX idx_driver_payments_period RENAME TO idx_driver_payouts_period;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'i' AND c.relname = 'idx_driver_payments_org_driver_period') THEN
    ALTER INDEX idx_driver_payments_org_driver_period RENAME TO idx_driver_payouts_org_driver_period;
  END IF;
END $$;
