-- Single fleet commission on platform net income; remove dual-leg columns.
-- Backfills earnings_records from drivers, then driver_payouts rollups from earnings.

-- 1) Backfill company_commission on earnings_records (net = gross + tips with taxa sign rule)
UPDATE earnings_records er
SET company_commission = sub.cc
FROM (
  SELECT
    er2.id,
    ROUND(
      (
        CASE
          WHEN COALESCE(dr.minimum_commission, 0) > 0 THEN
            GREATEST(bc.base_cc, COALESCE(dr.minimum_commission, 0)::numeric)
          ELSE bc.base_cc
        END
      )::numeric,
      2
    ) AS cc
  FROM earnings_records er2
  INNER JOIN drivers dr ON dr.id = er2.driver_id
  CROSS JOIN LATERAL (
    SELECT
      CASE
        WHEN COALESCE(er2.platform_fee, 0) < 0 THEN
          COALESCE(er2.gross_earnings, 0) + COALESCE(er2.tips, 0) + COALESCE(er2.platform_fee, 0)
        ELSE
          COALESCE(er2.gross_earnings, 0) + COALESCE(er2.tips, 0) - COALESCE(er2.platform_fee, 0)
      END AS ni
  ) nx
  CROSS JOIN LATERAL (
    SELECT
      CASE dr.commission_type
        WHEN 'fixed_amount' THEN COALESCE(dr.fixed_commission_amount, 0)::numeric
        WHEN 'hybrid' THEN (nx.ni * COALESCE(dr.commission_rate, 0) / 100) + COALESCE(dr.fixed_commission_amount, 0)
        ELSE (nx.ni * COALESCE(dr.commission_rate, 0) / 100)
      END AS base_cc
  ) bc
) sub
WHERE er.id = sub.id;

-- 2) Align driver_payout / net_earnings on earnings_records with new formula (before trigger swap)
UPDATE earnings_records er
SET
  driver_payout = ROUND(
    (
      CASE
        WHEN COALESCE(er.platform_fee, 0) < 0 THEN
          COALESCE(er.gross_earnings, 0) + COALESCE(er.tips, 0) + COALESCE(er.platform_fee, 0)
        ELSE
          COALESCE(er.gross_earnings, 0) + COALESCE(er.tips, 0) - COALESCE(er.platform_fee, 0)
      END
      - COALESCE(er.company_commission, 0)
      - COALESCE(er.daily_cash, 0)
    )::numeric,
    2
  ),
  net_earnings = ROUND(
    (
      CASE
        WHEN COALESCE(er.platform_fee, 0) < 0 THEN
          COALESCE(er.gross_earnings, 0) + COALESCE(er.tips, 0) + COALESCE(er.platform_fee, 0)
        ELSE
          COALESCE(er.gross_earnings, 0) + COALESCE(er.tips, 0) - COALESCE(er.platform_fee, 0)
      END
      - COALESCE(er.company_commission, 0)
      - COALESCE(er.daily_cash, 0)
    )::numeric,
    2
  );

-- 3) Drop old trigger and generated column that referenced leg columns
DROP TRIGGER IF EXISTS trg_earnings_records_payout_after_cash ON earnings_records;
ALTER TABLE earnings_records DROP COLUMN IF EXISTS driver_payout_after_cash;
ALTER TABLE earnings_records DROP COLUMN IF EXISTS transfer_commission;
ALTER TABLE earnings_records DROP COLUMN IF EXISTS cash_commission;

-- 4) New generated column: net - company - daily_cash
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
          - COALESCE(daily_cash, 0)
        )::numeric,
        2
      )
    ) STORED;

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

  payout := ROUND((ni - COALESCE(NEW.company_commission, 0) - COALESCE(NEW.daily_cash, 0))::numeric, 2);

  NEW.driver_payout := payout;
  NEW.net_earnings := payout;
  RETURN NEW;
END;
$$;

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

UPDATE earnings_records
SET driver_payout = driver_payout_after_cash, net_earnings = driver_payout_after_cash
WHERE driver_payout IS DISTINCT FROM driver_payout_after_cash;

-- 5) driver_payouts: remove generated total and leg columns, refresh rollups from earnings
ALTER TABLE driver_payouts DROP COLUMN IF EXISTS total_commission;
ALTER TABLE driver_payouts DROP COLUMN IF EXISTS transfer_commission;
ALTER TABLE driver_payouts DROP COLUMN IF EXISTS cash_commission;

UPDATE driver_payouts dp
SET
  company_commission = COALESCE(agg.comm, 0)::numeric(12, 2),
  raw_net_amount = COALESCE(agg.payout, 0)::numeric(12, 2),
  gross_income = COALESCE(agg.gross_income, 0)::numeric(12, 6),
  net_income = COALESCE(agg.net_income, 0)::numeric(12, 6),
  commission_base = COALESCE(agg.net_income, 0)::numeric(12, 6)
FROM (
  SELECT
    ei.organization_id,
    er.driver_id,
    ei.week_start,
    ei.week_end,
    SUM(COALESCE(er.company_commission, 0))::numeric AS comm,
    SUM(COALESCE(er.driver_payout, 0))::numeric AS payout,
    SUM(
      COALESCE(er.gross_earnings, 0) + COALESCE(er.tips, 0)
    )::numeric AS gross_income,
    SUM(
      CASE
        WHEN COALESCE(er.platform_fee, 0) < 0 THEN
          COALESCE(er.gross_earnings, 0) + COALESCE(er.tips, 0) + COALESCE(er.platform_fee, 0)
        ELSE
          COALESCE(er.gross_earnings, 0) + COALESCE(er.tips, 0) - COALESCE(er.platform_fee, 0)
      END
    )::numeric AS net_income
  FROM earnings_records er
  INNER JOIN earnings_imports ei ON ei.id = er.import_id
  GROUP BY ei.organization_id, er.driver_id, ei.week_start, ei.week_end
) agg
WHERE dp.organization_id = agg.organization_id
  AND dp.driver_id = agg.driver_id
  AND dp.payment_period_start = agg.week_start
  AND dp.payment_period_end = agg.week_end;
