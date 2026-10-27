import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, qs, type Scope } from "../api";
import { Pnl } from "../components/Pnl";
import { ScopeSwitch } from "../components/ScopeSwitch";
import { dayShort, money } from "../format";
import { useParam, useScope } from "../hooks";

interface Day { date: string; screen: number | null; assumed: number; trades: number; ibkr: number | null; diff: number | null; navPnl: number | null }
interface AssumedTrade {
  key: string; account: string; owner: string; description: string; direction: string; quantity: number;
  openDate: string; closeDate: string | null; realizedPnl: number | null;
}
interface Result { from: string; to: string; scope: Scope; days: Day[]; assumedTrades: AssumedTrade[] }

const iso = (d: Date) => d.toISOString().slice(0, 10);
const sum = (xs: (number | null)[]) => {
  const have = xs.filter((x): x is number => x !== null);
  return have.length ? Math.round(have.reduce((s, x) => s + x, 0) * 100) / 100 : null;
};

export function ReconcilePage() {
  const [scope, setScope] = useScope();
  const [range, setRange] = useParam<string>("days", "30");
  const to = iso(new Date());
  const from = iso(new Date(Date.now() - Number(range) * 864e5));
  const q = useQuery({
    queryKey: ["reconcile", scope, range],
    queryFn: () => api.get<Result>("/api/reconcile" + qs({ from, to, account: scope }))
  });
  const d = q.data;
  const offDays = d?.days.filter(x => x.diff !== null && Math.abs(x.diff) >= 0.01).length ?? 0;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Reconcile</h1>
          <p className="lede">Each day's on-screen P&amp;L against what IBKR's own report rows say, so a wrong number can't hide.</p>
        </div>
        <div className="controls">
          {["30", "60", "90"].map(r => (
            <button key={r} className={`btn small ${range === r ? "" : "ghost"}`} onClick={() => setRange(r)}>{r}d</button>
          ))}
          <ScopeSwitch value={scope} onChange={setScope} />
        </div>
      </div>
      {q.isError && <p className="error">{(q.error as Error).message}</p>}
      {d && (
        <>
          <div className="panel">
            <h2>Day by day {offDays > 0 ? <small className="error">{offDays} day{offDays > 1 ? "s" : ""} don't match</small> : <small>all days match IBKR</small>}</h2>
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th className="l">Day</th><th>On screen</th><th>Assumed expiry</th><th>IBKR report</th><th>Unexplained Δ</th><th>IBKR account P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {d.days.map(x => (
                    <tr key={x.date} className={x.diff !== null && Math.abs(x.diff) >= 0.01 ? "warn" : ""}>
                      <td className="l"><Link to={`/log/${x.date}`}>{dayShort(x.date)}</Link> <span className="muted">{x.trades ? `${x.trades} trade${x.trades > 1 ? "s" : ""}` : ""}</span></td>
                      <td><Pnl value={x.screen} /></td>
                      <td>{x.assumed ? <Pnl value={x.assumed} /> : <span className="muted">—</span>}</td>
                      <td>{x.ibkr === null ? <span className="muted" title="No Activity report rows for this day yet">not reported yet</span> : <Pnl value={x.ibkr} />}</td>
                      <td>{x.diff === null ? <span className="muted">—</span> : Math.abs(x.diff) < 0.01 ? <span className="muted">✓</span> : <b>{money(x.diff)}</b>}</td>
                      <td>{x.navPnl === null ? <span className="muted">—</span> : <Pnl value={x.navPnl} />}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="l"><b>Period total</b></td>
                    <td><Pnl value={sum(d.days.map(x => x.screen))} /></td>
                    <td><Pnl value={sum(d.days.map(x => x.assumed))} /></td>
                    <td><Pnl value={sum(d.days.map(x => x.ibkr))} /></td>
                    <td>{(() => { const t = sum(d.days.map(x => x.diff)); return t !== null && Math.abs(t) >= 0.01 ? <b>{money(t)}</b> : <span className="muted">✓</span>; })()}</td>
                    <td><Pnl value={sum(d.days.map(x => x.navPnl))} /></td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="muted" style={{ marginTop: 10 }}>
              <b>On screen</b> is what the Calendar and Log count: realized P&amp;L of trades closed that day. A trade scaled out
              over several days lands entirely on its close day here but on each fill's own day in IBKR's rows, so offsetting
              day Δs that cancel in the period total are fine.
              <b> Assumed expiry</b> is the part booked by Logger itself for options that expired with no IBKR expiry row yet — it is excluded before comparing.
              <b> IBKR report</b> sums FIFO realized P&amp;L straight off the ingested Activity rows, so any <b>unexplained Δ</b> is a real discrepancy worth chasing.
              <b> IBKR account P&amp;L</b> is the account-value change net of deposits and transfers; it includes unrealized moves, fees and interest, so it brackets the day rather than matching it.
            </p>
          </div>

          <div className="panel" style={{ marginTop: 14 }}>
            <h2>Assumed expiries <small>{d.assumedTrades.length ? "check these against the IBKR Activity Statement" : "none — every close is confirmed by IBKR"}</small></h2>
            {d.assumedTrades.length > 0 && (
              <>
                <div className="scroll">
                  <table>
                    <thead><tr><th className="l">Contract</th><th className="l">Who</th><th>Direction</th><th>Qty</th><th className="l">Opened</th><th className="l">Expired</th><th>Booked P&amp;L</th></tr></thead>
                    <tbody>
                      {d.assumedTrades.map(t => (
                        <tr key={t.key}>
                          <td className="l"><Link to={`/log/${t.closeDate ?? t.openDate}`}>{t.description}</Link></td>
                          <td className="l">{t.owner}</td>
                          <td>{t.direction}</td>
                          <td>{t.quantity}</td>
                          <td className="l">{dayShort(t.openDate)}</td>
                          <td className="l">{t.closeDate ? dayShort(t.closeDate) : "—"}</td>
                          <td><Pnl value={t.realizedPnl} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="muted" style={{ marginTop: 10 }}>
                  Logger closed these at $0 on their expiry date because the position outlived the contract. They disappear from
                  this list on their own when IBKR's expiry row arrives in a sync or an imported file. To verify one by hand:
                  IBKR portal → Performance &amp; Reports → Statements → Activity, pick the expiry date — the contract should show
                  as expired with the same P&amp;L. If IBKR shows an <i>exercise or assignment</i> instead, import that day's
                  Activity Flex file and the real outcome replaces the assumption.
                </p>
              </>
            )}
          </div>
        </>
      )}
    </main>
  );
}
