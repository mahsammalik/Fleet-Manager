-- Period-level venituri + tips on driver_payouts; total_gross_earnings becomes generated (venituri + tips).

ALTER TABLE driver_payouts
  ADD COLUMN IF NOT EXISTS venituri NUMERIC(12, 6),
  ADD COLUMN IF NOT EXISTS tips NUMERIC(12, 6);

UPDATE driver_payouts
SET
  venituri = COALESCE(total_gross_earnings, 0)::numeric(12, 6),
  tips = CASE
    WHEN gross_income IS NOT NULL THEN
      GREATEST(
        0::numeric,
        COALESCE(gross_income, 0) - COALESCE(total_gross_earnings, 0)
      )::numeric(12, 6)
    ELSE 0::numeric(12, 6)
  END
WHERE venituri IS NULL OR tips IS NULL;

ALTER TABLE driver_payouts ALTER COLUMN venituri SET DEFAULT 0;
ALTER TABLE driver_payouts ALTER COLUMN tips SET DEFAULT 0;
ALTER TABLE driver_payouts ALTER COLUMN venituri SET NOT NULL;
ALTER TABLE driver_payouts ALTER COLUMN tips SET NOT NULL;

ALTER TABLE driver_payouts DROP COLUMN IF EXISTS total_gross_earnings;

ALTER TABLE driver_payouts
  ADD COLUMN total_gross_earnings NUMERIC(12, 6) GENERATED ALWAYS AS (venituri + tips) STORED;

COMMENT ON COLUMN driver_payouts.venituri IS 'Period sum of base earnings (Venituri), excluding tips.';
COMMENT ON COLUMN driver_payouts.tips IS 'Period sum of driver tips (Bacsis).';
COMMENT ON COLUMN driver_payouts.total_gross_earnings IS 'Generated: venituri + tips (true gross for the period).';

COMMENT ON COLUMN driver_payouts.gross_income IS 'Glovo ladder: SUM(venituri+tips) per import row; period rollup; aligns with total_gross_earnings when sources match.';
