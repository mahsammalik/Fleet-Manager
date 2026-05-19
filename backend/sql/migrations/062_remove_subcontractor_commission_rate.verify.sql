-- Period total_commission matches SUM(company_commission) by subcontractor_payout_id (after refresh).
WITH linked AS (
    SELECT sp.id AS payout_id,
           sp.organization_id,
           sp.subcontractor_id,
           sp.payment_period_start,
           sp.payment_period_end
    FROM subcontractor_payouts sp
    WHERE EXISTS (
        SELECT 1 FROM driver_payouts dp WHERE dp.subcontractor_payout_id = sp.id
    )
    LIMIT 50
),
period_st AS (
    SELECT l.payout_id,
           st.total_commission AS period_commission
    FROM linked l
    CROSS JOIN LATERAL subcontractor_settlement_totals(
        l.organization_id,
        l.payment_period_start,
        l.payment_period_end
    ) st
    WHERE st.subcontractor_id = l.subcontractor_id
),
fk_sum AS (
    SELECT l.payout_id,
           ROUND(COALESCE(SUM(dp.company_commission), 0)::numeric, 2) AS fk_commission
    FROM linked l
    INNER JOIN driver_payouts dp ON dp.subcontractor_payout_id = l.payout_id
    GROUP BY l.payout_id
)
SELECT p.payout_id::text,
       p.period_commission::text,
       f.fk_commission::text,
       (p.period_commission - f.fk_commission)::text AS delta
FROM period_st p
INNER JOIN fk_sum f ON f.payout_id = p.payout_id
WHERE ABS(p.period_commission - f.fk_commission) > 0.01;
