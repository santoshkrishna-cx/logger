import {
  applyCash, buildTrades, discipline, pnlBand,
  type BandSettings, type CashDay, type Fill, type OpeningCash, type PnlBand, type RatingValue, type ReviewedTrade, type Rule
} from "@logger/core";
import { q } from "../db.js";

export interface Settings {
  pnlBands: BandSettings;
  dailyLossLimit: Record<string, number | null>;
  revengeWindowMinutes: number;
  lessonReviewDueDays: number;
}

export interface Account { code: string; ownerName: string; groupCode: string; ibkrAccountId: string | null; ibkrAlias: string | null }
export interface Group { code: string; name: string }

/** Resolve a scope string to the set of account codes it covers.
 *  "" | "all" | "both" -> everyone; "g:<code>" -> a group; "p:<owner>" -> a person; else a single account code. */
export function scopeAccounts(scope: string, accounts: Account[]): Set<string> {
  if (!scope || scope === "all" || scope === "both") return new Set(accounts.map(a => a.code));
  if (scope.startsWith("g:")) return new Set(accounts.filter(a => a.groupCode === scope.slice(2)).map(a => a.code));
  if (scope.startsWith("p:")) return new Set(accounts.filter(a => a.ownerName === scope.slice(2)).map(a => a.code));
  return new Set(accounts.filter(a => a.code === scope).map(a => a.code));
}

export interface LessonReview {
  traderNote: string | null;
  traderAckAt: string | null;
  reviewerAckAt: string | null;
  discussedOn: string | null;
  completedAt: string | null;
  openedAt: string;
  overdue: boolean;
  waitingOn: ("trader" | "reviewer")[];
}

export interface JournalFields {
  rationale: string | null; rationaleAt: string | null;
  review: string | null; reviewAt: string | null;
  lesson: boolean | null; lessonText: string | null;
  removed: boolean; removedReason: string | null; removedAt: string | null;
}

export interface TradeView extends ReviewedTrade {
  owner: string;
  reviewer: string;
  band: PnlBand;
  journal: JournalFields;
  ratings: Record<string, RatingValue>;
  lessonReview: LessonReview | null;
}

export interface Context {
  accounts: Account[];
  rules: Rule[];
  settings: Settings;
  trades: TradeView[];
  cashDays: CashDay[];
}

export async function loadSettings(): Promise<Settings> {
  const rows = await q<{ key: string; value: unknown }>("SELECT key, value FROM settings");
  const m = new Map(rows.map(r => [r.key, r.value]));
  return {
    pnlBands: (m.get("pnl_bands") as BandSettings) ?? { scratch: 50, big: 500 },
    dailyLossLimit: (m.get("daily_loss_limit") as Record<string, number | null>) ?? {},
    revengeWindowMinutes: Number(m.get("revenge_window_minutes") ?? 10),
    lessonReviewDueDays: Number(m.get("lesson_review_due_days") ?? 2)
  };
}

export async function loadAccounts(): Promise<Account[]> {
  return (await q<{ code: string; owner_name: string; group_code: string; ibkr_account_id: string | null; ibkr_alias: string | null }>(
    "SELECT code, owner_name, group_code, ibkr_account_id, ibkr_alias FROM accounts ORDER BY group_code, code DESC"
  )).map(a => ({ code: a.code, ownerName: a.owner_name, groupCode: a.group_code, ibkrAccountId: a.ibkr_account_id, ibkrAlias: a.ibkr_alias }));
}

export async function loadGroups(): Promise<Group[]> {
  return await q<Group>("SELECT code, name FROM groups ORDER BY name");
}

export interface CashTxn { account: string; date: string; category: string; amount: number; counterparty: string | null; description: string }
export async function loadCashTxns(): Promise<CashTxn[]> {
  return (await q<{ account_code: string; txn_date: string; category: string; amount: number; counterparty: string | null; description: string }>(
    "SELECT account_code, txn_date, category, amount, counterparty, description FROM cash_txns ORDER BY txn_date, id"
  )).map(r => ({ account: r.account_code, date: r.txn_date, category: r.category, amount: r.amount, counterparty: r.counterparty, description: r.description }));
}

/** Latest IBKR account value (NAV) per account, on or before `asOf`. */
export async function latestNav(asOf: string): Promise<Map<string, number>> {
  const rows = await q<{ account_code: string; nav: number }>(
    `SELECT DISTINCT ON (account_code) account_code, nav FROM account_days
      WHERE nav IS NOT NULL AND trade_date <= $1 ORDER BY account_code, trade_date DESC`, [asOf]);
  return new Map(rows.map(r => [r.account_code, r.nav]));
}

export async function loadRules(): Promise<Rule[]> {
  return (await q<{ id: string; text: string; active: boolean; position: number }>(
    "SELECT id, text, active, position FROM rules ORDER BY position, created_at"
  ));
}

async function loadFills(): Promise<Fill[]> {
  const rows = await q<any>(
    `SELECT exec_id, account_code, conid, symbol, underlying, description, asset_class, multiplier, executed_at_et, trade_date,
            side, quantity, price, commission, net_cash, realized_pnl, open_close
       FROM fills ORDER BY executed_at_et, exec_id`
  );
  return rows.map(r => ({
    id: r.exec_id, account: r.account_code, conid: r.conid, symbol: r.symbol, underlying: r.underlying, description: r.description,
    assetClass: r.asset_class, multiplier: r.multiplier, executedAt: r.executed_at_et, tradeDate: r.trade_date, side: r.side,
    quantity: r.quantity, price: r.price, commission: r.commission, netCash: r.net_cash, realizedPnl: r.realized_pnl, openClose: r.open_close
  }));
}

async function loadOpeningCash(): Promise<OpeningCash> {
  const rows = await q<{ account_code: string; trade_date: string; opening_cash: number | null }>(
    "SELECT account_code, trade_date, opening_cash FROM account_days WHERE opening_cash IS NOT NULL");
  const o: OpeningCash = {};
  for (const r of rows) (o[r.account_code] ??= {})[r.trade_date] = r.opening_cash;
  return o;
}

/**
 * Everything the pages need, derived on read. At two traders and a few thousand fills a year this
 * runs in milliseconds; add a cache keyed on the latest fill/journal timestamp if it ever doesn't.
 */
export async function loadContext(): Promise<Context> {
  const [accounts, rules, settings, fills, opening, journalRows, ratingRows, lessonRows] = await Promise.all([
    loadAccounts(), loadRules(), loadSettings(), loadFills(), loadOpeningCash(),
    q<any>("SELECT * FROM journal"),
    q<{ trade_key: string; rule_id: string; value: RatingValue }>("SELECT trade_key, rule_id, value FROM rule_ratings"),
    q<any>("SELECT * FROM lesson_reviews")
  ]);
  const owners = new Map(accounts.map(a => [a.code, a.ownerName]));
  const journal = new Map(journalRows.map(j => [j.trade_key, j]));
  const ratings = new Map<string, Record<string, RatingValue>>();
  for (const r of ratingRows) (ratings.get(r.trade_key) ?? ratings.set(r.trade_key, {}).get(r.trade_key)!)[r.rule_id] = r.value;
  const lessons = new Map(lessonRows.map(l => [l.trade_key, l]));

  const { fills: withCash, days } = applyCash(fills, opening);
  const now = Date.now();
  const trades: TradeView[] = buildTrades(withCash).map(t => {
    const j = journal.get(t.key);
    const rr = ratings.get(t.key) ?? {};
    const l = lessons.get(t.key);
    const lesson = j?.lesson === true;
    let lessonReview: LessonReview | null = null;
    if (lesson && l) {
      const waitingOn: LessonReview["waitingOn"] = [];
      if (!l.trader_ack_at) waitingOn.push("trader");
      if (!l.reviewer_ack_at) waitingOn.push("reviewer");
      lessonReview = {
        traderNote: l.trader_note, traderAckAt: l.trader_ack_at, reviewerAckAt: l.reviewer_ack_at, discussedOn: l.discussed_on,
        completedAt: l.completed_at, openedAt: l.opened_at,
        overdue: !l.completed_at && now - new Date(l.opened_at).getTime() > settings.lessonReviewDueDays * 864e5,
        waitingOn
      };
    }
    return {
      ...t,
      owner: owners.get(t.account) ?? t.account,
      reviewer: owners.get(accounts.find(a => a.code !== t.account)?.code ?? "") ?? "",
      removed: j?.removed === true,
      lesson,
      lessonReviewComplete: !!lessonReview?.completedAt,
      discipline: discipline(rr, rules),
      band: pnlBand(t.realizedPnl, settings.pnlBands),
      ratings: rr,
      lessonReview,
      journal: {
        rationale: j?.rationale ?? null, rationaleAt: j?.rationale_at ?? null,
        review: j?.review ?? null, reviewAt: j?.review_at ?? null,
        lesson: j?.lesson ?? null, lessonText: j?.lesson_text ?? null,
        removed: j?.removed === true, removedReason: j?.removed_reason ?? null, removedAt: j?.removed_at ?? null
      }
    };
  });
  return { accounts, rules, settings, trades, cashDays: days };
}

export async function findTrade(key: string) {
  const ctx = await loadContext();
  return { ctx, trade: ctx.trades.find(t => t.key === key) ?? null };
}
