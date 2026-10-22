import { useQuery } from "@tanstack/react-query";
import { addDays, pnlBand, todayET, weekday, type BandSettings } from "@logger/core";
import { Link } from "react-router-dom";
import { api, qs, type Scope } from "../api";
import { BandLegend } from "../components/BandLegend";
import { ScopeSwitch } from "../components/ScopeSwitch";
import { dayShort, money } from "../format";
import { useParam, useScope } from "../hooks";

interface Day { date: string; pnl: number; trades: number; pct: number | null }
interface Result { from: string; to: string; scope: Scope; bands: BandSettings; days: Day[] }
type View = "months" | "weeks";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const thisMonth = () => todayET().slice(0, 7); // YYYY-MM
const yn = (ym: string, i: 0 | 1) => Number(ym.slice(i ? 5 : 0, i ? 7 : 4));
const shiftMonth = (ym: string, n: number) => { const d = new Date(Date.UTC(yn(ym, 0), yn(ym, 1) - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
const daysInMonth = (ym: string) => new Date(Date.UTC(yn(ym, 0), yn(ym, 1), 0)).getUTCDate();
const monthLabel = (ym: string) => new Date(Date.UTC(yn(ym, 0), yn(ym, 1) - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const bandVar = (v: number, b: BandSettings) => { const x = pnlBand(v, b); return `var(--${x === "none" ? "scratch" : x})`; };

export function CalendarPage() {
  const [anchor, setAnchor] = useParam<string>("month", thisMonth());
  const [view, setView] = useParam<View>("view", "months");
  const [scope, setScope] = useScope();
  const months = [shiftMonth(anchor, -2), shiftMonth(anchor, -1), anchor];
  const range = { from: `${months[0]}-01`, to: `${anchor}-${String(daysInMonth(anchor)).padStart(2, "0")}` };
  const q = useQuery({ queryKey: ["calendar", range.from, range.to, scope], queryFn: () => api.get<Result>("/api/calendar" + qs({ ...range, account: scope })) });
  const byDate = new Map((q.data?.days ?? []).map(d => [d.date, d]));
  const bands = q.data?.bands ?? { scratch: 50, big: 500 };
  const toLog = (date: string) => `/log/${date}${scope && scope !== "all" ? `?who=${scope}` : ""}`;

  const DayCell = ({ date, dnum }: { date: string; dnum: number }) => {
    const d = byDate.get(date);
    return (
      <Link to={toLog(date)} className={`cal-cell ${d ? (d.pnl > 0 ? "up" : d.pnl < 0 ? "down" : "flat") : ""}`}
        style={d ? { borderColor: bandVar(d.pnl, bands) } : undefined}
        title={d ? `${d.trades} trade${d.trades === 1 ? "" : "s"} — open in Log` : "Open this day in the Log"}>
        <b className="cal-dnum">{dnum}</b>
        {d && <>
          <span className="cal-pnl">{money(d.pnl)}</span>
          {d.pct !== null && <span className="cal-pct">{d.pct > 0 ? "+" : ""}{d.pct}%</span>}
        </>}
      </Link>
    );
  };

  // Weeks (Sun–Sat) spanning the same three-month range, newest first.
  const weeks: string[][] = [];
  for (let cur = addDays(range.from, -weekday(range.from)); cur <= range.to; cur = addDays(cur, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(cur, i)));
  }
  weeks.reverse();
  const weekPnl = (days: string[]) => days.reduce((s, d) => s + (byDate.get(d)?.pnl ?? 0), 0);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Calendar</h1>
          <p className="lede">Each day’s realized P&amp;L in dollars and as a % of net deposited capital. Click a day to open it in the Log.</p>
        </div>
        <div className="controls">
          <div className="seg" role="group" aria-label="View">
            {(["months", "weeks"] as View[]).map(v => <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>{v === "months" ? "Months" : "Weeks"}</button>)}
          </div>
          <div className="seg" role="group" aria-label="Move through time">
            <button onClick={() => setAnchor(shiftMonth(anchor, -1))} aria-label="Earlier">‹</button>
            <button onClick={() => setAnchor(thisMonth())}>This month</button>
            <button onClick={() => setAnchor(shiftMonth(anchor, 1))} aria-label="Later">›</button>
          </div>
          <ScopeSwitch value={scope} onChange={setScope} />
        </div>
      </div>
      {q.isError && <p className="error">{(q.error as Error).message}</p>}
      <div style={{ marginBottom: 14 }}><BandLegend bands={bands} /></div>

      {view === "months" ? (
        <div className="cal-grid">
          {months.map(ym => {
            const lead = weekday(`${ym}-01`);
            const total = (q.data?.days ?? []).filter(d => d.date.startsWith(ym)).reduce((s, d) => s + d.pnl, 0);
            return (
              <section className="cal-month" key={ym}>
                <header className="cal-head"><h2>{monthLabel(ym)}</h2><span className={`cal-tot ${total > 0 ? "up" : total < 0 ? "down" : ""}`}>{money(total)}</span></header>
                <div className="cal-week">{WEEKDAYS.map(w => <span key={w}>{w}</span>)}</div>
                <div className="cal-days">
                  {Array.from({ length: lead }).map((_, i) => <span className="cal-cell empty" key={`e${i}`} />)}
                  {Array.from({ length: daysInMonth(ym) }).map((_, i) => <DayCell key={`${ym}-${i + 1}`} date={`${ym}-${String(i + 1).padStart(2, "0")}`} dnum={i + 1} />)}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <section className="cal-month">
          <div className="cal-weekrow cal-weekhead"><span className="cal-wlabel" /><span className="cal-wdays">{WEEKDAYS.map(w => <span key={w}>{w}</span>)}</span><span className="cal-wtot">Week</span></div>
          {weeks.map(days => {
            const total = weekPnl(days);
            return (
              <div className="cal-weekrow" key={days[0]}>
                <span className="cal-wlabel">{dayShort(days[0])} – {dayShort(days[6])}</span>
                <span className="cal-wdays">{days.map(d => <DayCell key={d} date={d} dnum={Number(d.slice(8, 10))} />)}</span>
                <span className={`cal-wtot ${total > 0 ? "up" : total < 0 ? "down" : ""}`}>{total ? money(total) : "—"}</span>
              </div>
            );
          })}
        </section>
      )}

      <p className="muted" style={{ marginTop: 14, fontSize: 13 }}>The % is the day’s P&amp;L over net deposited capital (an account’s most recent value is used until its funding history is imported).</p>
    </main>
  );
}
