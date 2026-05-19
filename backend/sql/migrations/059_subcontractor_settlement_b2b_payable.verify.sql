WITH sample AS (
    SELECT sp.organization_id AS org_id,
           sp.payment_period_start AS p_start,
           sp.payment_period_end AS p_end,
           sp.subcontractor_id AS sid
    FROM subcontractor_payouts sp
    LIMIT 1
),
st AS (
    SELECT t.*
    FROM sample
    CROSS JOIN LATERAL subcontractor_settlement_totals(
        sample.org_id, sample.p_start, sample.p_end
    ) t
    WHERE t.subcontractor_id = sample.sid
),
manual AS (
    SELECT
        ROUND(COALESCE(SUM(dp.total_gross_earnings), 0)::numeric, 2) AS gross_sum,
        GREATEST(
            0::numeric,
            ROUND((
                ROUND(COALESCE(SUM(dp.total_gross_earnings), 0)::numeric, 2)
                - ROUND(COALESCE(SUM(dp.company_commission), 0)::numeric, 2)
                - ROUND(COALESCE(SUM(dp.vehicle_rental_fee), 0)::numeric, 2)
                - ROUND(COALESCE(SUM(dp.total_platform_fees), 0)::numeric, 2)
                - ROUND(COALESCE(SUM(dp.account_opening_fee), 0)::numeric, 2)
                - ROUND(COALESCE(SUM(dp.total_daily_cash), 0)::numeric, 2)
            )::numeric, 2)
        ) AS payable_sum
    FROM sample
    INNER JOIN driver_payouts dp
      ON dp.organization_id = sample.org_id
     AND dp.payment_period_start = sample.p_start
     AND dp.payment_period_end = sample.p_end
    INNER JOIN drivers d
      ON d.id = dp.driver_id
     AND d.organization_id = dp.organization_id
     AND d.subcontractor_id = sample.sid
)
SELECT 'sub_settlement_b2b_payable_mismatch' AS check_name,
       st.total_payable::text,
       manual.payable_sum::text
FROM st
CROSS JOIN manual
WHERE st.total_payable IS DISTINCT FROM manual.payable_sum;
