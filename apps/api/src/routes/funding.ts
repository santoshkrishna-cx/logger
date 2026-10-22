import { r2 } from "@logger/core";
import { Router } from "express";
import { z } from "zod";
import { ah } from "../http.js";
import { latestNav, loadAccounts, loadCashTxns, loadGroups, scopeAccounts, type CashTxn } from "../services/data.js";

export const fundingRouter = Router();

interface AccountFunding {
  account: string; owner: string; group: string; groupName: string;
  deposits: number; withdrawals: number; transfersIn: number; transfersOut: number;
  netInvested: number; value: number | null; gain: number | null; gainPct: number | null;
}

const gainPct = (gain: number | null, invested: number) => (gain !== null && invested !== 0 ? r2((gain / Math.abs(invested)) * 100) : null);

/** Funding ledger: deposits, internal transfers, net invested and value vs. invested — per account, person and group. */
fundingRouter.get("/funding", ah(async (req, res) => {
  const { account } = z.object({ account: z.string().default("all") }).parse(req.query);
  const [accounts, groups, txns, navs] = await Promise.all([loadAccounts(), loadGroups(), loadCashTxns(), latestNav("2999-12-31")]);
  const codes = scopeAccounts(account, accounts);
  const groupName = (code: string) => groups.find(g => g.code === code)?.name ?? code;

  const byAcct = new Map<string, CashTxn[]>();
  for (const t of txns) { if (codes.has(t.account)) (byAcct.get(t.account) ?? byAcct.set(t.account, []).get(t.account)!).push(t); }

  const sum = (list: CashTxn[], pred: (c: CashTxn) => boolean) => r2(list.filter(pred).reduce((s, c) => s + c.amount, 0));
  const rows: AccountFunding[] = accounts.filter(a => codes.has(a.code)).map(a => {
    const list = byAcct.get(a.code) ?? [];
    const deposits = sum(list, c => c.category === "deposit");
    const withdrawals = sum(list, c => c.category === "withdrawal");
    const transfersIn = sum(list, c => c.category === "transfer_in");
    const transfersOut = sum(list, c => c.category === "transfer_out");
    const netInvested = r2(deposits + withdrawals + transfersIn + transfersOut);
    const value = navs.get(a.code) ?? null;
    const gain = value === null ? null : r2(value - netInvested);
    return { account: a.code, owner: a.ownerName, group: a.groupCode, groupName: groupName(a.groupCode),
      deposits, withdrawals, transfersIn, transfersOut, netInvested, value, gain, gainPct: gainPct(gain, netInvested) };
  });

  const rollup = <K extends string>(keyOf: (r: AccountFunding) => K, labelOf: (r: AccountFunding) => string) => {
    const m = new Map<string, { label: string; netInvested: number; value: number | null; hasValue: boolean }>();
    for (const r of rows) {
      const k = keyOf(r);
      const e = m.get(k) ?? { label: labelOf(r), netInvested: 0, value: 0, hasValue: false };
      e.netInvested = r2(e.netInvested + r.netInvested);
      if (r.value !== null) { e.value = r2((e.value ?? 0) + r.value); e.hasValue = true; }
      m.set(k, e);
    }
    return [...m.entries()].map(([key, e]) => {
      const value = e.hasValue ? e.value : null;
      const gain = value === null ? null : r2(value - e.netInvested);
      return { key, label: e.label, netInvested: e.netInvested, value, gain, gainPct: gainPct(gain, e.netInvested) };
    });
  };

  const byPerson = rollup(r => r.owner, r => r.owner).sort((a, b) => b.netInvested - a.netInvested);
  const byGroup = rollup(r => r.group, r => r.groupName).sort((a, b) => b.netInvested - a.netInvested);
  const netInvested = r2(rows.reduce((s, r) => s + r.netInvested, 0));
  const value = rows.some(r => r.value !== null) ? r2(rows.reduce((s, r) => s + (r.value ?? 0), 0)) : null;
  const gain = value === null ? null : r2(value - netInvested);

  res.json({
    scope: account,
    accounts: rows,
    byPerson,
    byGroup,
    totals: {
      deposits: r2(rows.reduce((s, r) => s + r.deposits, 0)),
      withdrawals: r2(rows.reduce((s, r) => s + r.withdrawals, 0)),
      transfersIn: r2(rows.reduce((s, r) => s + r.transfersIn, 0)),
      transfersOut: r2(rows.reduce((s, r) => s + r.transfersOut, 0)),
      netInvested, value, gain, gainPct: gainPct(gain, netInvested)
    }
  });
}));
