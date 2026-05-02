/**
 * Re-run debt allocation for every (organization, driver) after payout formula / raw_net changes (e.g. migration 041).
 *
 *   cd backend && npm run recompute-payout-debt
 */
import "dotenv/config";
import { pool } from "../src/db/pool";
import { recomputeDriverDebtAllocation } from "../src/modules/earnings/debtAllocation";

async function main() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ organization_id: string; driver_id: string }>(
      `SELECT DISTINCT organization_id::text, driver_id::text FROM driver_payouts`,
    );
    // eslint-disable-next-line no-console
    console.log(`Recomputing debt for ${rows.length} driver-org pair(s)...`);
    let ok = 0;
    for (const r of rows) {
      await client.query("BEGIN");
      try {
        await recomputeDriverDebtAllocation(client, r.organization_id, r.driver_id);
        await client.query("COMMIT");
        ok += 1;
      } catch (e) {
        await client.query("ROLLBACK");
        // eslint-disable-next-line no-console
        console.error(`Failed org=${r.organization_id} driver=${r.driver_id}`, e);
        throw e;
      }
    }
    // eslint-disable-next-line no-console
    console.log(`Done. Updated ${ok} pair(s).`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
