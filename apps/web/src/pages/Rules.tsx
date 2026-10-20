import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Rule } from "@tradelog/core";
import { useState } from "react";
import { api } from "../api";

type RuleRow = Rule & { timesBroken: number };

export function RulesPage() {
  const qc = useQueryClient();
  const rules = useQuery({ queryKey: ["rules"], queryFn: () => api.get<RuleRow[]>("/api/rules") });
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const done = { onSuccess: () => { setError(null); ["rules", "log", "analytics", "dashboard"].forEach(k => qc.invalidateQueries({ queryKey: [k] })); }, onError: (e: Error) => setError(e.message) };
  const add = useMutation({ mutationFn: (t: string) => api.post("/api/rules", { text: t }), ...done });
  const patch = useMutation({ mutationFn: ({ id, body }: { id: string; body: Partial<Rule> }) => api.patch(`/api/rules/${id}`, body), ...done });

  return (
    <main className="page" style={{ maxWidth: 920 }}>
      <h1>Trading rules</h1>
      <p className="lede">Every trade is rated against the active rules: followed, partly, broken or not applicable. Switching a rule off keeps its past ratings but leaves it out of new scores. Rules are never deleted.</p>
      <div style={{ marginTop: 18 }}>
        {rules.data?.map((r, i) => (
          <div key={r.id} className="panel" style={{ display: "grid", gridTemplateColumns: "28px minmax(0,1fr) 120px auto", gap: 12, alignItems: "center", marginBottom: 8, opacity: r.active ? 1 : 0.55 }}>
            <b className="muted" style={{ textAlign: "right" }}>{i + 1}</b>
            <input type="text" defaultValue={r.text} aria-label={`Rule ${i + 1}`} style={{ width: "100%", border: "1px solid transparent", background: "transparent", fontSize: 15 }}
              onBlur={e => e.target.value.trim() && e.target.value.trim() !== r.text && patch.mutate({ id: r.id, body: { text: e.target.value.trim() } })} />
            <span className="muted" style={{ fontSize: 13, textAlign: "right" }}>{r.timesBroken ? `Broken ${r.timesBroken} times` : "Never broken"}</span>
            <label style={{ fontSize: 14 }}><input type="checkbox" checked={r.active} onChange={e => patch.mutate({ id: r.id, body: { active: e.target.checked } })} /> Active</label>
          </div>
        ))}
      </div>
      <form style={{ display: "flex", gap: 8, marginTop: 12 }} onSubmit={e => { e.preventDefault(); if (text.trim()) { add.mutate(text.trim()); setText(""); } }}>
        <input type="text" value={text} onChange={e => setText(e.target.value)} placeholder="Add a rule, for example: no trades in the first 5 minutes" style={{ flex: 1 }} aria-label="New rule" />
        <button className="btn primary" type="submit" disabled={!text.trim()}>Add rule</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
    </main>
  );
}
