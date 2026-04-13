-- Guardrails: ensure cash commission always affects payout.
-- PostgreSQL implementation (project DB is Postgres).

ALTER TABLE earnings_records
  ADD COLUMN IF NOT EXISTS has_cash_commission BOOLEAN
    GENERATED ALWAYS AS (COALESCE(cash_commission, 0) < 0) STORED;

ALTER TABLE earnings_records
  ADD COLUMN IF NOT EXISTS driver_payout_after_cash DECIMAL(10, 2)
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

  -- Keep net_earnings aligned with payout semantics used in this codebase.
  NEW.net_earnings := NEW.driver_payout;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_earnings_records_payout_after_cash ON earnings_records;
CREATE TRIGGER trg_earnings_records_payout_after_cash
BEFORE INSERT OR UPDATE OF
  total_transfer_earnings, net_earnings, gross_earnings, platform_fee, company_commission
ON earnings_records
FOR EACH ROW
EXECUTE FUNCTION trg_enforce_driver_payout_after_cash();

-- Bulk repair: all records that have negative cash commission.
UPDATE earnings_records
SET
  driver_payout = driver_payout_after_cash,
  net_earnings = driver_payout_after_cash
WHERE cash_commission < 0;

-- Explicit broken-record repair (id provided in bug report).
UPDATE earnings_records
SET
  driver_payout = driver_payout_after_cash,
  net_earnings = driver_payout_after_cash
WHERE id = '498c3265-1da4-44b6-b277-eb33298b55e1'::uuid;

-- Re-aggregate driver_payments for periods touched by repaired records.
WITH affected AS (
  SELECT DISTINCT
    ei.organization_id,
    er.driver_id,
    ei.week_start,
    ei.week_end
  FROM earnings_records er
  JOIN earnings_imports ei ON ei.id = er.import_id
  WHERE er.cash_commission < 0
     OR er.id = '498c3265-1da4-44b6-b277-eb33298b55e1'::uuid
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
