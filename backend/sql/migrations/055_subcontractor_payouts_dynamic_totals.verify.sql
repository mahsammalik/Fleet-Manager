-- Aggregate columns removed
SELECT 'sub_payout_stale_total_income_column' AS check_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'subcontractor_payouts'
  AND column_name IN (
    'total_income', 'total_tips', 'total_fleet_commission',
    'total_subcontractor_commission', 'total_driver_net_payout',
    'driver_payout_count', 'rent_charge_amount', 'rent_charge_status', 'amount_payable'
  );

-- payment_reference present
SELECT 'sub_payout_missing_payment_reference' AS check_name, 1
WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'subcontractor_payouts'
      AND column_name = 'payment_reference'
);

-- paid_amount present
SELECT 'sub_payout_missing_paid_amount' AS check_name, 1
WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'subcontractor_payouts'
      AND column_name = 'paid_amount'
);

-- Totals function matches manual SUM for one sample period (if data exists; empty = pass)
WITH sample AS (
    SELECT sp.organization_id AS org_id,
           sp.payment_period_start AS p_start,
           sp.payment_period_end AS p_end
    FROM subcontractor_payouts sp
    LIMIT 1
),
fn AS (
    SELECT t.subcontractor_id,
           t.amount_payable
    FROM sample
    CROSS JOIN LATERAL subcontractor_settlement_totals(
        sample.org_id, sample.p_start, sample.p_end
    ) t
),
manual AS (
    SELECT d.subcontractor_id AS sid,
           GREATEST(
               0::numeric,
               ROUND((
                   ROUND(COALESCE(SUM(dp.income), 0)::numeric, 2)
                 + ROUND(COALESCE(SUM(dp.tips), 0)::numeric, 2)
                 - ROUND(COALESCE(SUM(dp.company_commission), 0)::numeric, 2)
                 - COALESCE((
                       SELECT rc.amount
                       FROM subcontractor_rent_charges rc
                       WHERE rc.organization_id = sample.org_id
                         AND rc.subcontractor_id = d.subcontractor_id
                         AND rc.period_start = sample.p_start
                         AND rc.period_end = sample.p_end
                       LIMIT 1
                   ), 0)
               )::numeric, 2)
           ) AS amount_payable
    FROM sample
    INNER JOIN driver_payouts dp
      ON dp.organization_id = sample.org_id
     AND dp.payment_period_start = sample.p_start
     AND dp.payment_period_end = sample.p_end
    INNER JOIN drivers d
      ON d.id = dp.driver_id
     AND d.organization_id = dp.organization_id
     AND d.subcontractor_id IS NOT NULL
    GROUP BY d.subcontractor_id, sample.org_id, sample.p_start, sample.p_end
)
SELECT 'sub_settlement_totals_mismatch' AS check_name,
       fn.subcontractor_id::text,
       fn.amount_payable::text AS fn_payable,
       manual.amount_payable::text AS manual_payable
FROM fn
INNER JOIN manual ON manual.sid = fn.subcontractor_id
WHERE fn.amount_payable IS DISTINCT FROM manual.amount_payable;
