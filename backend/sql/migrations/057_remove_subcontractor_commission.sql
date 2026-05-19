-- Remove subcontractor internal commission; fleet company_commission only.
BEGIN;

ALTER TABLE subcontractors
    RENAME COLUMN fleet_commission_rate_pct TO commission_rate;

ALTER TABLE subcontractors
    DROP COLUMN IF EXISTS subcontractor_commission_rate_pct;

ALTER TABLE earnings_records DROP COLUMN IF EXISTS driver_payout_after_cash;

DROP TRIGGER IF EXISTS trg_earnings_records_payout_after_cash ON earnings_records;

ALTER TABLE earnings_records
    DROP COLUMN IF EXISTS subcontractor_commission;

ALTER TABLE driver_payouts
    DROP COLUMN IF EXISTS subcontractor_commission;

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

    payout := ROUND((
        ni
        - COALESCE(NEW.company_commission, 0)
        - ABS(COALESCE(NEW.daily_cash, 0))
    )::numeric, 2);

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

COMMIT;
