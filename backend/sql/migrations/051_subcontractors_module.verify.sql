-- After 051: row payout matches generated column (includes subcontractor_commission)
SELECT 'earnings_records_payout_mismatch' AS check_name, er.id::text
FROM earnings_records er
WHERE er.driver_payout IS DISTINCT FROM er.driver_payout_after_cash;

-- Sub-managed drivers: payroll rent must be zero
SELECT 'sub_driver_payroll_rent_nonzero' AS check_name, d.id::text
FROM drivers d
WHERE d.subcontractor_id IS NOT NULL
  AND calculate_rental_fee(d.organization_id, d.id, CURRENT_DATE - 30, CURRENT_DATE, false) <> 0;
