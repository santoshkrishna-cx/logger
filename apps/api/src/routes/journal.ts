import { Router, type Request } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { audit } from "../audit.js";
import { tx } from "../db.js";
import { HttpError, ah } from "../http.js";
import { findTrade, type TradeView } from "../services/data.js";

export const journalRouter = Router();

async function ensureJournal(c: PoolClient, t: TradeView) {
  await c.query("INSERT INTO journal (trade_key, account_code) VALUES ($1,$2) ON CONFLICT DO NOTHING", [t.key, t.account]);
}
async function tradeOr404(key: string) {
  const { trade } = await findTrade(key);
  if (!trade) throw new HttpError(404, "That trade isn't in the log.");
  return trade;
}
const isOwner = (req: Request, t: TradeView) => req.user!.account === t.account;

const text = z.object({ text: z.string().max(10_000) });

/** The trader explains their own trade. */
journalRouter.put("/trades/:key/rationale", ah(async (req, res) => {
  const t = await tradeOr404(req.params.key);
  if (!isOwner(req, t)) throw new HttpError(403, `Only ${t.owner} can write why this trade was taken.`);
  const { text: value } = text.parse(req.body);
  await tx(async c => {
    await ensureJournal(c, t);
    await c.query("UPDATE journal SET rationale=$2, rationale_by=$3, rationale_at=now(), updated_at=now() WHERE trade_key=$1", [t.key, value, req.user!.id]);
    await audit(req.user!.id, "journal", t.key, "rationale", t.journal.rationale, value, c);
  });
  res.status(204).end();
}));

/** The other person reviews it. */
journalRouter.put("/trades/:key/review", ah(async (req, res) => {
  const t = await tradeOr404(req.params.key);
  if (isOwner(req, t)) throw new HttpError(403, `${t.reviewer} writes the review on this trade.`);
  const { text: value } = text.parse(req.body);
  await tx(async c => {
    await ensureJournal(c, t);
    await c.query("UPDATE journal SET review=$2, review_by=$3, review_at=now(), updated_at=now() WHERE trade_key=$1", [t.key, value, req.user!.id]);
    await audit(req.user!.id, "journal", t.key, "review", t.journal.review, value, c);
  });
  res.status(204).end();
}));

/**
 * The reviewer flags a lesson. A lesson opens a joint review that both people must sign off;
 * clearing the flag closes it only if neither has signed yet.
 */
journalRouter.put("/trades/:key/lesson", ah(async (req, res) => {
  const t = await tradeOr404(req.params.key);
  if (isOwner(req, t)) throw new HttpError(403, `${t.reviewer} decides whether this trade carries a lesson.`);
  const { lesson, lessonText } = z.object({ lesson: z.boolean().nullable(), lessonText: z.string().max(500).optional() }).parse(req.body);
  if (lesson === true && !lessonText?.trim() && !t.journal.lessonText) throw new HttpError(400, "Write the lesson in one line so both of you can sign off on it.");
  if (lesson !== true && t.lessonReview && (t.lessonReview.traderAckAt || t.lessonReview.reviewerAckAt)) {
    throw new HttpError(409, "This lesson already has a sign-off. Finish the joint review instead of clearing it.");
  }
  await tx(async c => {
    await ensureJournal(c, t);
    await c.query("UPDATE journal SET lesson=$2, lesson_text=COALESCE($3, lesson_text), updated_at=now() WHERE trade_key=$1", [t.key, lesson, lessonText?.trim() || null]);
    if (lesson === true) await c.query("INSERT INTO lesson_reviews (trade_key) VALUES ($1) ON CONFLICT DO NOTHING", [t.key]);
    else await c.query("DELETE FROM lesson_reviews WHERE trade_key=$1", [t.key]);
    await audit(req.user!.id, "journal", t.key, "lesson", { lesson: t.journal.lesson, lessonText: t.journal.lessonText }, { lesson, lessonText }, c);
  });
  res.status(204).end();
}));

/** Either person can rate a rule; the last rating stands and the audit trail keeps the history. */
journalRouter.put("/trades/:key/ratings/:ruleId", ah(async (req, res) => {
  const t = await tradeOr404(req.params.key);
  const { value } = z.object({ value: z.union([z.literal(2), z.literal(1), z.literal(0), z.literal(-1), z.null()]) }).parse(req.body);
  await tx(async c => {
    await ensureJournal(c, t);
    if (value === null) await c.query("DELETE FROM rule_ratings WHERE trade_key=$1 AND rule_id=$2", [t.key, req.params.ruleId]);
    else await c.query(
      `INSERT INTO rule_ratings (trade_key, rule_id, value, rated_by) VALUES ($1,$2,$3,$4)
       ON CONFLICT (trade_key, rule_id) DO UPDATE SET value=EXCLUDED.value, rated_by=EXCLUDED.rated_by, rated_at=now()`,
      [t.key, req.params.ruleId, value, req.user!.id]);
    await audit(req.user!.id, "rating", `${t.key}/${req.params.ruleId}`, "set", t.ratings[req.params.ruleId] ?? null, value, c);
  });
  res.status(204).end();
}));

const REASONS = ["Duplicate fill", "Fat-finger order", "Wrong account", "Data error in report", "Test order", "Other"] as const;

/** Erroneous trades leave P&L and stats; fills are never deleted and the trade can be restored. */
journalRouter.post("/trades/:key/remove", ah(async (req, res) => {
  const t = await tradeOr404(req.params.key);
  const { reason } = z.object({ reason: z.enum(REASONS) }).parse(req.body);
  await tx(async c => {
    await ensureJournal(c, t);
    await c.query("UPDATE journal SET removed=true, removed_reason=$2, removed_by=$3, removed_at=now(), updated_at=now() WHERE trade_key=$1", [t.key, reason, req.user!.id]);
    await audit(req.user!.id, "journal", t.key, "remove", null, { reason }, c);
  });
  res.status(204).end();
}));

journalRouter.post("/trades/:key/restore", ah(async (req, res) => {
  const t = await tradeOr404(req.params.key);
  await tx(async c => {
    await ensureJournal(c, t);
    await c.query("UPDATE journal SET removed=false, removed_reason=NULL, removed_by=NULL, removed_at=NULL, updated_at=now() WHERE trade_key=$1", [t.key]);
    await audit(req.user!.id, "journal", t.key, "restore", { reason: t.journal.removedReason }, null, c);
  });
  res.status(204).end();
}));

/** Typed opening cash, used when IBKR's Cash Report isn't in yet. */
journalRouter.put("/account-days/:account/:date/opening-cash", ah(async (req, res) => {
  const { value } = z.object({ value: z.number().nullable() }).parse(req.body);
  await tx(async c => {
    await c.query(
      `INSERT INTO account_days (account_code, trade_date, opening_cash, opening_cash_source) VALUES ($1,$2,$3,'manual')
       ON CONFLICT (account_code, trade_date) DO UPDATE SET opening_cash=EXCLUDED.opening_cash, opening_cash_source='manual', updated_at=now()`,
      [req.params.account, req.params.date, value]);
    await audit(req.user!.id, "account_day", `${req.params.account}/${req.params.date}`, "opening_cash", null, value, c);
  });
  res.status(204).end();
}));
