import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(__dirname, "../sql/migrations/055_subcontractor_payouts_dynamic_totals.sql");
const sql = fs.readFileSync(sqlPath, "utf8");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  await pool.query(sql);
  const { rows } = await pool.query(
    `SELECT proname FROM pg_proc WHERE proname = 'subcontractor_settlement_totals'`,
  );
  console.log("Migration 055 applied OK. Functions found:", rows.length);
} catch (err) {
  console.error("Migration failed:", err.message);
  process.exit(1);
} finally {
  await pool.end();
}
