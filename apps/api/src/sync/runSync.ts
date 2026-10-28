import { parseFlex } from "@logger/core";
import { config, type FlexSource } from "../config.js";
import { q } from "../db.js";
import { ingest } from "../services/ingest.js";
import { fetchFlexStatement } from "./flexClient.js";

export type SyncKind = "trade-confirmation" | "activity" | "cash";

/** The Flex query a source uses for a sync kind; empty means the source doesn't take part. */
export const queryFor = (src: FlexSource, kind: SyncKind) =>
  kind === "activity" ? src.activityQueryId : kind === "cash" ? src.cashQueryId : src.tradeConfirmQueryId;

export async function runSync(kind: SyncKind, trigger: "schedule" | "manual", userId: string | null = null, source?: FlexSource) {
  const src = source ?? config.flexSources[0];
  if (!src) throw new Error("No Flex source configured. Set FLEX_TOKEN and the query IDs in the environment.");
  const [run] = await q<{ id: string }>("INSERT INTO sync_runs (kind, trigger, started_by, group_code) VALUES ($1,$2,$3,$4) RETURNING id", [kind, trigger, userId, src.group]);
  try {
    const queryId = queryFor(src, kind);
    if (!queryId) throw new Error(`No ${kind} query configured for ${src.name}.`);
    const xml = await fetchFlexStatement(queryId, src.token);
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

/** Run one kind across every configured master. One master failing does not stop the others. */
export async function runSyncAll(kind: SyncKind, trigger: "schedule" | "manual", userId: string | null = null) {
  const out: { group: string; name: string; added?: number; upgraded?: number; cashAdded?: number; error?: string }[] = [];
  for (const src of config.flexSources) {
    if (!queryFor(src, kind)) continue;
    try {
      const r = await runSync(kind, trigger, userId, src);
      out.push({ group: src.group, name: src.name, added: r.added, upgraded: r.upgraded, cashAdded: r.cashAdded });
    } catch (e) {
      out.push({ group: src.group, name: src.name, error: (e as Error).message });
    }
  }
  return out;
}
