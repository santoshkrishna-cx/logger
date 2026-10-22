import { useQuery } from "@tanstack/react-query";
import { api, qs, type Scope } from "../api";
import { Pnl } from "../components/Pnl";
import { ScopeSwitch } from "../components/ScopeSwitch";
import { money, pct } from "../format";
import { useScope } from "../hooks";

interface Row {
  account: string; owner: string; group: string; groupName: string;
  deposits: number; withdrawals: number; transfersIn: number; transfersOut: number;
  netInvested: number; value: number | null; gain: number | null; gainPct: number | null;
}
interface Roll { key: string; label: string; netInvested: number; value: number | null; gain: number | null; gainPct: number | null }
interface Result {
  scope: Scope; accounts: Row[]; byPerson: Roll[]; byGroup: Roll[];
  totals: { deposits: number; withdrawals: number; transfersIn: number; transfersOut: number; netInvested: number; value: number | null; gain: number | null; gainPct: number | null };
}

export function FundingPage() {
  const [scope, setScope] = useScope();
  const q = useQuery({ queryKey: ["funding", scope], queryFn: () => api.get<Result>("/api/funding" + qs({ account: scope })) });
  const d = q.data;
  const t = d?.totals;
  const empty = d && d.accounts.every(a => a.netInvested === 0 && a.deposits === 0 && a.transfersIn === 0);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Funding</h1>
          <p className="lede">Money in, internal transfers, and what each person has invested against the current account value.</p>
        </div>
        <div className="controls"><ScopeSwitch value={scope} onChange={setScope} /></div>
      </div>
      {q.isError && <p className="error">{(q.error as Error).message}</p>}
      {d && t && (empty ? (
        <p className="muted">No funding data yet. Import an Activity Flex report that includes the <b>Cash Transactions</b> and <b>Transfers</b> sections, or wait for the next scheduled sync.</p>
      ) : (
        <>
          <div className="grid cols-4">
            <div className="panel figure"><div className="k">Net invested</div><div className="v">{money(t.netInvested, { sign: false })}</div><div className="sub">Deposits {money(t.deposits, { sign: false })} · withdrawals {money(t.withdrawals, { sign: false })}</div></div>
            <div className="panel figure"><div className="k">Current value</div><div className="v">{money(t.value, { sign: false })}</div><div className="sub">Latest IBKR account value</div></div>
            <div className="panel figure"><div className="k">Gain vs. invested</div><div className="v"><Pnl value={t.gain} /></div><div className="sub">{pct(t.gainPct)} on capital</div></div>
            <div className="panel figure"><div className="k">Internal transfers</div><div className="v" style={{ fontSize: 20 }}>{money(t.transfersIn, { sign: false })} in</div><div className="sub">{money(Math.abs(t.transfersOut), { sign: false })} out between accounts</div></div>
          </div>

          <div className="grid cols-2" style={{ marginTop: 14 }}>
            <RollTable title="By person" rows={d.byPerson} />
            <RollTable title="By group" rows={d.byGroup} />
          </div>

          <div className="panel" style={{ marginTop: 14 }}>
            <h2>By account</h2>
            <div className="scroll">
              <table>
                <thead><tr><th className="l">Account</th><th>Deposits</th><th>Withdrawals</th><th>Transfers in</th><th>Transfers out</th><th>Net invested</th><th>Value</th><th>Gain</th><th>Return</th></tr></thead>
                <tbody>
                  {d.accounts.map(a => (
                    <tr key={a.account}>
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

function RollTable({ title, rows }: { title: string; rows: Roll[] }) {
  return (
    <div className="panel">
      <h2>{title}</h2>
      {rows.length ? (
        <table>
          <thead><tr><th className="l">{title.replace("By ", "")}</th><th>Net invested</th><th>Value</th><th>Gain</th><th>Return</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.key}><td className="l"><b>{r.label}</b></td><td>{money(r.netInvested, { sign: false })}</td><td>{money(r.value, { sign: false })}</td><td><Pnl value={r.gain} /></td><td>{pct(r.gainPct)}</td></tr>
          ))}</tbody>
        </table>
      ) : <p className="muted">Nothing here yet.</p>}
    </div>
  );
}
