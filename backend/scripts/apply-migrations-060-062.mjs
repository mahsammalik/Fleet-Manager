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
  "062_remove_subcontractor_commission_rate.sql",
];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  for (const file of migrationFiles) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    console.log(`Applying ${file}...`);
    await pool.query(sql);
    console.log("  OK");
  }

  const { rows: staleCol } = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'subcontractors' AND column_name = 'commission_rate'`,
  );
  if (staleCol.length > 0) {
    console.error("  Verify failed: subcontractors.commission_rate still exists");
    process.exit(1);
  }

  const verifySql = fs.readFileSync(
    path.join(migrationsDir, "062_remove_subcontractor_commission_rate.verify.sql"),
    "utf8",
  );
  console.log("Running 062 verify...");
  const verifyStatements = verifySql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));
  let issueCount = 0;
  for (const stmt of verifyStatements) {
    const { rows } = await pool.query(stmt);
    if (rows?.length) {
      issueCount += rows.length;
      console.warn(rows.slice(0, 3));
    }
  }
  if (issueCount === 0) {
    console.log("  Verify OK (0 issues)");
  } else {
    console.warn(`  Verify returned ${issueCount} issue(s)`);
    process.exitCode = 1;
  }
} catch (err) {
  console.error("Migration failed:", err.message);
  process.exit(1);
} finally {
  await pool.end();
}

console.log("Done.");
