-- Rename driver_payouts.venituri → income; generated total_gross_earnings tracks the renamed column in PostgreSQL.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'driver_payouts'
      AND column_name = 'venituri'
  ) THEN
    ALTER TABLE driver_payouts RENAME COLUMN venituri TO income;
  END IF;
END $$;

COMMENT ON COLUMN driver_payouts.income IS 'Base driver earnings (period sum; excludes tips).';
COMMENT ON COLUMN driver_payouts.tips IS 'Period sum of driver tips (Bacsis).';
COMMENT ON COLUMN driver_payouts.total_gross_earnings IS 'Generated: income + tips (true gross for the period).';
COMMENT ON COLUMN driver_payouts.gross_income IS 'Glovo ladder: SUM(income+tips) per import row; period rollup; aligns with total_gross_earnings when sources match.';
