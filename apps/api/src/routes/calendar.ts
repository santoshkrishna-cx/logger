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

  // Capital base for the % figure: each in-scope account's net deposited capital
  // (cumulative deposits/withdrawals/transfers) on or before the day. Accounts with no
  // funding rows yet fall back to their most recent IBKR account value.
  const navRows = await q<{ account_code: string; trade_date: string; nav: number }>(
    "SELECT account_code, trade_date, nav FROM account_days WHERE nav IS NOT NULL ORDER BY trade_date");
  const cashRows = await q<{ account_code: string; txn_date: string; amount: number }>(
    "SELECT account_code, txn_date, amount FROM cash_txns ORDER BY txn_date, id");
  const navByAcct = new Map<string, { date: string; nav: number }[]>();
  const cashByAcct = new Map<string, { date: string; amount: number }[]>();
  for (const r of navRows) if (codes.has(r.account_code)) (navByAcct.get(r.account_code) ?? navByAcct.set(r.account_code, []).get(r.account_code)!).push({ date: r.trade_date, nav: r.nav });
  for (const r of cashRows) if (codes.has(r.account_code)) (cashByAcct.get(r.account_code) ?? cashByAcct.set(r.account_code, []).get(r.account_code)!).push({ date: r.txn_date, amount: r.amount });
  const investedAsOf = (acct: string, date: string): number | null => {
    const list = cashByAcct.get(acct); if (!list) return null;
    let s = 0; for (const r of list) { if (r.date <= date) s += r.amount; else break; } return r2(s);
  };
  const navAsOf = (acct: string, date: string): number | null => {
    let v: number | null = null; for (const r of navByAcct.get(acct) ?? []) { if (r.date <= date) v = r.nav; else break; } return v;
  };
  const capitalBase = (date: string): number | null => {
    let sum = 0, any = false;
    for (const acct of codes) {
      const base = investedAsOf(acct, date) ?? navAsOf(acct, date);
      if (base !== null) { sum += base; any = true; }
    }
    return any ? r2(sum) : null;
  };

  const days = [...perDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, e]) => {
    const base = capitalBase(date);
    return { date, pnl: e.pnl, trades: e.trades, pct: base ? r2((e.pnl / base) * 100) : null };
  });
  res.json({ from, to, scope: account, bands: ctx.settings.pnlBands, days });
}));
