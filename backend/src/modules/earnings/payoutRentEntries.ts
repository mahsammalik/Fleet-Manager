import type { PoolClient } from "pg";

/**
 * Rebuilds payroll vehicle rent line item from driver vehicle assignment (weekly_rent),
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
    `INSERT INTO payout_rent_entries (driver_payout_id, entry_type, amount, description)
     SELECT $1::uuid,
            'current_week',
            calculate_rental_fee(dp.organization_id, dp.driver_id, dp.payment_period_start, dp.payment_period_end),
            (
              'Weekly vehicle rent'
              || COALESCE(' (' || v.license_plate || ')', '')
              || ' for period '
              || dp.payment_period_start::text
              || '–'
              || dp.payment_period_end::text
            )
     FROM driver_payouts dp
     LEFT JOIN drivers d ON d.id = dp.driver_id AND d.organization_id = dp.organization_id
     LEFT JOIN vehicles v ON v.id = d.current_vehicle_id AND v.organization_id = d.organization_id
     WHERE dp.id = $1::uuid
       AND calculate_rental_fee(dp.organization_id, dp.driver_id, dp.payment_period_start, dp.payment_period_end) > 0`,
    [payoutId],
  );

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
