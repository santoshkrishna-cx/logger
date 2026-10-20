import { Router } from "express";
import { z } from "zod";
import { audit } from "../audit.js";
import { q } from "../db.js";
import { HttpError, ah } from "../http.js";
import { loadContext } from "../services/data.js";

export const rulesRouter = Router();

rulesRouter.get("/rules", ah(async (_req, res) => {
  const ctx = await loadContext();
  const broken: Record<string, number> = {};
  for (const t of ctx.trades) if (!t.removed) for (const id of t.discipline.broken) broken[id] = (broken[id] ?? 0) + 1;
  res.json(ctx.rules.map(r => ({ ...r, timesBroken: broken[r.id] ?? 0 })));
}));

rulesRouter.post("/rules", ah(async (req, res) => {
  const { text } = z.object({ text: z.string().trim().min(3).max(300) }).parse(req.body);
  const [row] = await q("INSERT INTO rules (position, text, created_by) VALUES ((SELECT COALESCE(MAX(position),0)+1 FROM rules), $1, $2) RETURNING *", [text, req.user!.id]);
  await audit(req.user!.id, "rule", row.id, "create", null, row);
  res.status(201).json(row);
}));

/** Rules are switched off, never deleted, so past ratings keep their meaning. */
rulesRouter.patch("/rules/:id", ah(async (req, res) => {
  const body = z.object({ text: z.string().trim().min(3).max(300).optional(), active: z.boolean().optional(), position: z.number().int().min(1).optional() }).parse(req.body);
  const [before] = await q("SELECT * FROM rules WHERE id=$1", [req.params.id]);
  if (!before) throw new HttpError(404, "That rule doesn't exist.");
  const [row] = await q(
    "UPDATE rules SET text=COALESCE($2,text), active=COALESCE($3,active), position=COALESCE($4,position), updated_at=now() WHERE id=$1 RETURNING *",
    [req.params.id, body.text ?? null, body.active ?? null, body.position ?? null]);
  await audit(req.user!.id, "rule", row.id, "update", before, row);
  res.json(row);
}));
