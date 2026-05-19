import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "../sql/migrations");

const files = [
  "057_remove_subcontractor_commission.sql",
  "059_subcontractor_settlement_b2b_payable.sql",
];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

for (const file of files) {
  const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
  console.log(`Applying ${file}...`);
  await pool.query(sql);
  console.log(`  OK`);
}

await pool.end();
console.log("Done.");
