import type { ReviewedTrade, Rule } from "../types.js";
import { minutesBetween, r2, sum } from "../util.js";
import { weekday } from "../periods.js";

export interface Bucket {
  key: string;
  label: string;
  trades: number;
  wins: number;
  net: number;
  winRate: number | null; // 0..100
  avg: number | null;
}

export interface Leak { dimension: string; label: string; trades: number; net: number; winRate: number | null; avg: number | null; date?: string; account?: string }

export interface AnalysisOptions {
  rules: Rule[];
  revengeWindowMinutes?: number;          // default 10
  dailyLossLimit?: Record<string, number>; // per account, positive number of dollars
  minTradesForLeak?: number;              // default 3
}

export interface Summary {
  trades: number; wins: number; losses: number; net: number; grossWin: number; grossLoss: number;
  winRate: number | null; avgWin: number | null; avgLoss: number | null; profitFactor: number | null; expectancy: number | null;
  largestWin: number | null; largestLoss: number | null; maxDrawdown: number; longestLosingStreak: number;
  commissions: number; avgCommission: number | null; commissionPctOfNet: number | null;
  bestDay: { date: string; net: number } | null; worstDay: { date: string; net: number } | null;
}

export interface Analysis {
  summary: Summary;
  daily: { date: string; net: number; trades: number; cumulative: number; drawdown: number }[];
  byWeekday: Bucket[]; bestWeekday: Bucket | null; worstWeekday: Bucket | null;
  bySymbol: Bucket[]; bestSymbols: Bucket[]; worstSymbols: Bucket[];
  byHour: Bucket[]; byHold: Bucket[]; byTradeOfDay: Bucket[]; afterLoss: Bucket[];
  byDiscipline: Bucket[]; byBrokenRule: Bucket[]; bySize: Bucket[]; byExpiry: Bucket[]; byRight: Bucket[]; byDirection: Bucket[];
  lossLimit: { account: string; date: string; breachedAt: string; tradesAfter: number; netAfter: number }[];
  lessons: { total: number; completed: number; completionRate: number | null };
  leaks: Leak[];
}

const pnl = (t: ReviewedTrade) => t.realizedPnl ?? 0;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function bucketize(trades: ReviewedTrade[], keyOf: (t: ReviewedTrade) => string | null, labelOf: (k: string) => string, order?: string[]): Bucket[] {
  const m = new Map<string, ReviewedTrade[]>();
  for (const t of trades) {
    const k = keyOf(t);
    if (k === null) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(t);
  }
  const keys = order ? order.filter(k => m.has(k)) : [...m.keys()];
  return keys.map(k => {
    const list = m.get(k)!;
    const net = r2(sum(list.map(pnl)));
    const wins = list.filter(t => pnl(t) > 0).length;
    return { key: k, label: labelOf(k), trades: list.length, wins, net, winRate: Math.round((wins / list.length) * 100), avg: r2(net / list.length) };
  });
}

/** Analyses closed, non-removed trades that have realized P&L. */
export function analyze(input: ReviewedTrade[], opts: AnalysisOptions): Analysis {
  const trades = input
    .filter(t => !t.removed && t.status === "closed" && t.realizedPnl !== null)
    .sort((a, b) => ((a.closeAt ?? "") < (b.closeAt ?? "") ? -1 : 1));
  const window = opts.revengeWindowMinutes ?? 10;
  const minN = opts.minTradesForLeak ?? 3;

  // Summary
  const winsL = trades.filter(t => pnl(t) > 0), lossL = trades.filter(t => pnl(t) < 0);
  const grossWin = r2(sum(winsL.map(pnl))), grossLoss = r2(sum(lossL.map(pnl)));
  let streak = 0, longest = 0;
  for (const t of trades) { if (pnl(t) < 0) { streak++; longest = Math.max(longest, streak); } else streak = 0; }

  // Daily equity curve
  const dayMap = new Map<string, { net: number; trades: number }>();
  for (const t of trades) {
    const d = t.closeDate!;
    const e = dayMap.get(d) ?? { net: 0, trades: 0 };
    e.net = r2(e.net + pnl(t)); e.trades++;
    dayMap.set(d, e);
  }
  let cum = 0, peak = 0, maxDd = 0;
  const daily = [...dayMap.keys()].sort().map(date => {
    const e = dayMap.get(date)!;
    cum = r2(cum + e.net); peak = Math.max(peak, cum);
    const dd = r2(cum - peak); maxDd = Math.min(maxDd, dd);
    return { date, net: e.net, trades: e.trades, cumulative: cum, drawdown: dd };
  });
  const sortedDays = [...daily].sort((a, b) => b.net - a.net);

  const summary: Summary = {
    trades: trades.length, wins: winsL.length, losses: lossL.length, net: r2(grossWin + grossLoss), grossWin, grossLoss,
    winRate: trades.length ? Math.round((winsL.length / trades.length) * 100) : null,
    avgWin: winsL.length ? r2(grossWin / winsL.length) : null,
    avgLoss: lossL.length ? r2(grossLoss / lossL.length) : null,
    profitFactor: grossLoss ? r2(grossWin / Math.abs(grossLoss)) : null,
    expectancy: trades.length ? r2((grossWin + grossLoss) / trades.length) : null,
    largestWin: winsL.length ? Math.max(...winsL.map(pnl)) : null,
    largestLoss: lossL.length ? Math.min(...lossL.map(pnl)) : null,
    maxDrawdown: maxDd, longestLosingStreak: longest,
    commissions: r2(sum(trades.map(t => t.commission))),
    avgCommission: trades.length ? r2(sum(trades.map(t => t.commission)) / trades.length) : null,
    commissionPctOfNet: r2(grossWin + grossLoss) !== 0 ? r2((Math.abs(sum(trades.map(t => t.commission))) / Math.abs(grossWin + grossLoss)) * 100) : null,
    bestDay: sortedDays.length ? { date: sortedDays[0].date, net: sortedDays[0].net } : null,
    worstDay: sortedDays.length ? { date: sortedDays[sortedDays.length - 1].date, net: sortedDays[sortedDays.length - 1].net } : null
  };

  // Day of week (by the day P&L was realized)
  const byWeekday = bucketize(trades, t => String(weekday(t.closeDate!)), k => WEEKDAYS[Number(k)], ["1", "2", "3", "4", "5", "6", "0"]);
  const wdRanked = [...byWeekday].sort((a, b) => b.net - a.net);

  // Underlying symbol
  const bySymbol = bucketize(trades, t => t.underlying || t.symbol, k => k).sort((a, b) => b.net - a.net);

  // Entry time, 30-minute buckets
  const byHour = bucketize(trades.filter(t => !t.carryIn), t => {
    const h = Number(t.openAt.slice(11, 13)), m = Number(t.openAt.slice(14, 16));
    return `${String(h).padStart(2, "0")}:${m < 30 ? "00" : "30"}`;
  }, k => {
    const [h, m] = k.split(":").map(Number);
    const end = m === 0 ? `${h}:30` : `${h + 1}:00`;
    return `${h}:${String(m).padStart(2, "0")} to ${end}`;
  }).sort((a, b) => (a.key < b.key ? -1 : 1));

  // Time in trade
  const holdOrder = ["lt5", "5to15", "15to60", "gt60", "overnight"];
  const holdLabels: Record<string, string> = { lt5: "Under 5 min", "5to15": "5 to 15 min", "15to60": "15 to 60 min", gt60: "Over 60 min, same day", overnight: "Held overnight" };
  const byHold = bucketize(trades.filter(t => !t.carryIn), t => {
    if (t.openDate !== t.closeDate) return "overnight";
    const m = t.holdMinutes ?? 0;
    return m < 5 ? "lt5" : m < 15 ? "5to15" : m < 60 ? "15to60" : "gt60";
  }, k => holdLabels[k], holdOrder);

  // Nth trade of the day, per person
  const nth = new Map<string, number>();
  const ordered = [...trades].filter(t => !t.carryIn).sort((a, b) => (a.openAt < b.openAt ? -1 : 1));
  const counter = new Map<string, number>();
  for (const t of ordered) {
    const k = `${t.account}|${t.openDate}`;
    const n = (counter.get(k) ?? 0) + 1;
    counter.set(k, n);
    nth.set(t.key, n);
  }
  const byTradeOfDay = bucketize(ordered, t => { const n = nth.get(t.key)!; return n >= 4 ? "4" : String(n); },
    k => (k === "1" ? "1st trade of the day" : k === "2" ? "2nd trade" : k === "3" ? "3rd trade" : "4th trade or later"), ["1", "2", "3", "4"]);

  // Re-entry soon after a losing trade (same person, same day)
  const lastLossClose = (t: ReviewedTrade) => {
    let best: string | null = null;
    for (const o of trades) {
      if (o.account !== t.account || o.key === t.key || o.closeDate !== t.openDate || pnl(o) >= 0 || !o.closeAt) continue;
      if (o.closeAt <= t.openAt && (!best || o.closeAt > best)) best = o.closeAt;
    }
    return best;
  };
  const afterLoss = bucketize(trades.filter(t => !t.carryIn), t => {
    const lc = lastLossClose(t);
    return lc && minutesBetween(lc, t.openAt) <= window ? "revenge" : "normal";
  }, k => (k === "revenge" ? `Entered within ${window} min of a loss` : "All other entries"), ["revenge", "normal"]);

  // Discipline
  const byDiscipline = bucketize(trades, t => (t.discipline.score === null ? "unrated" : t.discipline.broken.length ? "broken" : "clean"),
    k => (k === "clean" ? "Every rated rule followed" : k === "broken" ? "At least one rule broken" : "Not rated"), ["clean", "broken", "unrated"]);
  const ruleText = new Map(opts.rules.map(r => [r.id, r.text]));
  const byBrokenRule: Bucket[] = opts.rules.map(r => {
    const list = trades.filter(t => t.discipline.broken.includes(r.id));
    const net = r2(sum(list.map(pnl)));
    const wins = list.filter(t => pnl(t) > 0).length;
    return { key: r.id, label: ruleText.get(r.id) ?? r.id, trades: list.length, wins, net, winRate: list.length ? Math.round((wins / list.length) * 100) : null, avg: list.length ? r2(net / list.length) : null };
  }).filter(b => b.trades > 0).sort((a, b) => a.net - b.net);

  // Size, expiry, right, direction
  const bySize = bucketize(trades, t => (t.quantity <= 5 ? "s" : t.quantity <= 10 ? "m" : "l"),
    k => (k === "s" ? "1 to 5 contracts" : k === "m" ? "6 to 10 contracts" : "More than 10 contracts"), ["s", "m", "l"]);
  const byExpiry = bucketize(trades.filter(t => t.assetClass === "OPT" || t.contract.expiry), t => (t.zeroDte ? "0dte" : "dated"),
    k => (k === "0dte" ? "0DTE" : "Later expiry"), ["0dte", "dated"]);
  const byRight = bucketize(trades, t => (t.contract.right === "C" ? "C" : t.contract.right === "P" ? "P" : "other"),
    k => (k === "C" ? "Calls" : k === "P" ? "Puts" : "Stock and other"), ["C", "P", "other"]);
  const byDirection = bucketize(trades, t => t.direction, k => k, ["Long", "Short"]);

  // Daily loss limit: trades opened after the limit was hit
  const lossLimit: Analysis["lossLimit"] = [];
  if (opts.dailyLossLimit) {
    const perDay = new Map<string, ReviewedTrade[]>();
    for (const t of trades) {
      const k = `${t.account}|${t.closeDate}`;
      if (!perDay.has(k)) perDay.set(k, []);
      perDay.get(k)!.push(t);
    }
    for (const [k, list] of perDay) {
      const [account, date] = k.split("|");
      const limit = opts.dailyLossLimit[account];
      if (!limit) continue;
      let run = 0; let breachedAt: string | null = null;
      for (const t of list) { run += pnl(t); if (breachedAt === null && run <= -limit) breachedAt = t.closeAt; }
      if (!breachedAt) continue;
      const after = list.filter(t => t.openAt > breachedAt!);
      lossLimit.push({ account, date, breachedAt, tradesAfter: after.length, netAfter: r2(sum(after.map(pnl))) });
    }
  }

  // Lessons that must be reviewed together
  const withLesson = input.filter(t => !t.removed && t.lesson);
  const completed = withLesson.filter(t => t.lessonReviewComplete).length;
  const lessons = { total: withLesson.length, completed, completionRate: withLesson.length ? Math.round((completed / withLesson.length) * 100) : null };

  // Leaks: the worst losing patterns with enough trades to mean something
  const dims: [string, Bucket[]][] = [
    ["Day of week", byWeekday], ["Entry time", byHour], ["Time in trade", byHold], ["Trade count", byTradeOfDay],
    ["After a loss", afterLoss.filter(b => b.key === "revenge")], ["Discipline", byDiscipline.filter(b => b.key === "broken")],
    ["Broken rule", byBrokenRule], ["Size", bySize], ["Expiry", byExpiry], ["Option type", byRight], ["Symbol", bySymbol]
  ];
  const leaks: Leak[] = [];
  for (const [dimension, buckets] of dims) {
    for (const b of buckets) {
      if (b.trades < minN || b.net >= 0) continue;
      leaks.push({ dimension, label: b.label, trades: b.trades, net: b.net, winRate: b.winRate, avg: b.avg });
    }
  }
  for (const l of lossLimit) {
    if (l.tradesAfter > 0 && l.netAfter < 0) leaks.push({ dimension: "Loss limit", label: "kept trading after the daily limit", trades: l.tradesAfter, net: l.netAfter, winRate: null, avg: null, date: l.date, account: l.account });
  }
  leaks.sort((a, b) => a.net - b.net);

  return {
    summary, daily,
    byWeekday, bestWeekday: wdRanked[0] ?? null, worstWeekday: wdRanked.length ? wdRanked[wdRanked.length - 1] : null,
    bySymbol, bestSymbols: bySymbol.filter(b => b.net > 0).slice(0, 5), worstSymbols: bySymbol.filter(b => b.net < 0).reverse().slice(0, 5),
    byHour, byHold, byTradeOfDay, afterLoss, byDiscipline, byBrokenRule, bySize, byExpiry, byRight, byDirection,
    lossLimit, lessons, leaks: leaks.slice(0, 8)
  };
}
