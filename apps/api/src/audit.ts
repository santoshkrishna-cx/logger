import type pg from "pg";
import { pool } from "./db.js";

export async function audit(
  userId: string | null, entity: string, entityId: string, action: string,
  before: unknown, after: unknown, client: pg.Pool | pg.PoolClient = pool
) {
  await client.query(
    "INSERT INTO audit_events (user_id, entity, entity_id, action, before, after) VALUES ($1,$2,$3,$4,$5,$6)",
    [userId, entity, entityId, action, before === undefined ? null : JSON.stringify(before), after === undefined ? null : JSON.stringify(after)]
  );
}
