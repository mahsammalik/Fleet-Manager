-- Rows where SUM(net_driver_payout) does not match component formula (should return no rows)
SELECT 'sub_settlement_integrity_fail' AS check_name,
       st.subcontractor_id::text,
       st.total_payable::text,
       st.amount_expected::text,
       (st.total_payable - st.amount_expected)::text AS delta
FROM subcontractor_payouts sp
CROSS JOIN LATERAL subcontractor_settlement_totals(
    sp.organization_id, sp.payment_period_start, sp.payment_period_end
) st
WHERE st.subcontractor_id = sp.subcontractor_id
  AND st.integrity_ok IS NOT TRUE;
