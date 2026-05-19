import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "../sql/migrations");

const migrationFiles = [
  "060_subcontractor_settlement_explicit_columns.sql",
  "061_rename_total_company_commission.sql",
];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  for (const file of migrationFiles) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    console.log(`Applying ${file}...`);
    await pool.query(sql);
    console.log("  OK");
  }

  const verifySql = fs.readFileSync(
    path.join(migrationsDir, "061_rename_total_company_commission.verify.sql"),
    "utf8",
  );
  console.log("Running 061 verify...");
  const { rows } = await pool.query(verifySql);
  if (rows.length === 0) {
    console.log("  Verify OK (0 mismatches)");
  } else {
    console.warn(`  Verify returned ${rows.length} row(s) — period vs FK commission mismatch:`);
    console.warn(rows.slice(0, 5));
    process.exitCode = 1;
  }

  const { rows: colCheck } = await pool.query(
    `SELECT 1 FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'subcontractor_settlement_totals'
     LIMIT 1`,
  );
  if (!colCheck.length) {
    console.error("subcontractor_settlement_totals function missing after migrate");
    process.exit(1);
  }
} catch (err) {
  console.error("Migration failed:", err.message);
  process.exit(1);
} finally {
  await pool.end();
}

console.log("Done.");
