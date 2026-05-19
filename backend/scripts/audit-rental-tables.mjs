/**
 * Pre-migration 066: row counts for rental-related tables.
 * Run: node scripts/audit-rental-tables.mjs
 */
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const QUERIES = [
  ["vehicle_rentals", "SELECT COUNT(*)::text AS c FROM vehicle_rentals"],
  ["vehicle_rentals (active)", "SELECT COUNT(*)::text AS c FROM vehicle_rentals WHERE status = 'active'"],
  ["rent_payments", "SELECT COUNT(*)::text AS c FROM rent_payments"],
  ["deposit_transactions", "SELECT COUNT(*)::text AS c FROM deposit_transactions"],
  [
    "payout_rent_entries with rental FK",
    "SELECT COUNT(*)::text AS c FROM payout_rent_entries WHERE vehicle_rental_id IS NOT NULL",
  ],
  [
    "drivers with current_vehicle_id",
    "SELECT COUNT(*)::text AS c FROM drivers WHERE current_vehicle_id IS NOT NULL",
  ],
  ["vehicle_assignment_history", "SELECT COUNT(*)::text AS c FROM vehicle_assignment_history"],
];

try {
  console.log("Rental table audit (before migration 066)\n");
  for (const [label, sql] of QUERIES) {
    try {
      const { rows } = await pool.query(sql);
      console.log(`  ${label}: ${rows[0]?.c ?? "?"}`);
    } catch (e) {
      console.log(`  ${label}: (table missing) ${e.message}`);
    }
  }
} finally {
  await pool.end();
}
