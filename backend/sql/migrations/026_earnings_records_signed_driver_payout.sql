-- Allow negative driver_payout / net_earnings at trip level for debt accounting.
-- Removes GREATEST(0, ...) from trigger and from driver_payout_after_cash generated column.

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
          ) - ABS(COALESCE(transfer_commission, 0)) - ABS(COALESCE(cash_commission, 0))
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

-- Align stored trip payouts with signed formula where the old floor hid negatives.
UPDATE earnings_records
SET
  driver_payout = driver_payout_after_cash,
  net_earnings = driver_payout_after_cash
WHERE driver_payout IS DISTINCT FROM driver_payout_after_cash;
