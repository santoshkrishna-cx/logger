import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { api, qs, type LogDay, type TradeView } from "../api";
import { BandLegend } from "../components/BandLegend";
import { useLayout } from "../components/Layout";
import { Pnl } from "../components/Pnl";
import { ScopeSwitch } from "../components/ScopeSwitch";
import { TradeTicket } from "../components/TradeTicket";
import { dayLong, dayShort, money, pct } from "../format";
import { useScope } from "../hooks";
import { accountInScope, scopeIsCombined, scopeLabel } from "../scope";

interface DayRow { date: string; byAccount: Record<string, number>; total: number }

export function LogPage() {
  const { me } = useLayout();
  const { date } = useParams();
  const nav = useNavigate();
  const [scope, setScope] = useScope();
  const days = useQuery({ queryKey: ["days", scope], queryFn: () => api.get<DayRow[]>("/api/days" + qs({ account: scope })) });
  const day = date ?? days.data?.[0]?.date;
  const log = useQuery({ queryKey: ["log", day, scope], enabled: !!day, queryFn: () => api.get<LogDay>("/api/log" + qs({ date: day, account: scope })) });
  const [showRemoved, setShowRemoved] = useState(false);
  useEffect(() => setShowRemoved(false), [day]);

  if (days.data && !days.data.length) {
    return (
      <main className="page">
        <h1>No trades yet</h1>
        <p className="lede">Import today’s IBKR report to start the log. Once the sync is set up, trades arrive on their own every 15 minutes during the session.</p>
        <p><Link className="btn primary" to="/import">Import an IBKR report</Link></p>
      </main>
    );
  }

  const l = log.data;
  const owners = Object.fromEntries(me.accounts.map(a => [a.code, a.ownerName]));
  const section = (title: string, sub: string, list: TradeView[]) => list.length ? (
    <div className="section">
      <h3>{title} <small>{sub}</small></h3>
      {list.map(t => <TradeTicket key={t.key} t={t} rules={l!.rules} bands={l!.bands} me={me.user.account} day={l!.date} />)}
    </div>
  ) : null;

  return (
    <main className="page">
      <div className="page-head">
        <div className="controls"><ScopeSwitch value={scope} onChange={setScope} /></div>
        {l && <BandLegend bands={l.bands} />}
      </div>
      <div className="log">
        <nav className="rail" aria-label="Trading days">
          {days.data?.map(d => (
            <Link key={d.date} to={`/log/${d.date}${scope !== "all" ? `?who=${scope}` : ""}`} className={`dayb ${d.date === day ? "active" : ""}`} aria-current={d.date === day ? "page" : undefined}>
              <span>{dayShort(d.date)}</span><Pnl value={d.total} bands={l?.bands} />
            </Link>
          ))}
        </nav>
        <section>
          {!l ? <p className="muted">Loading the day…</p> : (
            <>
              <div className="dayhead">
                <h1>{dayLong(l.date)}</h1>
                {Object.keys(owners).filter(a => accountInScope(scope, a, me)).map(a => (
                  <div className="stat" key={a}><span className="v"><Pnl value={l.summary.realized[a] ?? 0} bands={l.bands} /></span><span className="k">{owners[a]} realized</span></div>
                ))}
                {scopeIsCombined(scope, me) && <div className="stat"><span className="v"><Pnl value={l.summary.total} /></span><span className="k">Combined</span></div>}
                <div className="stat"><span className="v">{l.summary.trades ? `${l.summary.wins} of ${l.summary.trades}` : "0"}</span><span className="k">Winning trades</span></div>
                <div className="stat"><span className="v">{pct(l.summary.discipline)}</span><span className="k">Rules followed</span></div>
                <div className="stat"><span className="v">{l.summary.awaitingReview}</span><span className="k">Awaiting review</span></div>
                <div className="stat"><span className="v" style={{ color: l.summary.openLessons ? "var(--loss)" : undefined }}>{l.summary.openLessons}</span><span className="k">Lessons to review together</span></div>
                {l.cash.map(c => <OpeningCash key={c.account} account={c.account} owner={owners[c.account]} date={l.date} value={c.opening} entered={c.openingEntered} closing={c.closing} />)}
              </div>
              {section("Round trips", "Opened and closed this day", l.sections.roundTrips)}
              {section("Carried in and closed", "Opened on an earlier day", l.sections.carriedIn)}
              {section("Still open at the close", "No realized P&L yet", l.sections.stillOpen)}
              {!l.sections.roundTrips.length && !l.sections.carriedIn.length && !l.sections.stillOpen.length && <p className="muted" style={{ marginTop: 20 }}>No trades for {scopeIsCombined(scope, me) ? "this selection" : scopeLabel(scope, me)} on this day.</p>}
              {l.sections.removed.length > 0 && (
                <div className="section">
                  <h3>Removed as erroneous <small>{l.sections.removed.length} left out of P&amp;L and stats</small>
                    <button className="btn small ghost" onClick={() => setShowRemoved(s => !s)}>{showRemoved ? "Hide" : "Show"}</button></h3>
                  {showRemoved && l.sections.removed.map(t => <TradeTicket key={t.key} t={t} rules={l.rules} bands={l.bands} me={me.user.account} day={l.date} />)}
                </div>
              )}
            </>
          )}
          {days.data && date && !days.data.some(d => d.date === date) && <p className="muted"><button className="btn small" onClick={() => nav("/log")}>Go to the latest trading day</button></p>}
        </section>
      </div>
    </main>
  );
}

function OpeningCash({ account, owner, date, value, entered, closing }: { account: string; owner: string; date: string; value: number | null; entered: boolean; closing: number | null }) {
  const qc = useQueryClient();
  const [v, setV] = useState(value === null ? "" : String(value));
  useEffect(() => setV(value === null ? "" : String(value)), [value]);
  const save = useMutation({
    mutationFn: (n: number | null) => api.put(`/api/account-days/${account}/${date}/opening-cash`, { value: n }),
    onSuccess: () => ["log", "dashboard"].forEach(k => qc.invalidateQueries({ queryKey: [k] }))
  });
  return (
    <label className="stat">
      <span className="k">{owner} opening cash{entered ? "" : value !== null ? " (carried forward)" : ""}</span>
      <input type="number" step="0.01" inputMode="decimal" value={v} placeholder="Enter" onChange={e => setV(e.target.value)}
        onBlur={() => { const n = v === "" ? null : Number(v); if (n !== value) save.mutate(n); }} />
      <span className="k">Close {money(closing, { sign: false })}</span>
    </label>
  );
}
