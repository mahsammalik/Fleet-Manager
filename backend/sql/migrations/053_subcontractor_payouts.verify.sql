-- Orphan sub-managed driver payout without parent link
SELECT 'sub_driver_payout_missing_parent' AS check_name, dp.id::text
FROM driver_payouts dp
INNER JOIN drivers d ON d.id = dp.driver_id AND d.organization_id = dp.organization_id
WHERE d.subcontractor_id IS NOT NULL
  AND dp.subcontractor_payout_id IS NULL;

-- Legacy 053 verify: superseded by 054_subcontractor_settlement_simplified.verify.sql after migration 054.

-- Duplicate parent per period
SELECT 'sub_payout_duplicate_period' AS check_name, sp.subcontractor_id::text
FROM subcontractor_payouts sp
GROUP BY sp.organization_id, sp.subcontractor_id, sp.payment_period_start, sp.payment_period_end
HAVING COUNT(*) > 1;
