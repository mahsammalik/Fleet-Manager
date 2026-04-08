-- Rollback structural changes for 017 fix.
-- Data corrections are not reverted automatically.

DROP TRIGGER IF EXISTS trg_earnings_records_payout_after_cash ON earnings_records;
DROP FUNCTION IF EXISTS trg_enforce_driver_payout_after_cash();

ALTER TABLE earnings_records
  DROP COLUMN IF EXISTS driver_payout_after_cash;

ALTER TABLE earnings_records
  ADD COLUMN driver_payout_after_cash DECIMAL(10, 2)
    GENERATED ALWAYS AS (
      GREATEST(
        0,
        ROUND(
          (
            COALESCE(
              total_transfer_earnings,
              net_earnings,
              COALESCE(gross_earnings, 0) - COALESCE(platform_fee, 0),
              gross_earnings,
              0
            ) - COALESCE(company_commission, 0)
          )::numeric,
          2
        )
      )
    ) STORED;

ALTER TABLE earnings_records
  DROP COLUMN IF EXISTS has_cash_commission;

ALTER TABLE earnings_records
  ADD COLUMN has_cash_commission BOOLEAN
    GENERATED ALWAYS AS (COALESCE(cash_commission, 0) < 0) STORED;
