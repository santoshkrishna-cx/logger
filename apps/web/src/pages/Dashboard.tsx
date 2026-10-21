import { useQuery } from "@tanstack/react-query";
import { pnlBand, shiftPeriod, todayET, type BandSettings, type Period, type PnlBand } from "@logger/core";
import { Fragment } from "react";
import { useNavigate } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, qs, type Scope } from "../api";
import { BandLegend } from "../components/BandLegend";
import { Pnl } from "../components/Pnl";
import { ScopeSwitch } from "../components/ScopeSwitch";
import { dayShort, money, pct, personClass, price, rangeLabel } from "../format";
import { useParam, useScope } from "../hooks";

interface Position { key: string; account: string; owner: string; contract: string; direction: string; quantity: number; avgEntry: number | null; costBasis: number | null; markValue: number | null }
interface Figures {
  account: string; owner: string; realized: number; trades: number; wins: number; winRate: number | null; discipline: number | null;
  cash: number | null; cashAsOf: string | null; cashChange: number | null; nav: number | null; navAsOf: string | null;
  openContracts: number; openCost: number; positions: Position[]; openLessons: number;
}
interface Dashboard {
  period: Period; date: string; range: { from: string; to: string }; scope: Scope; bands: BandSettings;
  combined: { realized: number; trades: number; wins: number; winRate: number | null; discipline: number | null; cash: number | null; cashChange: number | null; nav: number | null; openContracts: number; openCost: number; openLessons: number; previousRealized: number };
  byAccount: Figures[];
  series: ({ date: string; total: number } & Record<string, number | string>)[];
  intraday: { time: string; key: string; owner: string; contract: string; pnl: number; band: PnlBand; cumulative: number }[];
  positions: Position[];
}

const PERIODS: [Period, string][] = [["day", "Day"], ["week", "Week"], ["month", "Month"], ["year", "Year"]];
const PREV: Record<Period, string> = { day: "previous trading day", week: "last week", month: "last month", year: "last year" };

export function DashboardPage() {
  const [period, setPeriod] = useParam<Period>("period", "day");
  const [date, setDate] = useParam<string>("date", todayET());
  const [scope, setScope] = useScope();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["dashboard", period, date, scope], queryFn: () => api.get<Dashboard>("/api/dashboard" + qs({ period, date, account: scope })) });
  const d = q.data;
  const c = d?.combined;
  const delta = c ? c.realized - c.previousRealized : 0;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>{scope === "both" ? "Combined" : scope === "anilsub02" ? "Santosh" : "Anil"}</h1>
          <p className="lede">{d ? rangeLabel(period, d.range.from, d.range.to) : " "}</p>
        </div>
        <div className="controls">
          <div className="seg" role="group" aria-label="Period">
            {PERIODS.map(([v, l]) => <button key={v} aria-pressed={period === v} onClick={() => setPeriod(v)}>{l}</button>)}
          </div>
          <div className="seg" role="group" aria-label="Move through time">
            <button onClick={() => setDate(shiftPeriod(period, date, -1))} aria-label="Previous">‹</button>
            <button onClick={() => setDate(todayET())}>Today</button>
            <button onClick={() => setDate(shiftPeriod(period, date, 1))} aria-label="Next">›</button>
          </div>
          <ScopeSwitch value={scope} onChange={setScope} />
        </div>
      </div>

      {q.isError && <p className="error">{(q.error as Error).message}</p>}
      {d && c && (
        <>
          <div style={{ marginBottom: 14 }}><BandLegend bands={d.bands} /></div>

          <div className="grid cols-4">
            <div className="panel figure">
              <div className="k">Realized P&amp;L</div>
              <div className="v"><Pnl value={c.realized} bands={scope === "both" ? scaled(d.bands, 2) : d.bands} /></div>
              <div className="sub">{c.previousRealized || c.realized ? <>{money(delta)} against {PREV[period]}</> : "No closed trades"}</div>
            </div>
            <div className="panel figure">
              <div className="k">Cash</div>
              <div className="v">{money(c.cash, { sign: false })}</div>
              <div className="sub">{c.cashChange !== null ? <>{money(c.cashChange)} over the period</> : "Opening cash not in yet"}</div>
            </div>
            <div className="panel figure">
              <div className="k">Account value (IBKR)</div>
              <div className="v">{money(c.nav, { sign: false })}</div>
              <div className="sub">{d.byAccount.filter(a => scope === "both" || a.account === scope).map(a => a.navAsOf ? `${a.owner} as of ${dayShort(a.navAsOf)}` : `${a.owner}: next Activity report`).join(". ")}</div>
            </div>
            <div className="panel figure">
              <div className="k">Open position at period end</div>
              <div className="v">{c.openContracts} <span style={{ fontSize: 15, fontWeight: 500 }}>contracts</span></div>
              <div className="sub">{c.openContracts ? `${money(c.openCost, { sign: false })} cost basis` : "Flat"}</div>
            </div>
          </div>

          <div className="grid cols-3" style={{ marginTop: 14 }}>
            <div className="panel figure"><div className="k">Trades closed</div><div className="v">{c.trades}</div><div className="sub">{c.trades ? `${c.wins} winners, win rate ${pct(c.winRate)}` : "None in this period"}</div></div>
            <div className="panel figure"><div className="k">Rules followed</div><div className="v">{pct(c.discipline)}</div><div className="sub">Average across rated trades</div></div>
            <div className="panel figure" onClick={() => nav("/lessons")} style={{ cursor: "pointer" }}>
              <div className="k">Lessons still to review together</div>
              <div className="v" style={{ color: c.openLessons ? "var(--loss)" : "var(--win)" }}>{c.openLessons}</div>
              <div className="sub">{c.openLessons ? "Target is 100% reviewed. Open the Lessons page." : "All lessons reviewed together"}</div>
            </div>
          </div>

          <div className="panel" style={{ marginTop: 14 }}>
            <h2>By person <small>Select a row to see that person alone</small></h2>
            <div className="scroll">
              <table>
                <thead><tr><th className="l">Person</th><th>Realized</th><th>Trades</th><th>Win rate</th><th>Rules followed</th><th>Cash</th><th>Account value</th><th>Open contracts</th><th>Lessons open</th></tr></thead>
                <tbody>
                  {d.byAccount.map(a => (
                    <tr key={a.account} className="clickable" aria-selected={scope === a.account} onClick={() => setScope(scope === a.account ? "both" : (a.account as Scope))}>
                      <td className="l"><span className={`chip ${personClass(a.account)}`}>{a.owner}</span></td>
                      <td><Pnl value={a.realized} bands={d.bands} /></td>
                      <td>{a.trades}</td><td>{pct(a.winRate)}</td><td>{pct(a.discipline)}</td>
                      <td>{money(a.cash, { sign: false })}</td><td>{money(a.nav, { sign: false })}</td>
                      <td>{a.openContracts}</td><td>{a.openLessons}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel" style={{ marginTop: 14 }}>
            {period === "day" ? (
              <>
                <h2>Through the day <small>Running realized P&amp;L as each trade closed</small></h2>
                {d.intraday.length ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={d.intraday} margin={{ left: 8, right: 16, top: 8 }}>
                      <CartesianGrid stroke="var(--line)" vertical={false} />
                      <XAxis dataKey="time" stroke="var(--muted)" fontSize={12} />
                      <YAxis stroke="var(--muted)" fontSize={12} tickFormatter={v => money(v)} width={72} />
                      <ReferenceLine y={0} stroke="var(--line-strong)" />
                      <Tooltip formatter={(v: number) => money(v)} labelFormatter={l => `Closed at ${l} ET`} contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)" }} />
                      <Line type="stepAfter" dataKey="cumulative" name="Running P&L" stroke="var(--accent)" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : <p className="muted">No trades closed on this day. Pick another day or import today’s report.</p>}
              </>
            ) : (
              <>
                <h2>Day by day <small>Bar colour follows the P&amp;L scale. Select a bar to open that day’s log.</small></h2>
                {d.series.length ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={d.series} margin={{ left: 8, right: 16, top: 8 }} onClick={(e: { activeLabel?: string } | null) => e?.activeLabel && nav(`/log/${e.activeLabel}`)}>
                      <CartesianGrid stroke="var(--line)" vertical={false} />
                      <XAxis dataKey="date" stroke="var(--muted)" fontSize={12} tickFormatter={v => dayShort(v)} minTickGap={16} />
                      <YAxis stroke="var(--muted)" fontSize={12} tickFormatter={v => money(v)} width={72} />
                      <ReferenceLine y={0} stroke="var(--line-strong)" />
                      <Tooltip cursor={{ fill: "var(--surface-2)" }} content={<SeriesTip accounts={d.byAccount} />} />
                      <Bar dataKey="total" name="Realized" radius={[3, 3, 0, 0]} style={{ cursor: "pointer" }}>
                        {d.series.map(s => <Cell key={s.date} fill={`var(--${pnlBand(s.total, d.bands) === "none" ? "scratch" : pnlBand(s.total, d.bands)})`} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : <p className="muted">No trades closed in this period.</p>}
              </>
            )}
          </div>

          {d.positions.length > 0 && (
            <div className="panel" style={{ marginTop: 14 }}>
              <h2>Open positions <small>As of {dayShort(d.range.to > todayET() ? todayET() : d.range.to)}</small></h2>
              <div className="scroll">
                <table>
                  <thead><tr><th className="l">Person</th><th className="l">Contract</th><th className="l">Side</th><th>Contracts</th><th>Average entry</th><th>Cost basis</th><th>Market value (IBKR)</th></tr></thead>
                  <tbody>{d.positions.map(p => (
                    <tr key={p.key}><td className="l"><span className={`chip ${personClass(p.account)}`}>{p.owner}</span></td><td className="l">{p.contract}</td><td className="l">{p.direction}</td>
                      <td>{p.quantity}</td><td>{price(p.avgEntry)}</td><td>{money(p.costBasis, { sign: false })}</td><td>{money(p.markValue, { sign: false })}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}

/** Combined figures cover two accounts, so the band thresholds double for them. */
const scaled = (b: BandSettings, k: number): BandSettings => ({ scratch: b.scratch * k, big: b.big * k });

function SeriesTip({ active, payload, accounts }: { active?: boolean; payload?: { payload: Record<string, number | string> }[]; accounts: Figures[] }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="panel" style={{ padding: 10, fontSize: 13 }}>
      <b>{dayShort(String(row.date))}</b>
      <div className="kv" style={{ marginTop: 6 }}>
        {accounts.filter(a => row[a.account] !== undefined).map(a => <Fragment key={a.account}><span>{a.owner}</span><b>{money(Number(row[a.account]))}</b></Fragment>)}
        <span>Total</span><b>{money(Number(row.total))}</b>
      </div>
    </div>
  );
}
