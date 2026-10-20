import { parseFlex } from "@tradelog/core";
import { config } from "../config.js";
import { q } from "../db.js";
import { ingest } from "../services/ingest.js";
import { fetchFlexStatement } from "./flexClient.js";

export type SyncKind = "trade-confirmation" | "activity";

export async function runSync(kind: SyncKind, trigger: "schedule" | "manual", userId: string | null = null) {
  const [run] = await q<{ id: string }>("INSERT INTO sync_runs (kind, trigger, started_by) VALUES ($1,$2,$3) RETURNING id", [kind, trigger, userId]);
  try {
    const queryId = kind === "activity" ? config.flex.activityQueryId : config.flex.tradeConfirmQueryId;
    const xml = await fetchFlexStatement(queryId);
    const result = await ingest(parseFlex(xml), kind, { commit: true });
    await q("UPDATE sync_runs SET status='succeeded', finished_at=now(), fills_added=$2, fills_upgraded=$3 WHERE id=$1", [run.id, result.added, result.upgraded]);
    if (result.unmatched.length) {
      await q("UPDATE sync_runs SET error=$2 WHERE id=$1", [run.id, `Skipped fills from unmatched accounts: ${result.unmatched.map(u => u.ibkrAccount || u.alias).join(", ")}. Import a file once to map them.`]);
    }
    return { id: run.id, ...result };
  } catch (e) {
    await q("UPDATE sync_runs SET status='failed', finished_at=now(), error=$2 WHERE id=$1", [run.id, (e as Error).message]);
    throw e;
  }
}
