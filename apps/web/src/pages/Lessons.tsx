import { useQuery } from "@tanstack/react-query";
import type { Rule } from "@logger/core";
import { api, qs, type TradeView } from "../api";
import { useLayout } from "../components/Layout";
import { TradeTicket } from "../components/TradeTicket";
import { dayShort } from "../format";
import { useParam } from "../hooks";

interface Lessons { total: number; completed: number; completionRate: number | null; waitingOnMe: number; overdue: number; trades: TradeView[] }

export function LessonsPage() {
  const { me } = useLayout();
  const [status, setStatus] = useParam<"open" | "all">("show", "open");
  const q = useQuery({ queryKey: ["lessons", status], queryFn: () => api.get<Lessons>("/api/lessons" + qs({ status })) });
  const rules = useQuery({ queryKey: ["rules"], queryFn: () => api.get<Rule[]>("/api/rules") });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.get<{ pnlBands: { scratch: number; big: number } }>("/api/settings") });
  const d = q.data;
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Lessons</h1>
          <p className="lede">Every trade with a lesson is reviewed together. The trader writes what changes next time; the reviewer confirms the day you went over it. Nothing closes until both have signed.</p>
        </div>
        <div className="seg" role="group" aria-label="Show">
          <button aria-pressed={status === "open"} onClick={() => setStatus("open")}>Still open</button>
          <button aria-pressed={status === "all"} onClick={() => setStatus("all")}>All lessons</button>
        </div>
      </div>
      {d && (
        <div className="grid cols-4" style={{ marginBottom: 18 }}>
          <div className="panel figure"><div className="k">Reviewed together</div><div className="v" style={{ color: d.completionRate === 100 || d.completionRate === null ? "var(--win)" : "var(--loss)" }}>{d.completionRate === null ? "—" : `${d.completionRate}%`}</div><div className="sub">Target is 100%</div></div>
          <div className="panel figure"><div className="k">Lessons logged</div><div className="v">{d.total}</div><div className="sub">{d.completed} closed</div></div>
          <div className="panel figure"><div className="k">Waiting on you</div><div className="v">{d.waitingOnMe}</div></div>
          <div className="panel figure"><div className="k">Overdue</div><div className="v" style={{ color: d.overdue ? "var(--loss)" : undefined }}>{d.overdue}</div><div className="sub">Open longer than the review window in Settings</div></div>
        </div>
      )}
      {d && !d.trades.length && <p className="muted">{status === "open" ? "Every lesson has been reviewed together. Nothing is waiting." : "No lessons logged yet. The reviewer flags one from a trade ticket."}</p>}
      {d && rules.data && settings.data && d.trades.map(t => (
        <div key={t.key} style={{ marginBottom: 6 }}>
          <span className="muted" style={{ fontSize: 13 }}>{dayShort(t.closeDate ?? t.openDate)}</span>
          <TradeTicket t={t} rules={rules.data} bands={settings.data.pnlBands} me={me.user.account} defaultOpen={status === "open"} />
        </div>
      ))}
    </main>
  );
}
