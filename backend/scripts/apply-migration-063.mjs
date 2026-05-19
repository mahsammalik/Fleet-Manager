import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "../sql/migrations");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  const sql = fs.readFileSync(path.join(migrationsDir, "063_vehicle_rent_auto_deduct.sql"), "utf8");
  console.log("Applying 063_vehicle_rent_auto_deduct.sql...");
  await pool.query(sql);
  console.log("  OK");

  const verifySql = fs.readFileSync(
    path.join(migrationsDir, "063_vehicle_rent_auto_deduct.verify.sql"),
    "utf8",
  );
  console.log("Running 063 verify...");
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
