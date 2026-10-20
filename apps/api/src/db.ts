import pg from "pg";
import { config } from "./config.js";

// Return numeric and date columns as JS numbers / ISO strings instead of strings / Date objects.
pg.types.setTypeParser(1700, v => (v === null ? null : Number(v)));       // numeric
pg.types.setTypeParser(1082, v => v);                                      // date -> 'YYYY-MM-DD'
pg.types.setTypeParser(1114, v => (v === null ? null : v.replace(" ", "T").slice(0, 19))); // timestamp (no tz)

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

export async function q<T extends pg.QueryResultRow = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query<T>(sql, params);
  return r.rows;
}

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
