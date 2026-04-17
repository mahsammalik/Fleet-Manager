-- Negative TVT: transfer_commission is negative (rate * negative base).
-- Use signed subtraction so driver_payout is not overstated vs ABS(commission).

ALTER TABLE earnings_records DROP COLUMN IF EXISTS driver_payout_after_cash;

ALTER TABLE earnings_records
  ADD COLUMN driver_payout_after_cash DECIMAL(10, 2)
    GENERATED ALWAYS AS (
      ROUND(
        (
          COALESCE(
            total_transfer_earnings,
            net_earnings,
            COALESCE(gross_earnings, 0) - COALESCE(platform_fee, 0),
            gross_earnings,
            0
          ) - COALESCE(transfer_commission, 0) - COALESCE(cash_commission, 0)
        )::numeric,
        2
      )
    ) STORED;

CREATE OR REPLACE FUNCTION trg_enforce_driver_payout_after_cash()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  transfer_base numeric;
  payout numeric;
BEGIN
  transfer_base := COALESCE(
    NEW.total_transfer_earnings,
    NEW.net_earnings,
    COALESCE(NEW.gross_earnings, 0) - COALESCE(NEW.platform_fee, 0),
    NEW.gross_earnings,
    0
  );

  payout := ROUND(
    (
      transfer_base
      - COALESCE(NEW.transfer_commission, 0)
      - COALESCE(NEW.cash_commission, 0)
    )::numeric,
    2
  );

  NEW.driver_payout := payout;
  NEW.net_earnings := payout;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_earnings_records_payout_after_cash ON earnings_records;
CREATE TRIGGER trg_earnings_records_payout_after_cash
BEFORE INSERT OR UPDATE OF
  total_transfer_earnings,
  net_earnings,
  gross_earnings,
  platform_fee,
  transfer_commission,
  cash_commission,
  company_commission
ON earnings_records
FOR EACH ROW
EXECUTE FUNCTION trg_enforce_driver_payout_after_cash();

UPDATE earnings_records
SET
  driver_payout = driver_payout_after_cash,
  net_earnings = driver_payout_after_cash
WHERE driver_payout IS DISTINCT FROM driver_payout_after_cash;
