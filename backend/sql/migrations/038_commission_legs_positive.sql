-- Commission legs are stored as non-negative magnitudes (fleet deductions).
-- Align generated payout, has_cash_commission (was cash_commission < 0), trigger, and driver_payouts.total_commission.

-- 1. Replace driver_payout_after_cash to subtract ABS of both legs (matches post-backfill semantics).
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
          ) - ABS(COALESCE(transfer_commission, 0))
            - ABS(COALESCE(cash_commission, 0))
        )::numeric,
        2
      )
    ) STORED;

-- 2. has_cash_commission: daily cash activity (no longer tied to negative cash_commission).
ALTER TABLE earnings_records DROP COLUMN IF EXISTS has_cash_commission;

ALTER TABLE earnings_records
  ADD COLUMN has_cash_commission BOOLEAN
    GENERATED ALWAYS AS (COALESCE(daily_cash, 0) <> 0) STORED;

-- 3. Trigger: same deduction as generated column.
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
      - ABS(COALESCE(NEW.transfer_commission, 0))
      - ABS(COALESCE(NEW.cash_commission, 0))
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

-- 4. Normalize leg columns (fires trigger → driver_payout / net_earnings).
UPDATE earnings_records
SET
  transfer_commission = ABS(COALESCE(transfer_commission, 0)),
  cash_commission = ABS(COALESCE(cash_commission, 0))
WHERE transfer_commission IS DISTINCT FROM ABS(COALESCE(transfer_commission, 0))
   OR cash_commission IS DISTINCT FROM ABS(COALESCE(cash_commission, 0));

UPDATE earnings_records
SET
  driver_payout = driver_payout_after_cash,
  net_earnings = driver_payout_after_cash
WHERE driver_payout IS DISTINCT FROM driver_payout_after_cash;

-- 5. Period rollups: positive legs + hardened generated total.
ALTER TABLE driver_payouts DROP COLUMN IF EXISTS total_commission;

ALTER TABLE driver_payouts
  ADD COLUMN total_commission NUMERIC(12, 6) GENERATED ALWAYS AS (
    ABS(COALESCE(transfer_commission, 0)) + ABS(COALESCE(cash_commission, 0))
  ) STORED;

UPDATE driver_payouts
SET
  transfer_commission = ABS(COALESCE(transfer_commission, 0)),
  cash_commission = ABS(COALESCE(cash_commission, 0))
WHERE transfer_commission IS DISTINCT FROM ABS(COALESCE(transfer_commission, 0))
   OR cash_commission IS DISTINCT FROM ABS(COALESCE(cash_commission, 0));

COMMENT ON COLUMN driver_payouts.transfer_commission IS 'Period sum of transfer-leg fleet commission (non-negative magnitude).';
COMMENT ON COLUMN driver_payouts.cash_commission IS 'Period sum of cash-leg fleet commission (non-negative magnitude).';
COMMENT ON COLUMN driver_payouts.total_commission IS 'Generated: ABS(transfer_commission) + ABS(cash_commission); equals leg sum when legs are normalized.';
