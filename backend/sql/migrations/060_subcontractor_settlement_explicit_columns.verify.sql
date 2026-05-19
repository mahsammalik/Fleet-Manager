-- Verify settlement totals: payable equals SUM(net_driver_payout); fee columns are separate.
WITH sample AS (
    SELECT organization_id, payment_period_start, payment_period_end
    FROM driver_payouts
    WHERE payment_period_start IS NOT NULL
    LIMIT 1
),
st AS (
    SELECT st.*
    FROM sample s
    CROSS JOIN LATERAL subcontractor_settlement_totals(
        s.organization_id,
        s.payment_period_start,
        s.payment_period_end
    ) st
),
manual AS (
    SELECT d.subcontractor_id,
           ROUND(COALESCE(SUM(dp.net_driver_payout), 0)::numeric, 2) AS net_sum
    FROM sample s
    INNER JOIN driver_payouts dp
      ON dp.organization_id = s.organization_id
     AND dp.payment_period_start = s.payment_period_start
     AND dp.payment_period_end = s.payment_period_end
    INNER JOIN drivers d
      ON d.id = dp.driver_id
     AND d.organization_id = dp.organization_id
    WHERE d.subcontractor_id IS NOT NULL
    GROUP BY d.subcontractor_id
)
SELECT st.subcontractor_id,
       st.total_payable::text,
       m.net_sum::text,
       (st.total_payable - m.net_sum)::text AS payable_delta
FROM st
INNER JOIN manual m ON m.subcontractor_id = st.subcontractor_id
WHERE ABS(st.total_payable - m.net_sum) > 0.01;
