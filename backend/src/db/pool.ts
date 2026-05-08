import { Pool, QueryResultRow, types } from "pg";
import { env } from "../config/env";

types.setTypeParser(1082, (val) => val);

export const pool = new Pool({
  connectionString: env.databaseUrl,
});

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<{ rows: T[] }> {
  const result = await pool.query<T>(text, params);
  return { rows: result.rows };
}
