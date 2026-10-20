import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../api";
import { BandLegend } from "../components/BandLegend";
import { useLayout } from "../components/Layout";

interface Settings { pnlBands: { scratch: number; big: number }; dailyLossLimit: Record<string, number | null>; revengeWindowMinutes: number; lessonReviewDueDays: number }

export function SettingsPage() {
  const { me } = useLayout();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["settings"], queryFn: () => api.get<Settings>("/api/settings") });
  const [s, setS] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (q.data) setS(q.data); }, [q.data]);
  const save = useMutation({
    mutationFn: (body: Settings) => api.put<Settings>("/api/settings", body),
    onSuccess: () => { setSaved(true); qc.invalidateQueries(); setTimeout(() => setSaved(false), 2500); }
  });
  if (!s) return <main className="page muted">Loading settings…</main>;
  const num = (v: string) => (v === "" ? null : Number(v));

  return (
    <main className="page" style={{ maxWidth: 760 }}>
      <h1>Settings</h1>
      <p className="lede">These apply to both of you. Changes are recorded in the audit trail.</p>
      <div className="panel" style={{ marginTop: 18 }}>
        <h2>P&amp;L colours</h2>
        <div className="controls">
          <label>Scratch within ± $<input type="number" min={0} value={s.pnlBands.scratch} onChange={e => setS({ ...s, pnlBands: { ...s.pnlBands, scratch: Number(e.target.value) } })} style={{ width: 90 }} /></label>
          <label>Big win or loss at $<input type="number" min={1} value={s.pnlBands.big} onChange={e => setS({ ...s, pnlBands: { ...s.pnlBands, big: Number(e.target.value) } })} style={{ width: 90 }} /></label>
        </div>
        <div style={{ marginTop: 12 }}><BandLegend bands={s.pnlBands} /></div>
      </div>
      <div className="panel" style={{ marginTop: 14 }}>
        <h2>Daily loss limit <small>Used for rule 7 and the loss-limit check in Analytics</small></h2>
        <div className="controls">
          {me.accounts.map(a => (
            <label key={a.code}>{a.ownerName} $<input type="number" min={1} placeholder="Not set" value={s.dailyLossLimit[a.code] ?? ""} onChange={e => setS({ ...s, dailyLossLimit: { ...s.dailyLossLimit, [a.code]: num(e.target.value) } })} style={{ width: 110 }} /></label>
          ))}
        </div>
      </div>
      <div className="panel" style={{ marginTop: 14 }}>
        <h2>Review habits</h2>
        <div className="controls">
          <label>Re-entry within <input type="number" min={1} max={120} value={s.revengeWindowMinutes} onChange={e => setS({ ...s, revengeWindowMinutes: Number(e.target.value) })} style={{ width: 70 }} /> minutes of a loss counts as a revenge trade</label>
          <label>Lessons are overdue after <input type="number" min={1} max={30} value={s.lessonReviewDueDays} onChange={e => setS({ ...s, lessonReviewDueDays: Number(e.target.value) })} style={{ width: 60 }} /> days</label>
        </div>
      </div>
      <div className="controls" style={{ marginTop: 14 }}>
        <button className="btn primary" disabled={save.isPending} onClick={() => save.mutate({ ...s, dailyLossLimit: Object.fromEntries(Object.entries(s.dailyLossLimit).map(([k, v]) => [k, v || null])) })}>Save settings</button>
        {saved && <span role="status" style={{ color: "var(--win)" }}>Saved</span>}
        {save.isError && <span className="error">{(save.error as Error).message}</span>}
      </div>
    </main>
  );
}
