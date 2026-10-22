import { periodRange, r2, shiftPeriod, todayET, type Period } from "@logger/core";
import { Router } from "express";
import { z } from "zod";
import { q } from "../db.js";
import { ah } from "../http.js";
import { loadContext, scopeAccounts, type Context, type TradeView } from "../services/data.js";

export const dashboardRouter = Router();

interface Position { key: string; account: string; owner: string; contract: string; direction: string; quantity: number; avgEntry: number | null; costBasis: number | null; markValue: number | null }

function openAt(t: TradeView, to: string) {
  if (t.removed || t.carryIn || t.openDate > to) return 0;
  return Math.abs(r2(t.fills.filter(f => f.tradeDate <= to).reduce((s, f) => s + f.quantity, 0)));
}

async function figures(ctx: Context, account: string, from: string, to: string, marks: Map<string, number | null>) {
  const closed = ctx.trades.filter(t => t.account === account && !t.removed && t.status === "closed" && t.realizedPnl !== null && t.closeDate! >= from && t.closeDate! <= to);
  const realized = r2(closed.reduce((s, t) => s + (t.realizedPnl ?? 0), 0));
  const wins = closed.filter(t => (t.realizedPnl ?? 0) > 0).length;
  const scored = closed.filter(t => t.discipline.score !== null);
  const cashDays = ctx.cashDays.filter(d => d.account === account && d.date <= to).sort((a, b) => (a.date < b.date ? -1 : 1));
  const lastDay = cashDays[cashDays.length - 1];
  const firstInRange = cashDays.find(d => d.date >= from);
  const [nav] = await q<{ nav: number; trade_date: string }>(
    "SELECT nav, trade_date FROM account_days WHERE account_code=$1 AND trade_date <= $2 AND nav IS NOT NULL ORDER BY trade_date DESC LIMIT 1", [account, to]);
  const positions: Position[] = ctx.trades.filter(t => t.account === account).flatMap(t => {
    const qty = openAt(t, to);
    if (!qty) return [];
    return [{
      key: t.key, account, owner: t.owner, contract: t.contract.name, direction: t.direction, quantity: qty, avgEntry: t.avgEntry,
      costBasis: t.avgEntry === null ? null : r2(qty * t.avgEntry * t.multiplier),
      markValue: marks.get(`${account}|${t.conid}`) ?? null
    }];
  });
  return {
    account,
    owner: ctx.accounts.find(a => a.code === account)?.ownerName ?? account,
    realized,
    trades: closed.length,
    wins,
    winRate: closed.length ? Math.round((wins / closed.length) * 100) : null,
    discipline: scored.length ? Math.round(scored.reduce((s, t) => s + t.discipline.score!, 0) / scored.length) : null,
    cash: lastDay?.closing ?? null,
    cashAsOf: lastDay?.date ?? null,
    cashChange: lastDay?.closing != null && firstInRange?.opening != null ? r2(lastDay.closing - firstInRange.opening) : null,
    nav: nav?.nav ?? null,
    navAsOf: nav?.trade_date ?? null,
    openContracts: positions.reduce((s, p) => s + p.quantity, 0),
    openCost: r2(positions.reduce((s, p) => s + (p.costBasis ?? 0), 0)),
    positions,
    openLessons: ctx.trades.filter(t => t.account === account && t.lesson && !t.lessonReviewComplete && !t.removed).length
  };
}

dashboardRouter.get("/dashboard", ah(async (req, res) => {
  const { period, date, account } = z.object({
    period: z.enum(["day", "week", "month", "year"]).default("day"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(todayET()),
    account: z.string().default("all")
  }).parse(req.query);
  const { from, to } = periodRange(period as Period, date);
  const ctx = await loadContext();
  const markRows = await q<{ account_code: string; conid: string; position_value: number | null }>(
    `SELECT DISTINCT ON (account_code, conid) account_code, conid, position_value FROM open_positions
      WHERE report_date <= $1 ORDER BY account_code, conid, report_date DESC`, [to]);
  const marks = new Map(markRows.map(m => [`${m.account_code}|${m.conid}`, m.position_value]));

  const byAccount = await Promise.all(ctx.accounts.map(a => figures(ctx, a.code, from, to, marks)));
  const codes = scopeAccounts(account, ctx.accounts);
  const scope = byAccount.filter(a => codes.has(a.account));
  const sumOf = (k: "realized" | "trades" | "wins" | "openContracts" | "openCost" | "openLessons") => r2(scope.reduce((s, a) => s + (a[k] ?? 0), 0));
  const nullableSum = (k: "cash" | "nav" | "cashChange") => (scope.every(a => a[k] === null) ? null : r2(scope.reduce((s, a) => s + (a[k] ?? 0), 0)));
  const trades = sumOf("trades");
  const scoredAll = ctx.trades.filter(t => scope.some(a => a.account === t.account) && !t.removed && t.status === "closed" && t.closeDate! >= from && t.closeDate! <= to && t.discipline.score !== null);

  // Day-by-day series for the chart (and trade-by-trade for a single day)
  const seriesMap = new Map<string, Record<string, number>>();
  const closedInRange = ctx.trades.filter(t => !t.removed && t.status === "closed" && t.realizedPnl !== null && t.closeDate! >= from && t.closeDate! <= to && scope.some(a => a.account === t.account));
  for (const t of closedInRange) {
    const row = seriesMap.get(t.closeDate!) ?? {};
    row[t.account] = r2((row[t.account] ?? 0) + t.realizedPnl!);
    seriesMap.set(t.closeDate!, row);
  }
  const series = [...seriesMap.keys()].sort().map(d => ({ date: d, ...seriesMap.get(d)!, total: r2(Object.values(seriesMap.get(d)!).reduce((s, x) => s + x, 0)) }));
  let cum = 0;
  const intraday = period === "day"
    ? closedInRange.sort((a, b) => (a.closeAt! < b.closeAt! ? -1 : 1)).map(t => ({ time: t.closeAt!.slice(11, 16), key: t.key, owner: t.owner, contract: t.contract.name, pnl: t.realizedPnl!, band: t.band, cumulative: (cum = r2(cum + t.realizedPnl!)) }))
    : [];

  const prev = periodRange(period as Period, shiftPeriod(period as Period, from, -1));
  const prevRealized = r2(ctx.trades.filter(t => !t.removed && t.status === "closed" && t.realizedPnl !== null && t.closeDate! >= prev.from && t.closeDate! <= prev.to && scope.some(a => a.account === t.account)).reduce((s, t) => s + t.realizedPnl!, 0));

  res.json({
    period, date, range: { from, to }, scope: account, bands: ctx.settings.pnlBands,
    combined: {
      realized: sumOf("realized"), trades, wins: sumOf("wins"),
      winRate: trades ? Math.round((sumOf("wins") / trades) * 100) : null,
      discipline: scoredAll.length ? Math.round(scoredAll.reduce((s, t) => s + t.discipline.score!, 0) / scoredAll.length) : null,
      cash: nullableSum("cash"), cashChange: nullableSum("cashChange"), nav: nullableSum("nav"),
      openContracts: sumOf("openContracts"), openCost: sumOf("openCost"), openLessons: sumOf("openLessons"),
      previousRealized: prevRealized
    },
    byAccount,
    series,
    intraday,
    positions: scope.flatMap(a => a.positions)
  });
}));
