import { analyze } from "@tradelog/core";
import { Router } from "express";
import { z } from "zod";
import { ah } from "../http.js";
import { loadContext } from "../services/data.js";

export const analyticsRouter = Router();

analyticsRouter.get("/analytics", ah(async (req, res) => {
  const { from, to, account } = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default("1900-01-01"),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default("2999-12-31"),
    account: z.enum(["both", "anilsub01", "anilsub02"]).default("both")
  }).parse(req.query);
  const ctx = await loadContext();
  const trades = ctx.trades.filter(t =>
    (account === "both" || t.account === account) &&
    ((t.closeDate ?? t.openDate) >= from) && ((t.closeDate ?? t.openDate) <= to));
  const limits: Record<string, number> = {};
  for (const [k, v] of Object.entries(ctx.settings.dailyLossLimit)) if (v) limits[k] = v;
  const owners = Object.fromEntries(ctx.accounts.map(a => [a.code, a.ownerName]));
  const a = analyze(trades, { rules: ctx.rules, revengeWindowMinutes: ctx.settings.revengeWindowMinutes, dailyLossLimit: limits });
  // Name people, not account codes, in the loss-limit findings.
  a.leaks = a.leaks.map(l => (l.account ? { ...l, label: `${owners[l.account] ?? l.account} ${l.label}` } : l));
  res.json({ range: { from, to }, scope: account, bands: ctx.settings.pnlBands, ...a,
    lossLimit: a.lossLimit.map(l => ({ ...l, owner: owners[l.account] ?? l.account })) });
}));
