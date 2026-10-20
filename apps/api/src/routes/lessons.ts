import { Router } from "express";
import { z } from "zod";
import { audit } from "../audit.js";
import { tx } from "../db.js";
import { HttpError, ah } from "../http.js";
import { findTrade, loadContext } from "../services/data.js";

export const lessonsRouter = Router();

/** Every trade flagged with a lesson, and whether both people have signed off. Target: 100%. */
lessonsRouter.get("/lessons", ah(async (req, res) => {
  const status = z.enum(["open", "all"]).default("open").parse(req.query.status);
  const ctx = await loadContext();
  const all = ctx.trades.filter(t => t.lesson && !t.removed);
  const list = (status === "open" ? all.filter(t => !t.lessonReviewComplete) : all)
    .sort((a, b) => ((a.lessonReview?.openedAt ?? "") < (b.lessonReview?.openedAt ?? "") ? -1 : 1));
  const done = all.filter(t => t.lessonReviewComplete).length;
  const me = req.user!.account;
  res.json({
    total: all.length,
    completed: done,
    completionRate: all.length ? Math.round((done / all.length) * 100) : null,
    waitingOnMe: all.filter(t => !t.lessonReviewComplete && t.lessonReview?.waitingOn.includes(t.account === me ? "trader" : "reviewer")).length,
    overdue: all.filter(t => t.lessonReview?.overdue).length,
    trades: list
  });
}));

/**
 * Sign-off on a lesson. The trader writes what they'll do differently; the reviewer confirms the
 * day they went over it together. The review closes only when both have signed.
 */
lessonsRouter.post("/trades/:key/lesson-review/ack", ah(async (req, res) => {
  const { trade: t } = await findTrade(req.params.key);
  if (!t) throw new HttpError(404, "That trade isn't in the log.");
  if (!t.lesson || !t.lessonReview) throw new HttpError(409, "This trade has no open lesson to sign off.");
  const asTrader = req.user!.account === t.account;
  const body = z.object({ note: z.string().max(2000).optional(), discussedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.body);
  if (asTrader && (!body.note || body.note.trim().length < 10)) throw new HttpError(400, "Write what you'll do differently next time (at least a sentence) before signing off.");
  if (!asTrader && !body.discussedOn) throw new HttpError(400, "Pick the day you went over this lesson together.");
  await tx(async c => {
    if (asTrader) await c.query("UPDATE lesson_reviews SET trader_note=$2, trader_ack_by=$3, trader_ack_at=now() WHERE trade_key=$1", [t.key, body.note!.trim(), req.user!.id]);
    else await c.query("UPDATE lesson_reviews SET discussed_on=$2, reviewer_ack_by=$3, reviewer_ack_at=now() WHERE trade_key=$1", [t.key, body.discussedOn, req.user!.id]);
    await c.query("UPDATE lesson_reviews SET completed_at=now() WHERE trade_key=$1 AND trader_ack_at IS NOT NULL AND reviewer_ack_at IS NOT NULL AND completed_at IS NULL", [t.key]);
    await audit(req.user!.id, "lesson_review", t.key, asTrader ? "trader_ack" : "reviewer_ack", null, body, c);
  });
  res.status(204).end();
}));
