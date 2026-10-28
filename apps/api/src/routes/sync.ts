import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { q } from "../db.js";
import { ah } from "../http.js";
import { runSyncAll } from "../sync/runSync.js";

export const syncRouter = Router();

syncRouter.get("/sync/runs", ah(async (_req, res) => {
  res.json({
    // Aggregate flags keep the existing UI working; `sources` adds the per-group detail.
    configured: {
      token: config.flexSources.some(s => s.token),
      tradeConfirmation: config.flexSources.some(s => s.tradeConfirmQueryId),
      activity: config.flexSources.some(s => s.activityQueryId),
      cash: config.flexSources.some(s => s.cashQueryId)
    },
    sources: config.flexSources.map(s => ({ group: s.group, name: s.name, tradeConfirmation: !!s.tradeConfirmQueryId, activity: !!s.activityQueryId, cash: !!s.cashQueryId })),
    runs: await q("SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 30")
  });
}));

syncRouter.post("/sync/run", ah(async (req, res) => {
  const { kind } = z.object({ kind: z.enum(["trade-confirmation", "activity", "cash"]) }).parse(req.body);
  const groups = await runSyncAll(kind, "manual", req.user!.id);
  const added = groups.reduce((s, g) => s + (g.added ?? 0), 0);
  const upgraded = groups.reduce((s, g) => s + (g.upgraded ?? 0), 0);
  const cashAdded = groups.reduce((s, g) => s + (g.cashAdded ?? 0), 0);
  res.json({ added, upgraded, cashAdded, groups });
}));
