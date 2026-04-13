-- Fix generated payout-after-cash formula:
-- payout_after_cash = transfer_base - ABS(transfer_commission) - ABS(cash_commission)
-- with floor at 0.

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
            ) - ABS(COALESCE(transfer_commission, 0)) - ABS(COALESCE(cash_commission, 0))
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

CREATE OR REPLACE FUNCTION trg_enforce_driver_payout_after_cash()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  transfer_base numeric;
BEGIN
  transfer_base := COALESCE(
    NEW.total_transfer_earnings,
    NEW.net_earnings,
    COALESCE(NEW.gross_earnings, 0) - COALESCE(NEW.platform_fee, 0),
    NEW.gross_earnings,
    0
  );

  NEW.driver_payout := GREATEST(
    0,
    ROUND(
      (
        transfer_base
        - ABS(COALESCE(NEW.transfer_commission, 0))
        - ABS(COALESCE(NEW.cash_commission, 0))
      )::numeric,
      2
    )
  );
  NEW.net_earnings := NEW.driver_payout;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_earnings_records_payout_after_cash ON earnings_records;
CREATE TRIGGER trg_earnings_records_payout_after_cash
BEFORE INSERT OR UPDATE OF
  total_transfer_earnings, net_earnings, gross_earnings, platform_fee,
  transfer_commission, cash_commission, company_commission
ON earnings_records
FOR EACH ROW
EXECUTE FUNCTION trg_enforce_driver_payout_after_cash();

UPDATE earnings_records
SET
  driver_payout = driver_payout_after_cash,
  net_earnings = driver_payout_after_cash
WHERE COALESCE(cash_commission, 0) < 0
   OR id = '244e8273-c8ed-4a15-a54a-c76931e38e8d'::uuid;

WITH affected AS (
  SELECT DISTINCT
    ei.organization_id,
    er.driver_id,
    ei.week_start,
    ei.week_end
  FROM earnings_records er
  JOIN earnings_imports ei ON ei.id = er.import_id
  WHERE COALESCE(er.cash_commission, 0) < 0
     OR er.id = '244e8273-c8ed-4a15-a54a-c76931e38e8d'::uuid
),
agg AS (
  SELECT
    a.organization_id,
    a.driver_id,
    a.week_start,
    a.week_end,
    COALESCE(SUM(er.driver_payout), 0)::numeric(10, 2) AS payout_sum,
    COALESCE(SUM(er.net_earnings), 0)::numeric(12, 2) AS net_sum
  FROM affected a
  LEFT JOIN earnings_imports ei
    ON ei.organization_id = a.organization_id
   AND ei.week_start = a.week_start
   AND ei.week_end = a.week_end
   AND ei.status = 'completed'
  LEFT JOIN earnings_records er
    ON er.import_id = ei.id
   AND er.driver_id = a.driver_id
  GROUP BY a.organization_id, a.driver_id, a.week_start, a.week_end
)
UPDATE driver_payments dp
SET
  net_driver_payout = agg.payout_sum,
  total_net_earnings = agg.net_sum
FROM agg
WHERE dp.organization_id = agg.organization_id
  AND dp.driver_id = agg.driver_id
  AND dp.payment_period_start = agg.week_start
  AND dp.payment_period_end = agg.week_end;
