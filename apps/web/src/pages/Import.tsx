import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, type Me } from "../api";
import { useLayout } from "../components/Layout";
import { dayShort } from "../format";

interface Preview {
  kind: string; committed: boolean; added: number; upgraded: number;
  accounts: { account: string; newFills: number; alreadyLogged: number; willUpgrade: number; from: string; to: string }[];
  unmatched: { ibkrAccount: string; alias: string; fills: number }[];
}
interface Runs { configured: { token: boolean; tradeConfirmation: boolean; activity: boolean }; runs: { id: string; kind: string; trigger: string; started_at: string; status: string; fills_added: number; fills_upgraded: number; error: string | null }[] }

const KIND: Record<string, string> = { activity: "Activity report", "trade-confirmation": "Trade Confirmation report", file: "File import", unknown: "Report" };

export function ImportPage() {
  const { me } = useLayout();
  const qc = useQueryClient();
  const [text, setText] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const runs = useQuery({ queryKey: ["sync"], queryFn: () => api.get<Runs>("/api/sync/runs") });
  const refresh = () => ["log", "days", "dashboard", "analytics", "lessons", "sync"].forEach(k => qc.invalidateQueries({ queryKey: [k] }));

  const read = async (file: File) => {
    setError(null); setMessage(null); setPreview(null); setMapping({});
    const t = await file.text();
    setText(t);
    try { setPreview(await api.upload<Preview>("/api/imports?commit=false", t)); } catch (e) { setError((e as Error).message); }
  };
  const commit = useMutation({
    mutationFn: () => api.upload<Preview>(`/api/imports?commit=true&mapping=${encodeURIComponent(JSON.stringify(mapping))}`, text!),
    onSuccess: r => { setMessage(`Imported ${r.added} execution${r.added === 1 ? "" : "s"}${r.upgraded ? ` and filled in IBKR P&L on ${r.upgraded}` : ""}.`); setPreview(null); setText(null); refresh(); },
    onError: (e: Error) => setError(e.message)
  });
  const sync = useMutation({
    mutationFn: (kind: string) => api.post<Preview>("/api/sync/run", { kind }),
    onSuccess: r => { setMessage(`Sync finished: ${r.added} new, ${r.upgraded} upgraded.`); refresh(); },
    onError: (e: Error) => { setError(e.message); refresh(); }
  });
  const owner = (code: string) => me.accounts.find((a: Me["accounts"][number]) => a.code === code)?.ownerName ?? code;
  const cfg = runs.data?.configured;

  return (
    <main className="page" style={{ maxWidth: 980 }}>
      <h1>Import</h1>
      <p className="lede">Trades arrive on their own once the IBKR sync is set up. Use a file import to backfill history or when the sync is down.</p>

      <div className="grid cols-2" style={{ marginTop: 18 }}>
        <div className="panel">
          <h2>IBKR sync</h2>
          {cfg && !(cfg.token && cfg.tradeConfirmation && cfg.activity) && (
            <p className="error">The sync isn’t fully set up: {[!cfg.token && "Flex token", !cfg.tradeConfirmation && "Trade Confirmation query ID", !cfg.activity && "Activity query ID"].filter(Boolean).join(", ")} missing in the server environment.</p>
          )}
          <p className="muted" style={{ fontSize: 14 }}>Trade Confirmation runs every 15 minutes in the session. Activity runs at 6:00 ET and fills in IBKR’s realized P&amp;L, opening cash and account value.</p>
          <div className="controls">
            <button className="btn" disabled={sync.isPending || !cfg?.tradeConfirmation} onClick={() => sync.mutate("trade-confirmation")}>Sync today’s fills now</button>
            <button className="btn" disabled={sync.isPending || !cfg?.activity} onClick={() => sync.mutate("activity")}>Sync last Activity report</button>
          </div>
        </div>
        <div className="panel">
          <h2>Import a Flex file</h2>
          <label className="panel" style={{ display: "block", textAlign: "center", borderStyle: "dashed", background: "var(--surface-2)", cursor: "pointer" }}
            onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) read(f); }}>
            <input type="file" accept=".xml,.csv,.txt" style={{ display: "none" }} onChange={e => e.target.files?.[0] && read(e.target.files[0])} />
            <b>Drop an IBKR Flex report here</b><br /><span className="muted">or select a file (XML or CSV)</span>
          </label>
        </div>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {message && <p role="status" style={{ color: "var(--win)" }}>{message}</p>}

      {preview && (
        <div className="panel" style={{ marginTop: 14 }}>
          <h2>{KIND[preview.kind]} <small>Check before importing</small></h2>
          <table>
            <thead><tr><th className="l">Person</th><th className="l">Dates</th><th>New fills</th><th>P&amp;L to fill in</th><th>Already logged</th></tr></thead>
            <tbody>{preview.accounts.map(a => (
              <tr key={a.account}><td className="l">{owner(a.account)}</td><td className="l">{dayShort(a.from)}{a.to !== a.from ? ` to ${dayShort(a.to)}` : ""}</td><td>{a.newFills}</td><td>{a.willUpgrade}</td><td>{a.alreadyLogged}</td></tr>
            ))}</tbody>
          </table>
          {preview.unmatched.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <p>These IBKR accounts aren’t matched yet. Say whose they are once and Logger remembers.</p>
              {preview.unmatched.map(u => (
                <div key={u.ibkrAccount} className="controls" style={{ marginBottom: 6 }}>
                  <b style={{ minWidth: 120 }}>{u.ibkrAccount || u.alias}</b><span className="muted">{u.fills} fills</span>
                  <select value={mapping[u.ibkrAccount] ?? ""} onChange={e => setMapping(m => ({ ...m, [u.ibkrAccount]: e.target.value }))}>
                    <option value="">Skip these</option>
                    {me.accounts.map(a => <option key={a.code} value={a.code}>{a.ownerName} ({a.code})</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}
          <div className="controls" style={{ marginTop: 12, justifyContent: "flex-end" }}>
            <button className="btn ghost" onClick={() => { setPreview(null); setText(null); }}>Cancel</button>
            <button className="btn primary" disabled={commit.isPending} onClick={() => commit.mutate()}>Import executions</button>
          </div>
        </div>
      )}

      <div className="panel" style={{ marginTop: 14 }}>
        <h2>Recent imports and syncs</h2>
        {runs.data?.runs.length ? (
          <div className="scroll"><table>
            <thead><tr><th className="l">Started</th><th className="l">What</th><th className="l">How</th><th className="l">Result</th><th>New</th><th>Upgraded</th></tr></thead>
            <tbody>{runs.data.runs.map(r => (
              <tr key={r.id}>
                <td className="l">{new Date(r.started_at).toLocaleString()}</td><td className="l">{KIND[r.kind]}</td><td className="l">{r.trigger}</td>
                <td className="l" style={{ whiteSpace: "normal", color: r.status === "failed" ? "var(--loss)" : undefined }}>{r.status === "failed" ? r.error : r.error ?? r.status}</td>
                <td>{r.fills_added}</td><td>{r.fills_upgraded}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <p className="muted">Nothing imported yet.</p>}
      </div>
    </main>
  );
}
