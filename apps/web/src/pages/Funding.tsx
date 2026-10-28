import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { api, qs, type Scope } from "../api";
import { Pnl } from "../components/Pnl";
import { ScopeSwitch } from "../components/ScopeSwitch";
import { dayShort, money, pct } from "../format";
import { useScope } from "../hooks";

interface Row {
  account: string; owner: string; group: string; groupName: string;
  deposits: number; withdrawals: number; transfersIn: number; transfersOut: number;
  netInvested: number; value: number | null; gain: number | null; gainPct: number | null;
}
interface Roll { key: string; label: string; netInvested: number; value: number | null; gain: number | null; gainPct: number | null }
interface Txn { account: string; owner: string; date: string; category: string; amount: number; counterparty: string | null; description: string }
interface Result {
  scope: Scope; accounts: Row[]; byPerson: Roll[]; byGroup: Roll[]; txns: Txn[];
  totals: { deposits: number; withdrawals: number; transfersIn: number; transfersOut: number; netInvested: number; value: number | null; gain: number | null; gainPct: number | null };
}

const CAT_LABEL: Record<string, string> = { deposit: "Deposit", withdrawal: "Withdrawal", transfer_in: "Transfer in", transfer_out: "Transfer out" };
const FUNDING_CATS = ["deposit", "withdrawal"];
const TRANSFER_CATS = ["transfer_in", "transfer_out"];

export function FundingPage() {
  const [scope, setScope] = useScope();
  const q = useQuery({ queryKey: ["funding", scope], queryFn: () => api.get<Result>("/api/funding" + qs({ account: scope })) });
  const d = q.data;
  const t = d?.totals;
  const empty = d && d.accounts.every(a => a.netInvested === 0 && a.deposits === 0 && a.transfersIn === 0);
  // What the ledger below is filtered to: a tile ("funding", "transfers", "value", "gain") or a table row ("acct:…", "person:…", "group:…").
  const [sel, setSel] = useState<string | null>(null);
  const pick = (k: string) => setSel(s => (s === k ? null : k));

  const acctOf = (code: string) => d?.accounts.find(a => a.account === code);
  const selTxns = !d || !sel ? [] : d.txns.filter(x =>
    sel === "funding" ? FUNDING_CATS.includes(x.category)
      : sel === "transfers" ? TRANSFER_CATS.includes(x.category)
        : sel.startsWith("acct:") ? x.account === sel.slice(5)
          : sel.startsWith("person:") ? x.owner === sel.slice(7)
            : sel.startsWith("group:") ? acctOf(x.account)?.group === sel.slice(6)
              : true);
  const selLabel = !sel ? "" :
    sel === "funding" ? "Deposits & withdrawals"
      : sel === "transfers" ? "Internal transfers"
        : sel.startsWith("acct:") ? (() => { const a = acctOf(sel.slice(5)); return a ? `${a.owner} — ${a.groupName}` : sel.slice(5); })()
          : sel.startsWith("person:") ? sel.slice(7)
            : sel.startsWith("group:") ? (d?.byGroup.find(g => g.key === sel.slice(6))?.label ?? sel.slice(6))
              : "All transactions";
  const selNet = Math.round(selTxns.reduce((s, x) => s + x.amount, 0) * 100) / 100;

  const tile = (key: string, k: string, v: ReactNode, sub: ReactNode) => (
    <div className={`panel figure ${sel === key ? "selected" : ""}`} style={{ cursor: "pointer" }} title="Show the transactions behind this figure"
      role="button" tabIndex={0} onClick={() => pick(key)} onKeyDown={e => e.key === "Enter" && pick(key)}>
      <div className="k">{k}</div><div className="v">{v}</div><div className="sub">{sub}</div>
    </div>
  );

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Funding</h1>
          <p className="lede">Money in, internal transfers, and what each person has invested against the current account value. Select any figure or row to see the transactions behind it.</p>
        </div>
        <div className="controls"><ScopeSwitch value={scope} onChange={s => { setSel(null); setScope(s); }} /></div>
      </div>
      {q.isError && <p className="error">{(q.error as Error).message}</p>}
      {d && t && (empty ? (
        <p className="muted">No funding data yet. Import an Activity Flex report that includes the <b>Cash Transactions</b> and <b>Transfers</b> sections, or wait for the next scheduled sync.</p>
      ) : (
        <>
          <div className="grid cols-4">
            {tile("funding", "Net invested", money(t.netInvested, { sign: false }), <>Deposits {money(t.deposits, { sign: false })} · withdrawals {money(t.withdrawals, { sign: false })}</>)}
            {tile("value", "Current value", money(t.value, { sign: false }), "Latest IBKR account value")}
            {tile("gain", "Gain vs. invested", <Pnl value={t.gain} />, <>{pct(t.gainPct)} on capital</>)}
            {tile("transfers", "Internal transfers", <span style={{ fontSize: 20 }}>{money(t.transfersIn, { sign: false })} in</span>, <>{money(Math.abs(t.transfersOut), { sign: false })} out between accounts</>)}
          </div>

          {sel && (
            <div className="panel" style={{ marginTop: 14 }}>
              <h2>{selLabel} <small>{selTxns.length ? `${selTxns.length} transaction${selTxns.length === 1 ? "" : "s"} · net ${money(selNet)}` : ""}</small>
                <button className="btn small ghost" onClick={() => setSel(null)}>Close</button></h2>
              {selTxns.length ? (
                <div className="scroll">
                  <table>
                    <thead><tr><th className="l">Date</th><th className="l">Who</th><th className="l">Type</th><th>Amount</th><th className="l">Detail</th></tr></thead>
                    <tbody>
                      {selTxns.map((x, i) => (
                        <tr key={i}>
                          <td className="l">{dayShort(x.date)}</td>
                          <td className="l"><b>{x.owner}</b> <span className="muted">{acctOf(x.account)?.groupName ?? x.account}</span></td>
                          <td className="l">{CAT_LABEL[x.category] ?? x.category}</td>
                          <td><Pnl value={x.amount} /></td>
                          <td className="l">{[x.counterparty, x.description].filter(Boolean).join(" — ") || <span className="muted">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="muted">No transactions for this selection{scope !== "all" ? " in the current scope" : ""}.</p>}
            </div>
          )}

          <div className="grid cols-2" style={{ marginTop: 14 }}>
            <RollTable title="By person" rows={d.byPerson} selected={sel} keyOf={r => `person:${r.key}`} onPick={pick} />
            <RollTable title="By group" rows={d.byGroup} selected={sel} keyOf={r => `group:${r.key}`} onPick={pick} />
          </div>

          <div className="panel" style={{ marginTop: 14 }}>
            <h2>By account <small>Select a row for that account's transactions</small></h2>
            <div className="scroll">
              <table>
                <thead><tr><th className="l">Account</th><th>Deposits</th><th>Withdrawals</th><th>Transfers in</th><th>Transfers out</th><th>Net invested</th><th>Value</th><th>Gain</th><th>Return</th></tr></thead>
                <tbody>
                  {d.accounts.map(a => (
                    <tr key={a.account} className="clickable" aria-selected={sel === `acct:${a.account}`} onClick={() => pick(`acct:${a.account}`)}>
                      <td className="l"><b>{a.owner}</b> <span className="muted">{a.groupName}</span></td>
                      <td>{money(a.deposits, { sign: false })}</td>
                      <td>{money(a.withdrawals, { sign: false })}</td>
                      <td>{money(a.transfersIn, { sign: false })}</td>
                      <td>{money(a.transfersOut, { sign: false })}</td>
                      <td>{money(a.netInvested, { sign: false })}</td>
                      <td>{money(a.value, { sign: false })}</td>
                      <td><Pnl value={a.gain} /></td>
                      <td>{pct(a.gainPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ))}
    </main>
  );
}

function RollTable({ title, rows, selected, keyOf, onPick }: { title: string; rows: Roll[]; selected: string | null; keyOf: (r: Roll) => string; onPick: (k: string) => void }) {
  return (
    <div className="panel">
      <h2>{title} <small>Select a row for its transactions</small></h2>
      {rows.length ? (
        <table>
          <thead><tr><th className="l">{title.replace("By ", "")}</th><th>Net invested</th><th>Value</th><th>Gain</th><th>Return</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.key} className="clickable" aria-selected={selected === keyOf(r)} onClick={() => onPick(keyOf(r))}>
              <td className="l"><b>{r.label}</b></td><td>{money(r.netInvested, { sign: false })}</td><td>{money(r.value, { sign: false })}</td><td><Pnl value={r.gain} /></td><td>{pct(r.gainPct)}</td>
            </tr>
          ))}</tbody>
        </table>
      ) : <p className="muted">Nothing here yet.</p>}
    </div>
  );
}
