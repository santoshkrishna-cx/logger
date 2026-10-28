import type { FlexReport, ParsedFill } from "@logger/core";
import { pool, tx } from "../db.js";
import { loadAccounts } from "./data.js";

export type Source = "trade-confirmation" | "activity" | "cash" | "file";

export interface AccountPreview { account: string; newFills: number; alreadyLogged: number; willUpgrade: number; from: string; to: string }
export interface IngestResult {
  kind: FlexReport["kind"];
  accounts: AccountPreview[];
  unmatched: { ibkrAccount: string; alias: string; fills: number }[];
  added: number;
  upgraded: number;
  cashAdded: number;
  committed: boolean;
}

/** Matches a report row to our account code: alias first, then known U-number, then a one-time mapping from the import screen. */
async function matcher(mapping: Record<string, string>) {
  const accounts = await loadAccounts();
  const byAlias = new Map(accounts.filter(a => a.ibkrAlias).map(a => [a.ibkrAlias!.toLowerCase(), a.code]));
  const byId = new Map(accounts.filter(a => a.ibkrAccountId).map(a => [a.ibkrAccountId!, a.code]));
  const codes = new Set(accounts.map(a => a.code));
  return (ibkrAccount: string, alias: string): string | null => {
    const al = alias.toLowerCase();
    if (al && byAlias.has(al)) return byAlias.get(al)!;
    if (al && codes.has(al)) return al;
    if (ibkrAccount && byId.has(ibkrAccount)) return byId.get(ibkrAccount)!;
    if (ibkrAccount && mapping[ibkrAccount] && codes.has(mapping[ibkrAccount])) return mapping[ibkrAccount];
    return null;
  };
}

export async function ingest(report: FlexReport, source: Source, opts: { commit: boolean; mapping?: Record<string, string> }): Promise<IngestResult> {
  const match = await matcher(opts.mapping ?? {});
  const ids = report.fills.map(f => f.id);
  const existing = new Map<string, { realized_pnl: number | null }>();
  if (ids.length) {
    const rows = await pool.query<{ exec_id: string; realized_pnl: number | null }>("SELECT exec_id, realized_pnl FROM fills WHERE exec_id = ANY($1)", [ids]);
    rows.rows.forEach(r => existing.set(r.exec_id, r));
  }

  const per = new Map<string, AccountPreview>();
  const unmatched = new Map<string, { ibkrAccount: string; alias: string; fills: number }>();
  const accepted: { f: ParsedFill; account: string }[] = [];
  for (const f of report.fills) {
    const account = match(f.ibkrAccount, f.alias);
    if (!account) {
      const k = f.ibkrAccount || f.alias || "(blank)";
      const u = unmatched.get(k) ?? { ibkrAccount: f.ibkrAccount, alias: f.alias, fills: 0 };
      u.fills++; unmatched.set(k, u);
      continue;
    }
    accepted.push({ f, account });
    const p = per.get(account) ?? { account, newFills: 0, alreadyLogged: 0, willUpgrade: 0, from: f.tradeDate, to: f.tradeDate };
    const ex = existing.get(f.id);
    if (!ex) p.newFills++;
    else if (ex.realized_pnl === null && f.realizedPnl !== null) p.willUpgrade++;
    else p.alreadyLogged++;
    if (f.tradeDate < p.from) p.from = f.tradeDate;
    if (f.tradeDate > p.to) p.to = f.tradeDate;
    per.set(account, p);
  }

  const result: IngestResult = { kind: report.kind, accounts: [...per.values()], unmatched: [...unmatched.values()], added: 0, upgraded: 0, cashAdded: 0, committed: false };
  if (!opts.commit) return result;

  await tx(async c => {
    // Remember U-numbers we have now matched, so the next import needs no mapping.
    for (const { f, account } of accepted) {
      if (f.ibkrAccount) await c.query("UPDATE accounts SET ibkr_account_id = $1 WHERE code = $2 AND ibkr_account_id IS NULL", [f.ibkrAccount, account]);
    }
    for (const { f, account } of accepted) {
      const r = await c.query<{ inserted: boolean }>(
        `INSERT INTO fills (exec_id, account_code, conid, symbol, underlying, description, asset_class, multiplier, executed_at_et, trade_date,
                            side, quantity, price, commission, net_cash, realized_pnl, open_close, source, raw)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         ON CONFLICT (exec_id) DO UPDATE
           SET realized_pnl = EXCLUDED.realized_pnl, commission = EXCLUDED.commission, net_cash = EXCLUDED.net_cash,
               open_close = CASE WHEN fills.open_close = '' THEN EXCLUDED.open_close ELSE fills.open_close END,
               source = EXCLUDED.source, upgraded_at = now()
           WHERE fills.realized_pnl IS NULL AND EXCLUDED.realized_pnl IS NOT NULL
         RETURNING (xmax = 0) AS inserted`,
        [f.id, account, f.conid, f.symbol, f.underlying, f.description, f.assetClass, f.multiplier, f.executedAt, f.tradeDate,
         f.side, f.quantity, f.price, f.commission, f.netCash, f.realizedPnl, f.openClose, source, JSON.stringify(f.raw)]
      );
      if (r.rows[0]?.inserted === true) result.added++;
      else if (r.rows[0]) result.upgraded++;
    }
    for (const cash of report.cash) {
      const account = match(cash.ibkrAccount, cash.alias);
      if (!account || !cash.fromDate) continue;
      await c.query(
        `INSERT INTO account_days (account_code, trade_date, opening_cash, opening_cash_source) VALUES ($1,$2,$3,'ibkr')
         ON CONFLICT (account_code, trade_date) DO UPDATE SET opening_cash = EXCLUDED.opening_cash, opening_cash_source = 'ibkr', updated_at = now()`,
        [account, cash.fromDate, cash.startingCash]
      );
      if (cash.endingCash !== null && cash.toDate) {
        await c.query(
          `INSERT INTO account_days (account_code, trade_date, ending_cash) VALUES ($1,$2,$3)
           ON CONFLICT (account_code, trade_date) DO UPDATE SET ending_cash = EXCLUDED.ending_cash, updated_at = now()`,
          [account, cash.toDate, cash.endingCash]
        );
      }
    }
    for (const n of report.nav) {
      const account = match(n.ibkrAccount, n.alias);
      if (!account || !n.date) continue;
      // EquitySummary carries the real end-of-day cash balance per date (n.cash); store it so the
      // next day's opening cash is IBKR's actual figure, not a running sum that ignores deposits.
      await c.query(
        `INSERT INTO account_days (account_code, trade_date, nav, ending_cash) VALUES ($1,$2,$3,$4)
         ON CONFLICT (account_code, trade_date) DO UPDATE
           SET nav = EXCLUDED.nav, ending_cash = COALESCE(EXCLUDED.ending_cash, account_days.ending_cash), updated_at = now()`,
        [account, n.date, n.total, n.cash]
      );
    }
    const posKeys = new Set<string>();
    for (const p of report.positions) {
      const account = match(p.ibkrAccount, p.alias);
      if (!account || !p.date) continue;
      const k = `${account}|${p.date}`;
      if (!posKeys.has(k)) { await c.query("DELETE FROM open_positions WHERE account_code = $1 AND report_date = $2", [account, p.date]); posKeys.add(k); }
      await c.query(
        `INSERT INTO open_positions (account_code, report_date, conid, symbol, description, quantity, mark_price, position_value, cost_basis, unrealized_pnl)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
        [account, p.date, p.conid, p.symbol, p.description, p.quantity, p.markPrice, p.positionValue, p.costBasis, p.unrealizedPnl]
      );
    }
    for (const ct of report.cashTxns) {
      const account = match(ct.ibkrAccount, ct.alias);
      if (!account || !ct.date) continue;
      const r = await c.query(
        `INSERT INTO cash_txns (id, account_code, txn_date, category, amount, currency, counterparty, description, source, raw)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
        [ct.id, account, ct.date, ct.category, ct.amount, ct.currency, ct.counterparty, ct.description, source, JSON.stringify(ct.raw)]
      );
      if (r.rowCount) result.cashAdded++;
    }
  });
  result.committed = true;
  return result;
}
