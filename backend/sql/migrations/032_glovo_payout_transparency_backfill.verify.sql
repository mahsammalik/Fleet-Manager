-- Optional sanity read after 032 (expect increasing counts as backfill runs).

SELECT COUNT(*)::bigint AS driver_payouts_with_gross_income
FROM driver_payouts
WHERE gross_income IS NOT NULL;
