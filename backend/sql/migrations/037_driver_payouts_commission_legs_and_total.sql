-- Period rollups for transfer vs cash commission legs + generated total_commission (sum of legs).

ALTER TABLE driver_payouts
  ADD COLUMN IF NOT EXISTS transfer_commission NUMERIC(12, 6) NOT NULL DEFAULT 0;

ALTER TABLE driver_payouts
  ADD COLUMN IF NOT EXISTS cash_commission NUMERIC(12, 6) NOT NULL DEFAULT 0;

UPDATE driver_payouts dp
SET
  transfer_commission = COALESCE(agg.tc, 0)::numeric(12, 6),
  cash_commission = COALESCE(agg.cc, 0)::numeric(12, 6)
FROM (
  SELECT
    ei.organization_id,
    er.driver_id,
    ei.week_start,
    ei.week_end,
    SUM(COALESCE(er.transfer_commission, 0)) AS tc,
    SUM(COALESCE(er.cash_commission, 0)) AS cc
  FROM earnings_records er
  INNER JOIN earnings_imports ei ON ei.id = er.import_id
  GROUP BY ei.organization_id, er.driver_id, ei.week_start, ei.week_end
) agg
WHERE dp.organization_id = agg.organization_id
  AND dp.driver_id = agg.driver_id
  AND dp.payment_period_start = agg.week_start
  AND dp.payment_period_end = agg.week_end;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'driver_payouts'
      AND column_name = 'total_commission'
  ) THEN
    ALTER TABLE driver_payouts
      ADD COLUMN total_commission NUMERIC(12, 6) GENERATED ALWAYS AS (
        COALESCE(transfer_commission, 0) + COALESCE(cash_commission, 0)
      ) STORED;
  END IF;
END $$;

COMMENT ON COLUMN driver_payouts.transfer_commission IS 'Period sum of transfer-leg fleet commission (earnings base).';
COMMENT ON COLUMN driver_payouts.cash_commission IS 'Period sum of cash-leg fleet commission (signed; display may use ABS for deduction).';
COMMENT ON COLUMN driver_payouts.total_commission IS 'Generated: transfer_commission + cash_commission (leg sum; may differ from company_commission for fixed/minimum rules).';
