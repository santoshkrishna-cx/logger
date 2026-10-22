import { daySections, r2 } from "@logger/core";
import { Router } from "express";
import { z } from "zod";
import { ah } from "../http.js";
import { loadContext, scopeAccounts, type TradeView } from "../services/data.js";

export const logRouter = Router();
const scope = z.string().default("all");

/** Trading days with realized P&L, newest first, for the day rail. */
logRouter.get("/days", ah(async (req, res) => {
  const account = scope.parse(req.query.account);
  const ctx = await loadContext();
  const codes = scopeAccounts(account, ctx.accounts);
  const days = new Map<string, Record<string, number>>();
  for (const t of ctx.trades) {
    if (!codes.has(t.account)) continue;
    for (const f of t.fills) if (!days.has(f.tradeDate)) days.set(f.tradeDate, {});
    if (t.removed || t.status !== "closed" || t.realizedPnl === null) continue;
    const d = days.get(t.closeDate!) ?? {};
    d[t.account] = r2((d[t.account] ?? 0) + t.realizedPnl);
    days.set(t.closeDate!, d);
  }
  res.json([...days.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([date, by]) => ({
    date, byAccount: by, total: r2(Object.values(by).reduce((s, x) => s + x, 0))
  })));
}));

/** One day of the log: round trips, carry-ins, still-open, removed. */
logRouter.get("/log", ah(async (req, res) => {
  const { date, account } = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), account: scope }).parse(req.query);
  const ctx = await loadContext();
  const codes = scopeAccounts(account, ctx.accounts);
  const trades = ctx.trades.filter(t => codes.has(t.account));
  const s = daySections<TradeView>(trades, date);
  const counted = [...s.roundTrips, ...s.carriedIn];
  const realized: Record<string, number> = {};
  for (const t of counted) realized[t.account] = r2((realized[t.account] ?? 0) + (t.realizedPnl ?? 0));
  const scored = counted.filter(t => t.discipline.score !== null);
  res.json({
    date,
    sections: s,
    summary: {
      realized,
      total: r2(Object.values(realized).reduce((a, b) => a + b, 0)),
      trades: counted.length,
      wins: counted.filter(t => (t.realizedPnl ?? 0) > 0).length,
      discipline: scored.length ? Math.round(scored.reduce((a, t) => a + t.discipline.score!, 0) / scored.length) : null,
      awaitingReview: counted.filter(t => !t.journal.review?.trim()).length,
      openLessons: counted.filter(t => t.lesson && !t.lessonReviewComplete).length
    },
    cash: ctx.cashDays.filter(d => d.date === date && codes.has(d.account)),
    rules: ctx.rules,
    bands: ctx.settings.pnlBands
  });
}));

logRouter.get("/trades/:key", ah(async (req, res) => {
  const ctx = await loadContext();
  const t = ctx.trades.find(x => x.key === req.params.key);
  if (!t) return res.status(404).json({ error: "That trade isn't in the log." });
  res.json({ trade: t, rules: ctx.rules, bands: ctx.settings.pnlBands });
}));
