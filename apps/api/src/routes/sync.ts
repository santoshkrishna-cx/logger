import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { q } from "../db.js";
import { ah } from "../http.js";
import { runSync } from "../sync/runSync.js";

export const syncRouter = Router();

syncRouter.get("/sync/runs", ah(async (_req, res) => {
  res.json({
    configured: { token: !!config.flex.token, tradeConfirmation: !!config.flex.tradeConfirmQueryId, activity: !!config.flex.activityQueryId },
    runs: await q("SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 30")
  });
}));

syncRouter.post("/sync/run", ah(async (req, res) => {
  const { kind } = z.object({ kind: z.enum(["trade-confirmation", "activity"]) }).parse(req.body);
  try {
    res.json(await runSync(kind, "manual", req.user!.id));
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
}));
