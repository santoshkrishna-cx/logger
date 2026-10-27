import { r2 } from "@logger/core";
import { Router } from "express";
import { z } from "zod";
import { q } from "../db.js";
import { ah } from "../http.js";
import { loadContext, scopeAccounts } from "../services/data.js";

export const reconcileRouter = Router();

/**
 * Day-by-day check of the P&L the screens show against the numbers IBKR itself reported:
 *  - screen:  realized P&L of trades closed that day (the Calendar/Log rule)
 *  - assumed: the part of `screen` that comes from synthetic expiry closes (no IBKR row yet)
 *  - ibkr:    FIFO realized P&L summed straight off the Activity report rows in `fills`
 *  - navPnl:  IBKR account-value change net of deposits/withdrawals/transfers (whole-account
 *             P&L, so it includes unrealized moves, fees and interest - context, not a match)
 * diff = screen - assumed - ibkr: anything left is a real discrepancy to chase.
 */
reconcileRouter.get("/reconcile", ah(async (req, res) => {
  const { from, to, account } = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    account: z.string().default("all")
  }).parse(req.query);
  const ctx = await loadContext();
  const codes = scopeAccounts(account, ctx.accounts);
  const owners = new Map(ctx.accounts.map(a => [a.code, a.ownerName]));

  const screen = new Map<string, { pnl: number; assumed: number; trades: number }>();
  for (const t of ctx.trades) {
    if (!codes.has(t.account) || t.removed || t.status !== "closed" || t.realizedPnl === null) continue;
    if (t.closeDate! < from || t.closeDate! > to) continue;
    const e = screen.get(t.closeDate!) ?? { pnl: 0, assumed: 0, trades: 0 };
    e.pnl = r2(e.pnl + t.realizedPnl);
    if (t.assumedExpired) e.assumed = r2(e.assumed + t.realizedPnl);
    e.trades++;
    screen.set(t.closeDate!, e);
  }

  const fifoRows = await q<{ trade_date: string; pnl: number | null; confirmed: string }>(
    `SELECT trade_date, SUM(realized_pnl) AS pnl, COUNT(realized_pnl) AS confirmed
       FROM fills WHERE account_code = ANY($1) AND trade_date BETWEEN $2 AND $3 GROUP BY trade_date`,
    [[...codes], from, to]);
  const fifo = new Map(fifoRows.map(r => [r.trade_date, Number(r.confirmed) > 0 ? r2(Number(r.pnl)) : null]));

  const navRows = await q<{ account_code: string; trade_date: string; nav: number }>(
    `SELECT account_code, trade_date, nav FROM account_days
      WHERE nav IS NOT NULL AND account_code = ANY($1) ORDER BY account_code, trade_date`, [[...codes]]);
  const flowRows = await q<{ account_code: string; txn_date: string; amount: number }>(
    `SELECT account_code, txn_date, SUM(amount) AS amount FROM cash_txns
      WHERE account_code = ANY($1) AND category IN ('deposit','withdrawal','transfer_in','transfer_out')
      GROUP BY account_code, txn_date`, [[...codes]]);
  const navPnl = new Map<string, number>();
  let prev: { acct: string; date: string; nav: number } | null = null;
  for (const r of navRows) {
    if (prev && prev.acct === r.account_code && r.trade_date >= from && r.trade_date <= to) {
      const flows = flowRows
        .filter(f => f.account_code === r.account_code && f.txn_date > prev!.date && f.txn_date <= r.trade_date)
        .reduce((s, f) => s + Number(f.amount), 0);
      navPnl.set(r.trade_date, r2((navPnl.get(r.trade_date) ?? 0) + Number(r.nav) - prev.nav - flows));
    }
    prev = { acct: r.account_code, date: r.trade_date, nav: Number(r.nav) };
  }

  const dates = [...new Set([...screen.keys(), ...fifo.keys(), ...navPnl.keys()])].sort().reverse();
  const days = dates.map(date => {
    const s = screen.get(date);
    const ib = fifo.get(date) ?? null;
    return {
      date,
      screen: s?.pnl ?? null,
      assumed: s?.assumed ?? 0,
      trades: s?.trades ?? 0,
      ibkr: ib,
      diff: s && ib !== null ? r2(s.pnl - s.assumed - ib) : null,
      navPnl: navPnl.get(date) ?? null
    };
  });

  const assumedTrades = ctx.trades
    .filter(t => t.assumedExpired && codes.has(t.account) && !t.removed)
    .sort((a, b) => ((a.closeDate ?? "") < (b.closeDate ?? "") ? 1 : -1))
    .map(t => ({
      key: t.key, account: t.account, owner: owners.get(t.account) ?? t.account,
      description: t.description, direction: t.direction, quantity: t.openQuantity || t.quantity,
      openDate: t.openDate, closeDate: t.closeDate, realizedPnl: t.realizedPnl
    }));

  res.json({ from, to, scope: account, days, assumedTrades });
}));
