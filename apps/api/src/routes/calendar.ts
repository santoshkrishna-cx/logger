import { r2 } from "@logger/core";
import { Router } from "express";
import { z } from "zod";
import { q } from "../db.js";
import { ah } from "../http.js";
import { loadContext, scopeAccounts } from "../services/data.js";

export const calendarRouter = Router();

/** Daily realized P&L, in dollars and as a % of capital, for the calendar grid. */
calendarRouter.get("/calendar", ah(async (req, res) => {
  const { from, to, account } = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    account: z.string().default("all")
  }).parse(req.query);
  const ctx = await loadContext();
  const codes = scopeAccounts(account, ctx.accounts);

  // Realized P&L per day across the accounts in scope.
  const perDay = new Map<string, { pnl: number; trades: number }>();
  for (const t of ctx.trades) {
    if (!codes.has(t.account) || t.removed || t.status !== "closed" || t.realizedPnl === null) continue;
    if (t.closeDate! < from || t.closeDate! > to) continue;
    const e = perDay.get(t.closeDate!) ?? { pnl: 0, trades: 0 };
    e.pnl = r2(e.pnl + t.realizedPnl!); e.trades++;
    perDay.set(t.closeDate!, e);
  }

  // Capital base for the % figure. Interim: each in-scope account's most recent IBKR
  // account value on or before the day, summed. Switches to net deposited capital
  // once the funding ledger (Phase 2) lands.
  const navRows = await q<{ account_code: string; trade_date: string; nav: number }>(
    "SELECT account_code, trade_date, nav FROM account_days WHERE nav IS NOT NULL ORDER BY trade_date");
  const navByAcct = new Map<string, { date: string; nav: number }[]>();
  for (const r of navRows) {
    if (!codes.has(r.account_code)) continue;
    (navByAcct.get(r.account_code) ?? navByAcct.set(r.account_code, []).get(r.account_code)!).push({ date: r.trade_date, nav: r.nav });
  }
  const capitalBase = (date: string): number | null => {
    let sum = 0, any = false;
    for (const list of navByAcct.values()) {
      let v: number | null = null;
      for (const r of list) { if (r.date <= date) v = r.nav; else break; }
      if (v !== null) { sum += v; any = true; }
    }
    return any ? r2(sum) : null;
  };

  const days = [...perDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, e]) => {
    const base = capitalBase(date);
    return { date, pnl: e.pnl, trades: e.trades, pct: base ? r2((e.pnl / base) * 100) : null };
  });
  res.json({ from, to, scope: account, bands: ctx.settings.pnlBands, days });
}));
