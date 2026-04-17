-- Compatibility migration for environments still using legacy payment_status checks.
-- Ensures driver_payouts accepts debt/hold plus legacy statuses during transition.

DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT c.conname
    FROM pg_constraint c
    INNER JOIN pg_class t ON t.oid = c.conrelid
    INNER JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'driver_payouts'
      AND c.contype = 'c'
      AND (
        c.conname IN ('driver_payments_payment_status_check', 'driver_payouts_payment_status_check')
        OR c.conname ILIKE '%payment_status%check%'
      )
  LOOP
    EXECUTE format('ALTER TABLE public.driver_payouts DROP CONSTRAINT IF EXISTS %I', rec.conname);
  END LOOP;
END
$$;

ALTER TABLE public.driver_payouts
  ADD CONSTRAINT driver_payouts_payment_status_check
  CHECK (
    payment_status IN (
      'pending',
      'processing',
      'approved',
      'paid',
      'failed',
      'hold',
      'debt'
    )
  ) NOT VALID;

ALTER TABLE public.driver_payouts
  VALIDATE CONSTRAINT driver_payouts_payment_status_check;
