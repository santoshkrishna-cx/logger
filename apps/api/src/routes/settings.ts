import { Router } from "express";
import { z } from "zod";
import { audit } from "../audit.js";
import { q } from "../db.js";
import { ah } from "../http.js";
import { loadSettings } from "../services/data.js";

export const settingsRouter = Router();

settingsRouter.get("/settings", ah(async (_req, res) => res.json(await loadSettings())));

settingsRouter.put("/settings", ah(async (req, res) => {
  const body = z.object({
    pnlBands: z.object({ scratch: z.number().min(0), big: z.number().positive() }).optional(),
    dailyLossLimit: z.record(z.number().positive().nullable()).optional(),
    revengeWindowMinutes: z.number().int().min(1).max(120).optional(),
    lessonReviewDueDays: z.number().int().min(1).max(30).optional()
  }).parse(req.body);
  const map: [string, unknown][] = [
    ["pnl_bands", body.pnlBands], ["daily_loss_limit", body.dailyLossLimit],
    ["revenge_window_minutes", body.revengeWindowMinutes], ["lesson_review_due_days", body.lessonReviewDueDays]
  ];
  for (const [key, value] of map) {
    if (value === undefined) continue;
    await q(`INSERT INTO settings (key, value, updated_by) VALUES ($1,$2,$3)
             ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=now()`, [key, JSON.stringify(value), req.user!.id]);
    await audit(req.user!.id, "setting", key, "set", null, value);
  }
  res.json(await loadSettings());
}));
