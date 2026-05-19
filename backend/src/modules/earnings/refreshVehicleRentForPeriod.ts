import type { PoolClient } from "pg";
import { applyDebtCarryForward } from "./debtAllocation";
import { syncPayoutRentEntries } from "./payoutRentEntries";

/** Recompute vehicle_rental_fee from rentals, sync rent line items, and re-apply debt for a period. */
export async function refreshVehicleRentForPeriod(
  client: PoolClient,
  orgId: string,
  periodStart: string,
  periodEnd: string,
): Promise<{ feesUpdated: number; payoutsSynced: number }> {
  const feeRes = await client.query<{ n: string }>(
    `SELECT refresh_driver_payout_vehicle_fees($1::uuid)::text AS n`,
    [orgId],
  );
  const feesUpdated = parseInt(feeRes.rows[0]?.n ?? "0", 10);

  const payoutsRes = await client.query<{ id: string }>(
    `SELECT id::text
     FROM driver_payouts
     WHERE organization_id = $1::uuid
       AND payment_period_start = $2::date
       AND payment_period_end = $3::date`,
    [orgId, periodStart, periodEnd],
  );

  for (const row of payoutsRes.rows) {
    await syncPayoutRentEntries(client, orgId, row.id);
    await applyDebtCarryForward(client, orgId, row.id);
  }

  return { feesUpdated, payoutsSynced: payoutsRes.rows.length };
}
