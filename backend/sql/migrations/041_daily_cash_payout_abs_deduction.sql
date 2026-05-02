-- Daily cash: always treat magnitude as deduction from net after commission (matches Excel: net - comm - |cash|).
-- Stored CSV values may be negative; subtracting ABS avoids sign inversion.

BEGIN;

DROP TRIGGER IF EXISTS trg_earnings_records_payout_after_cash ON earnings_records;

ALTER TABLE earnings_records DROP COLUMN IF EXISTS driver_payout_after_cash;

CREATE OR REPLACE FUNCTION trg_enforce_driver_payout_after_cash()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  ni numeric;
  payout numeric;
BEGIN
  ni := CASE
    WHEN COALESCE(NEW.platform_fee, 0) < 0 THEN
      COALESCE(NEW.gross_earnings, 0) + COALESCE(NEW.tips, 0) + COALESCE(NEW.platform_fee, 0)
    ELSE
      COALESCE(NEW.gross_earnings, 0) + COALESCE(NEW.tips, 0) - COALESCE(NEW.platform_fee, 0)
  END;

  payout := ROUND((ni - COALESCE(NEW.company_commission, 0) - ABS(COALESCE(NEW.daily_cash, 0)))::numeric, 2);

  NEW.driver_payout := payout;
  NEW.net_earnings := payout;
  RETURN NEW;
END;
$$;

ALTER TABLE earnings_records
  ADD COLUMN driver_payout_after_cash DECIMAL(10, 2)
    GENERATED ALWAYS AS (
      ROUND(
        (
          CASE
            WHEN COALESCE(platform_fee, 0) < 0 THEN
              COALESCE(gross_earnings, 0) + COALESCE(tips, 0) + COALESCE(platform_fee, 0)
            ELSE
              COALESCE(gross_earnings, 0) + COALESCE(tips, 0) - COALESCE(platform_fee, 0)
          END
          - COALESCE(company_commission, 0)
          - ABS(COALESCE(daily_cash, 0))
        )::numeric,
        2
      )
    ) STORED;

CREATE TRIGGER trg_earnings_records_payout_after_cash
BEFORE INSERT OR UPDATE OF
  gross_earnings,
  platform_fee,
  tips,
  company_commission,
  daily_cash,
  total_transfer_earnings
ON earnings_records
FOR EACH ROW
EXECUTE FUNCTION trg_enforce_driver_payout_after_cash();

-- Force row-level payout refresh
UPDATE earnings_records
SET gross_earnings = gross_earnings
WHERE id IS NOT NULL;

UPDATE earnings_records
SET driver_payout = driver_payout_after_cash,
    net_earnings = driver_payout_after_cash
WHERE driver_payout IS DISTINCT FROM driver_payout_after_cash
   OR net_earnings IS DISTINCT FROM driver_payout_after_cash;

-- Roll up period raw net and total_net_earnings from corrected row payouts
UPDATE driver_payouts dp
SET
  raw_net_amount = COALESCE(agg.payout, 0)::numeric(12, 2),
  total_net_earnings = COALESCE(agg.payout, 0)::numeric(12, 2)
FROM (
  SELECT
    ei.organization_id,
    er.driver_id,
    ei.week_start,
    ei.week_end,
    SUM(COALESCE(er.driver_payout, 0))::numeric AS payout
  FROM earnings_records er
  INNER JOIN earnings_imports ei ON ei.id = er.import_id
  GROUP BY ei.organization_id, er.driver_id, ei.week_start, ei.week_end
) agg
WHERE dp.organization_id = agg.organization_id
  AND dp.driver_id = agg.driver_id
  AND dp.payment_period_start = agg.week_start
  AND dp.payment_period_end = agg.week_end;

COMMIT;
