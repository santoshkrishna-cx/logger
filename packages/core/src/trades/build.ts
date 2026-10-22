import type { Fill, FillWithState, Trade } from "../types.js";
import { parseContract } from "../contract.js";
import { minutesBetween, r2, safeKey } from "../util.js";

const byTime = (a: { executedAt: string; id: string }, b: { executedAt: string; id: string }) =>
  a.executedAt < b.executedAt ? -1 : a.executedAt > b.executedAt ? 1 : a.id < b.id ? -1 : 1;

/** Opening cash per account per trade date, e.g. { anilsub02: { "2026-10-20": 50000 } } */
export type OpeningCash = Record<string, Record<string, number | null | undefined>>;

export interface CashDay { account: string; date: string; opening: number | null; closing: number | null; netCash: number; openingEntered: boolean }

/**
 * Running cash per fill. A day's opening comes from IBKR's Cash Report (or a typed value);
 * if missing, the previous day's computed close is carried forward.
 */
export function applyCash(fills: Fill[], opening: OpeningCash): { fills: FillWithState[]; days: CashDay[] } {
  const out: FillWithState[] = [];
  const days: CashDay[] = [];
  const byAcct = new Map<string, Map<string, Fill[]>>();
  for (const f of fills) {
    if (!byAcct.has(f.account)) byAcct.set(f.account, new Map());
    const m = byAcct.get(f.account)!;
    if (!m.has(f.tradeDate)) m.set(f.tradeDate, []);
    m.get(f.tradeDate)!.push(f);
  }
  for (const acct of Object.keys(opening)) {
    if (!byAcct.has(acct)) byAcct.set(acct, new Map());
    for (const d of Object.keys(opening[acct] ?? {})) if (!byAcct.get(acct)!.has(d)) byAcct.get(acct)!.set(d, []);
  }
  for (const [acct, dayMap] of byAcct) {
    let prevClose: number | null = null;
    for (const date of [...dayMap.keys()].sort()) {
      const typed = opening[acct]?.[date];
      const entered = typed !== null && typed !== undefined;
      const open: number | null = entered ? Number(typed) : prevClose;
      let delta = 0;
      for (const f of dayMap.get(date)!.sort(byTime)) {
        delta = r2(delta + f.netCash);
        out.push({ ...f, positionAfter: null, cashAfter: open === null ? null : r2(open + delta), cashDelta: delta });
      }
      const close: number | null = open === null ? null : r2(open + delta);
      days.push({ account: acct, date, opening: open, closing: close, netCash: delta, openingEntered: entered });
      prevClose = close;
    }
  }
  return { fills: out, days };
}

/**
 * A trade = every fill in one contract in one account from when the position leaves zero
 * until it returns to zero. Fills that close a position opened before the data starts form a carry-in.
 */
export function buildTrades(fills: FillWithState[]): Trade[] {
  const groups = new Map<string, FillWithState[]>();
  for (const f of fills) {
    const k = `${f.account}|${f.conid}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push({ ...f });
  }
  const trades: Trade[] = [];
  type Running = { fills: FillWithState[]; carryIn: boolean; closeSide: Fill["side"] | null };
  for (const list of groups.values()) {
    list.sort(byTime);
    let cur: Running | null = null;
    let pos = 0;
    for (const f of list) {
      if (cur && cur.carryIn) {
        if (f.openClose === "C" && f.side === cur.closeSide) { cur.fills.push({ ...f, positionAfter: null }); continue; }
        trades.push(finish(cur.fills, true, 0));
        cur = null;
      }
      if (!cur) {
        if (f.openClose === "C") {
          cur = { fills: [{ ...f, positionAfter: null }], carryIn: true, closeSide: f.side };
          pos = 0;
          continue;
        }
        cur = { fills: [], carryIn: false, closeSide: null };
      }
      pos = r2(pos + f.quantity);
      cur.fills.push({ ...f, positionAfter: pos });
      if (pos === 0) { trades.push(finish(cur.fills, false, 0)); cur = null; }
    }
    if (cur) trades.push(finish(cur.fills, cur.carryIn, cur.carryIn ? 0 : pos));
  }
  return trades.sort((a, b) => (a.openAt < b.openAt ? -1 : 1));
}

function finish(fs: FillWithState[], carryIn: boolean, pos: number): Trade {
  const first = fs[0];
  const last = fs[fs.length - 1];
  const status = pos === 0 ? "closed" : "open";
  const openSide = carryIn ? (first.side === "SELL" ? "BUY" : "SELL") : first.side;
  const ins = fs.filter(f => f.side === openSide);
  const outs = fs.filter(f => f.side !== openSide);
  const qty = (a: Fill[]) => a.reduce((s, f) => s + Math.abs(f.quantity), 0);
  const wavg = (a: Fill[]) => (qty(a) ? a.reduce((s, f) => s + Math.abs(f.quantity) * f.price, 0) / qty(a) : null);
  const hasRealized = fs.some(f => f.realizedPnl !== null && f.realizedPnl !== 0);
  let realizedPnl: number | null;
  if (hasRealized) realizedPnl = r2(fs.reduce((s, f) => s + (f.realizedPnl ?? 0), 0));
  else if (status === "closed" && !carryIn) realizedPnl = r2(fs.reduce((s, f) => s + f.netCash, 0));
  else realizedPnl = null;
  const avgEntry = wavg(ins);
  const quantity = carryIn ? qty(outs) : qty(ins);
  // Return on the capital the trade put to work: realized P&L over entry notional.
  const entryNotional = avgEntry !== null ? Math.abs(avgEntry) * quantity * first.multiplier : null;
  const profitPct = realizedPnl !== null && entryNotional ? r2((realizedPnl / entryNotional) * 100) : null;
  const contract = parseContract(first.description);
  return {
    key: safeKey(`${first.account}_${first.conid}_${first.id}`),
    account: first.account,
    conid: first.conid,
    symbol: first.symbol,
    underlying: first.underlying,
    description: first.description,
    contract,
    assetClass: first.assetClass,
    multiplier: first.multiplier,
    fills: fs,
    carryIn,
    status,
    openAt: first.executedAt,
    openDate: first.tradeDate,
    closeAt: status === "closed" ? last.executedAt : null,
    closeDate: status === "closed" ? last.tradeDate : null,
    direction: openSide === "BUY" ? "Long" : "Short",
    quantity,
    openQuantity: Math.abs(pos),
    avgEntry,
    avgExit: wavg(outs),
    commission: r2(fs.reduce((s, f) => s + f.commission, 0)),
    realizedPnl,
    profitPct,
    zeroDte: !!contract.expiry && contract.expiry === first.tradeDate,
    holdMinutes: status === "closed" && !carryIn ? minutesBetween(first.executedAt, last.executedAt) : null
  };
}

export interface DaySections<T extends Trade> { roundTrips: T[]; carriedIn: T[]; stillOpen: T[]; removed: T[] }

/** Splits trades into the three lists shown for one trading day. */
export function daySections<T extends Trade & { removed?: boolean }>(trades: T[], day: string): DaySections<T> {
  const s: DaySections<T> = { roundTrips: [], carriedIn: [], stillOpen: [], removed: [] };
  for (const t of trades) {
    const touched = t.fills.some(f => f.tradeDate === day);
    const closedToday = t.status === "closed" && t.closeDate === day;
    let bucket: T[] | null = null;
    if (closedToday && (t.carryIn || t.openDate < day)) bucket = s.carriedIn;
    else if (closedToday && t.openDate === day) bucket = s.roundTrips;
    else if (!t.carryIn && t.openDate <= day && (t.status === "open" || (t.closeDate ?? "") > day)) bucket = s.stillOpen;
    if (!bucket) continue;
    if (t.removed) { if (touched) s.removed.push(t); continue; }
    bucket.push(t);
  }
  s.carriedIn.sort((a, b) => ((a.closeAt ?? "") < (b.closeAt ?? "") ? -1 : 1));
  return s;
}
