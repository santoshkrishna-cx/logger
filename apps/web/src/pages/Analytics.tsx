import { useQuery } from "@tanstack/react-query";
import { addDays, periodRange, pnlBand, todayET, type Analysis, type BandSettings, type Bucket } from "@tradelog/core";
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, qs } from "../api";
import { BandLegend } from "../components/BandLegend";
import { Pnl } from "../components/Pnl";
import { ScopeSwitch } from "../components/ScopeSwitch";
import { dayShort, money, pct } from "../format";
import { useParam, useScope } from "../hooks";

type Result = Omit<Analysis, "lossLimit"> & { bands: BandSettings; lossLimit: (Analysis["lossLimit"][number] & { owner: string })[] };
type Preset = "week" | "month" | "quarter" | "year" | "all";

function presetRange(p: Preset): { from?: string; to?: string } {
  const today = todayET();
  if (p === "all") return {};
  if (p === "quarter") return { from: addDays(today, -90), to: today };
  const r = periodRange(p, today);
  return { from: r.from, to: r.to };
}

export function AnalyticsPage() {
  const [preset, setPreset] = useParam<Preset>("range", "month");
  const [scope, setScope] = useScope();
  const range = presetRange(preset);
  const q = useQuery({ queryKey: ["analytics", preset, scope], queryFn: () => api.get<Result>("/api/analytics" + qs({ ...range, account: scope })) });
  const a = q.data;
  const s = a?.summary;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Analytics</h1>
          <p className="lede">Where the money comes from, and where it leaks. Removed trades are left out; only closed trades with realized P&amp;L count.</p>
        </div>
        <div className="controls">
          <div className="seg" role="group" aria-label="Range">
            {([["week", "This week"], ["month", "This month"], ["quarter", "Last 90 days"], ["year", "This year"], ["all", "All time"]] as [Preset, string][]).map(([v, l]) =>
              <button key={v} aria-pressed={preset === v} onClick={() => setPreset(v)}>{l}</button>)}
          </div>
          <ScopeSwitch value={scope} onChange={setScope} />
        </div>
      </div>
      {q.isError && <p className="error">{(q.error as Error).message}</p>}
      {a && s && (s.trades === 0 ? <p className="muted">No closed trades in this range yet.</p> : (
        <>
          <div style={{ marginBottom: 14 }}><BandLegend bands={a.bands} /></div>
          <div className="grid cols-4">
            <div className="panel figure"><div className="k">Net realized</div><div className="v"><Pnl value={s.net} /></div><div className="sub">{s.trades} trades, win rate {pct(s.winRate)}</div></div>
            <div className="panel figure"><div className="k">Average win and loss</div><div className="v" style={{ fontSize: 20 }}><Pnl value={s.avgWin} bands={a.bands} /> / <Pnl value={s.avgLoss} bands={a.bands} /></div><div className="sub">Profit factor {s.profitFactor ?? "—"}, expectancy {money(s.expectancy)} a trade</div></div>
            <div className="panel figure"><div className="k">Worst drawdown</div><div className="v"><Pnl value={s.maxDrawdown} bands={a.bands} /></div><div className="sub">Longest losing streak: {s.longestLosingStreak} trades</div></div>
            <div className="panel figure"><div className="k">Best and worst day</div><div className="v" style={{ fontSize: 20 }}><Pnl value={s.bestDay?.net} bands={a.bands} /> / <Pnl value={s.worstDay?.net} bands={a.bands} /></div><div className="sub">{s.bestDay && `${dayShort(s.bestDay.date)} and ${dayShort(s.worstDay!.date)}`}. Commissions {money(s.commissions, { sign: false })}</div></div>
          </div>

          <div className="grid cols-2" style={{ marginTop: 14 }}>
            <div className="panel">
              <h2>Where it leaks <small>Losing patterns with at least 3 trades, worst first</small></h2>
              {a.leaks.length ? a.leaks.map((l, i) => (
                <div className="callout" key={i}><b>{l.dimension}: {l.label}, {money(l.net)}</b><span>{l.date ? `${dayShort(l.date)}, ${l.trades} trade${l.trades === 1 ? "" : "s"} after the limit was hit` : `${l.trades} trades, win rate ${pct(l.winRate)}, average ${money(l.avg)} a trade`}</span></div>
              )) : <div className="callout good"><b>No losing pattern stands out yet</b><span>Keep rating trades; patterns appear once there are a few of each kind.</span></div>}
            </div>
            <div className="panel">
              <h2>Day of the week</h2>
              <div className="grid cols-2" style={{ marginBottom: 10 }}>
                <div><div className="muted" style={{ fontSize: 13 }}>Best</div><b>{a.bestWeekday?.label}</b> <Pnl value={a.bestWeekday?.net} bands={a.bands} /></div>
                <div><div className="muted" style={{ fontSize: 13 }}>Worst</div><b>{a.worstWeekday?.label}</b> <Pnl value={a.worstWeekday?.net} bands={a.bands} /></div>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={a.byWeekday} margin={{ left: 8, right: 8 }}>
                  <CartesianGrid stroke="var(--line)" vertical={false} />
                  <XAxis dataKey="label" stroke="var(--muted)" fontSize={12} tickFormatter={v => String(v).slice(0, 3)} />
                  <YAxis stroke="var(--muted)" fontSize={12} tickFormatter={v => money(v)} width={70} />
                  <ReferenceLine y={0} stroke="var(--line-strong)" />
                  <Tooltip formatter={(v: number) => money(v)} contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)" }} />
                  <Bar dataKey="net" name="Net" radius={[3, 3, 0, 0]}>{a.byWeekday.map(b => <Cell key={b.key} fill={bandColor(b.net, a.bands)} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel" style={{ marginTop: 14 }}>
            <h2>Equity curve <small>Cumulative realized P&amp;L, with drawdown from the high</small></h2>
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={a.daily} margin={{ left: 8, right: 16, top: 8 }}>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis dataKey="date" stroke="var(--muted)" fontSize={12} tickFormatter={v => dayShort(v)} minTickGap={24} />
                <YAxis stroke="var(--muted)" fontSize={12} tickFormatter={v => money(v)} width={72} />
                <ReferenceLine y={0} stroke="var(--line-strong)" />
                <Tooltip formatter={(v: number) => money(v)} labelFormatter={l => dayShort(String(l))} contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)" }} />
                <Area dataKey="drawdown" name="Drawdown" fill="var(--loss-bg)" stroke="var(--loss)" strokeWidth={1} />
                <Line dataKey="cumulative" name="Cumulative" stroke="var(--accent)" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="grid cols-2" style={{ marginTop: 14 }}>
            <SymbolTable title="Best returning symbols" rows={a.bestSymbols} bands={a.bands} empty="No winning symbols in this range." />
            <SymbolTable title="Worst returning symbols" rows={a.worstSymbols} bands={a.bands} empty="No losing symbols in this range." />
          </div>

          <div className="grid cols-2" style={{ marginTop: 14 }}>
            <BucketTable title="Entry time (ET)" rows={a.byHour} bands={a.bands} />
            <BucketTable title="Time in trade" rows={a.byHold} bands={a.bands} />
            <BucketTable title="Trade number of the day" sub="Does the edge fade as the day goes on?" rows={a.byTradeOfDay} bands={a.bands} />
            <BucketTable title="Re-entries after a loss" sub="Revenge trades show up here" rows={a.afterLoss} bands={a.bands} />
            <BucketTable title="Discipline" rows={a.byDiscipline} bands={a.bands} />
            <BucketTable title="Cost of each broken rule" rows={a.byBrokenRule} bands={a.bands} empty="No rule has been rated broken in this range." />
            <BucketTable title="Size" rows={a.bySize} bands={a.bands} />
            <BucketTable title="Expiry" rows={a.byExpiry} bands={a.bands} />
            <BucketTable title="Calls and puts" rows={a.byRight} bands={a.bands} />
            <BucketTable title="Long and short" rows={a.byDirection} bands={a.bands} />
          </div>

          <div className="grid cols-2" style={{ marginTop: 14 }}>
            <div className="panel">
              <h2>Daily loss limit <small>Set the limit for each of you in Settings</small></h2>
              {a.lossLimit.length ? (
                <table><thead><tr><th className="l">Day</th><th className="l">Person</th><th>Hit at</th><th>Trades after</th><th>P&amp;L after</th></tr></thead>
                  <tbody>{a.lossLimit.map(l => <tr key={l.account + l.date}><td className="l">{dayShort(l.date)}</td><td className="l">{l.owner}</td><td>{l.breachedAt.slice(11, 16)}</td><td>{l.tradesAfter}</td><td><Pnl value={l.netAfter} bands={a.bands} /></td></tr>)}</tbody></table>
              ) : <p className="muted">No day hit the loss limit, or no limit is set yet.</p>}
            </div>
            <div className="panel">
              <h2>Lessons reviewed together</h2>
              <div className="figure"><div className="v" style={{ color: a.lessons.completionRate === 100 || a.lessons.completionRate === null ? "var(--win)" : "var(--loss)" }}>{a.lessons.completionRate === null ? "—" : `${a.lessons.completionRate}%`}</div>
                <div className="sub">{a.lessons.completed} of {a.lessons.total} lessons signed off by both of you. The target is 100%.</div></div>
            </div>
          </div>
        </>
      ))}
    </main>
  );
}

const bandColor = (v: number, b: BandSettings) => { const x = pnlBand(v, b); return `var(--${x === "none" ? "scratch" : x})`; };

function BucketTable({ title, sub, rows, bands, empty }: { title: string; sub?: string; rows: Bucket[]; bands: BandSettings; empty?: string }) {
  const max = Math.max(1, ...rows.map(r => Math.abs(r.net)));
  return (
    <div className="panel">
      <h2>{title} {sub && <small>{sub}</small>}</h2>
      {rows.length ? (
        <div className="scroll"><table>
          <thead><tr><th className="l">Bucket</th><th>Trades</th><th>Win rate</th><th>Average</th><th>Net</th><th aria-hidden="true"></th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.key}>
              <td className="l" style={{ whiteSpace: "normal" }}>{r.label}</td><td>{r.trades}</td><td>{pct(r.winRate)}</td>
              <td><Pnl value={r.avg} bands={bands} /></td><td><Pnl value={r.net} bands={bands} /></td>
              <td style={{ width: 90 }} aria-hidden="true"><div className="bar"><i style={{ width: `${(Math.abs(r.net) / max) * 100}%`, background: bandColor(r.net, bands) }} /></div></td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <p className="muted">{empty ?? "Nothing in this range."}</p>}
    </div>
  );
}

function SymbolTable({ title, rows, bands, empty }: { title: string; rows: Bucket[]; bands: BandSettings; empty: string }) {
  return (
    <div className="panel">
      <h2>{title}</h2>
      {rows.length ? (
        <table><thead><tr><th className="l">Symbol</th><th>Trades</th><th>Win rate</th><th>Net</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.key}><td className="l"><b>{r.label}</b></td><td>{r.trades}</td><td>{pct(r.winRate)}</td><td><Pnl value={r.net} bands={bands} /></td></tr>)}</tbody></table>
      ) : <p className="muted">{empty}</p>}
    </div>
  );
}
