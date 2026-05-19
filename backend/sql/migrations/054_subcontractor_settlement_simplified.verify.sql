-- amount_payable = income + tips - fleet commission - rent (B2B lump sum)
SELECT 'sub_payout_amount_mismatch' AS check_name, sp.id::text
FROM subcontractor_payouts sp
WHERE sp.amount_payable IS DISTINCT FROM GREATEST(
    0::numeric,
    ROUND(
        (COALESCE(sp.total_income, 0)
         + COALESCE(sp.total_tips, 0)
         - COALESCE(sp.total_fleet_commission, 0)
         - COALESCE(sp.rent_charge_amount, 0))::numeric,
        2
    )
);
