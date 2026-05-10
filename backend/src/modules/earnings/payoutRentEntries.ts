import type { PoolClient } from "pg";

/**
 * Rebuilds payroll vehicle rent line items for one payout (current_week + overdue carry),
 * updates vehicle_rental_fee and raw_net_amount from entry totals (includes adjustment rows).
 */
export async function syncPayoutRentEntries(client: PoolClient, orgId: string, payoutId: string): Promise<void> {
  const lockRes = await client.query<{ driver_id: string }>(
    `SELECT driver_id::text
     FROM driver_payouts
     WHERE id = $1::uuid AND organization_id = $2::uuid
     FOR UPDATE`,
    [payoutId, orgId],
  );
  if (!lockRes.rows[0]) return;

  await client.query(
    `DELETE FROM payout_rent_entries
     WHERE driver_payout_id = $1::uuid
       AND entry_type IN ('current_week', 'overdue')`,
    [payoutId],
  );

  await client.query(
    `INSERT INTO payout_rent_entries (driver_payout_id, vehicle_rental_id, entry_type, amount, description)
     SELECT $1::uuid,
            v.vehicle_rental_id,
            'current_week',
            v.amount,
            ('Prorated rent for period ' || dp.payment_period_start::text || '–' || dp.payment_period_end::text)
     FROM driver_payouts dp
     CROSS JOIN LATERAL allocate_vehicle_rent_pieces(
       dp.organization_id,
       dp.driver_id,
       dp.payment_period_start,
       dp.payment_period_end,
       false
     ) v
     WHERE dp.id = $1::uuid`,
    [payoutId],
  );

  const prevRes = await client.query<{ prev_id: string | null }>(
    `WITH bounds AS (
       SELECT
         dp.organization_id,
         dp.driver_id,
         (dp.payment_period_start - (dp.payment_period_end - dp.payment_period_start + 1))::date AS prev_start,
         (dp.payment_period_start - 1)::date AS prev_end,
         dp.payment_period_start AS cur_start,
         dp.payment_period_end AS cur_end
       FROM driver_payouts dp
       WHERE dp.id = $1::uuid AND dp.organization_id = $2::uuid
     )
     SELECT prev.id::text AS prev_id
     FROM bounds b
     LEFT JOIN driver_payouts prev
       ON prev.organization_id = b.organization_id
       AND prev.driver_id = b.driver_id
       AND prev.payment_period_start = b.prev_start
       AND prev.payment_period_end = b.prev_end`,
    [payoutId, orgId],
  );
  const prevId = prevRes.rows[0]?.prev_id ?? null;

  if (prevId) {
    await client.query(
      `INSERT INTO payout_rent_entries (driver_payout_id, vehicle_rental_id, entry_type, amount, description)
       SELECT $1::uuid,
              a.vehicle_rental_id,
              'overdue',
              a.amount,
              ('Prior-week payroll rent unpaid (' || b.prev_start::text || '–' || b.prev_end::text || ')')
       FROM driver_payouts dp
       CROSS JOIN LATERAL (
         SELECT
           (dp.payment_period_start - (dp.payment_period_end - dp.payment_period_start + 1))::date AS prev_start,
           (dp.payment_period_start - 1)::date AS prev_end
       ) b
       CROSS JOIN LATERAL allocate_rental_fee(dp.organization_id, dp.driver_id, b.prev_start, b.prev_end) a
       WHERE dp.id = $1::uuid
         AND a.amount > 0
         AND NOT EXISTS (
           SELECT 1 FROM rent_payments rp
           WHERE rp.driver_payout_id = $2::uuid
             AND rp.vehicle_rental_id = a.vehicle_rental_id
         )
         AND EXISTS (
           SELECT 1 FROM vehicle_rentals vr
           WHERE vr.id = a.vehicle_rental_id
             AND vr.status = 'active'
             AND vr.rental_end_date >= dp.payment_period_start
             AND vr.rental_start_date <= dp.payment_period_end
         )`,
      [payoutId, prevId],
    );
  }

  await client.query(
    `UPDATE driver_payouts dp
     SET
       vehicle_rental_fee = COALESCE(agg.sum_amt, 0),
       raw_net_amount = ROUND((
         COALESCE(dp.total_net_earnings, 0)::numeric
         - ABS(COALESCE(dp.account_opening_fee, 0)::numeric)
         - COALESCE(agg.sum_amt, 0)::numeric
       )::numeric, 2),
       updated_at = NOW()
     FROM (
       SELECT ROUND(COALESCE(SUM(amount), 0)::numeric, 2) AS sum_amt
       FROM payout_rent_entries
       WHERE driver_payout_id = $1::uuid
         AND entry_type IN ('current_week', 'overdue', 'adjustment')
     ) agg
     WHERE dp.id = $1::uuid`,
    [payoutId],
  );
}
