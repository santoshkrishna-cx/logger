import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { BandSettings, RatingValue, Rule } from "@tradelog/core";
import { useEffect, useRef, useState } from "react";
import { api, type TradeView } from "../api";
import { dayShort, hhmm, money, personClass, price } from "../format";
import { Pnl } from "./Pnl";
import { RuleStrip } from "./RuleStrip";

const RATINGS: { v: RatingValue; label: string; sym: string; cls: string }[] = [
  { v: 2, label: "Followed", sym: "✓", cls: "r2" },
  { v: 1, label: "Partly", sym: "~", cls: "r1" },
  { v: 0, label: "Broken", sym: "✕", cls: "r0" },
  { v: -1, label: "Not applicable", sym: "n/a", cls: "rn" }
];
const REASONS = ["Duplicate fill", "Fat-finger order", "Wrong account", "Data error in report", "Test order", "Other"];

function useInvalidate() {
  const qc = useQueryClient();
  return () => ["log", "days", "lessons", "dashboard", "analytics", "rules"].forEach(k => qc.invalidateQueries({ queryKey: [k] }));
}

/** Text that saves after a pause in typing and when the box loses focus. */
function JournalText({ value, placeholder, onSave, className }: { value: string; placeholder: string; onSave: (v: string) => Promise<unknown>; className?: string }) {
  const [draft, setDraft] = useState(value);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<number>();
  const last = useRef(value);
  useEffect(() => { if (document.activeElement?.getAttribute("data-draft") !== "1") { setDraft(value); last.current = value; } }, [value]);
  const save = async (v: string) => {
    if (v === last.current) return;
    setState("saving");
    try { await onSave(v); last.current = v; setState("saved"); } catch { setState("error"); }
  };
  return (
    <>
      <textarea data-draft="1" className={className} value={draft} placeholder={placeholder}
        onChange={e => { setDraft(e.target.value); window.clearTimeout(timer.current); const v = e.target.value; timer.current = window.setTimeout(() => save(v), 900); }}
        onBlur={() => { window.clearTimeout(timer.current); save(draft); }} />
      <span className="muted" style={{ fontSize: 12 }} aria-live="polite">
        {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "error" ? "Not saved. Check your connection and try again." : ""}
      </span>
    </>
  );
}

export function TradeTicket({ t, rules, bands, me, day, defaultOpen = false }: { t: TradeView; rules: Rule[]; bands: BandSettings; me: string; day?: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [removing, setRemoving] = useState(false);
  const [reason, setReason] = useState(REASONS[0]);
  const [lessonText, setLessonText] = useState(t.journal.lessonText ?? "");
  const [ackNote, setAckNote] = useState(t.lessonReview?.traderNote ?? "");
  const [discussedOn, setDiscussedOn] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const invalidate = useInvalidate();
  const isOwner = me === t.account;
  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => { setError(null); invalidate(); },
    onError: (e: Error) => setError(e.message)
  });
  const call = (fn: () => Promise<unknown>) => run.mutate(fn);
  const base = `/api/trades/${encodeURIComponent(t.key)}`;

  const flags: JSX.Element[] = [];
  if (t.removed) flags.push(<span key="rm" className="flag">Removed: {t.journal.removedReason}</span>);
  if (t.discipline.broken.length) flags.push(<span key="br" className="flag warn">{t.discipline.broken.length} rule{t.discipline.broken.length > 1 ? "s" : ""} broken</span>);
  if (t.lesson) flags.push(t.lessonReviewComplete
    ? <span key="ls" className="flag done">Lesson reviewed together</span>
    : <span key="ls" className={`flag ${t.lessonReview?.overdue ? "warn" : "note"}`}>Lesson: needs {t.lessonReview?.waitingOn.map(w => (w === "trader" ? t.owner : t.reviewer)).join(" and ")}</span>);
  if (t.status === "closed" && !t.removed && !t.journal.review?.trim()) flags.push(<span key="rv" className="flag">Review pending</span>);
  if (t.carryIn) flags.push(<span key="ci" className="flag">Opened before import</span>);
  if (t.status === "closed" && t.realizedPnl === null) flags.push(<span key="pn" className="flag">P&amp;L arrives with the Activity report</span>);

  const showTime = t.carryIn || (day && t.openDate < day) ? (t.closeAt ?? t.openAt) : t.openAt;
  const hold = t.holdMinutes;

  return (
    <article className={`trade band-${t.band} ${t.removed ? "removed" : ""}`}>
      <button className="sum" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span className="t">{hhmm(showTime)}</span>
        <span className="a"><span className={`chip ${personClass(t.account)}`}>{t.owner}</span></span>
        <span className="ct">{t.contract.name}{t.zeroDte && <em>0DTE</em>}</span>
        <span className="q">{t.direction} {t.quantity}</span>
        <span className="px">{price(t.avgEntry)} → {t.avgExit !== null ? price(t.avgExit) : "…"}</span>
        <span className="pl">{t.status === "closed" ? <Pnl value={t.realizedPnl} band={t.band} pill /> : <span className="muted">{t.openQuantity} open</span>}</span>
        <span className="pp"><RuleStrip rules={rules} ratings={t.ratings} discipline={t.discipline} /></span>
        <span className="flags">{flags}</span>
        <span className="chev" aria-hidden="true">›</span>
      </button>
      {open && (
        <div className="body">
          <div className="machine">
            <p className="ttl">Executions from IBKR</p>
            <div className="scroll">
              <table>
                <thead><tr><th className="l">Time (ET)</th><th className="l">Side</th><th>Qty</th><th>Price</th><th>Net cash</th><th>Realized</th><th>Position</th><th>Cash after</th></tr></thead>
                <tbody>
                  {t.fills.map(f => (
                    <tr key={f.id}>
                      <td className="l">{f.tradeDate !== t.openDate ? dayShort(f.tradeDate) + " " : ""}{f.executedAt.slice(11, 19)}</td>
                      <td className={`l ${f.side === "BUY" ? "side-b" : "side-s"}`}>{f.side === "BUY" ? "Buy" : "Sell"}</td>
                      <td>{Math.abs(f.quantity)}</td><td>{price(f.price)}</td>
                      <td>{money(f.netCash, { sign: false, cents: true })}</td>
                      <td>{f.openClose === "C" ? <Pnl value={f.realizedPnl} bands={bands} cents /> : ""}</td>
                      <td>{f.positionAfter ?? "—"}</td>
                      <td>{f.cashAfter !== null ? money(f.cashAfter, { sign: false, cents: true }) : <span title="Change since the open; enter the opening cash to see the balance">{money(f.cashDelta, { cents: true })}*</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="facts">
              <div><Pnl value={t.realizedPnl} band={t.band} cents /><span>{t.status === "closed" ? "Realized P&L" : "Realized so far"}</span></div>
              <div><b>{price(t.avgEntry)}</b><span>Average {t.direction === "Long" ? "buy" : "sell"}</span></div>
              <div><b>{price(t.avgExit)}</b><span>Average {t.direction === "Long" ? "sell" : "buy"}</span></div>
              <div><b>{money(t.commission, { sign: false, cents: true })}</b><span>Commissions</span></div>
              <div><b>{hold === null ? (t.status === "open" ? "Open" : "—") : hold >= 1440 ? `${Math.round(hold / 1440)} d` : `${hold} min`}</b><span>Time in trade</span></div>
            </div>
          </div>

          <div className="human">
            <div className="note">
              <label><span>Why {t.owner} took it</span><span>{isOwner ? "You" : ""}</span></label>
              {isOwner && !t.removed
                ? <JournalText value={t.journal.rationale ?? ""} placeholder="Setup, entry trigger, target and stop" onSave={v => api.put(`${base}/rationale`, { text: v }).then(invalidate)} />
                : <div className={`ro ${t.journal.rationale ? "" : "placeholder"}`}>{t.journal.rationale || "Not written yet."}</div>}
            </div>

            <div className="note review">
              <label><span>{t.reviewer}’s review</span><span>{!isOwner ? "You" : ""}</span></label>
              {!isOwner && !t.removed
                ? <JournalText className="" value={t.journal.review ?? ""} placeholder="What went well, what to change next time" onSave={v => api.put(`${base}/review`, { text: v }).then(invalidate)} />
                : <div className={`ro ${t.journal.review ? "" : "placeholder"}`}>{t.journal.review || "Not written yet."}</div>}
            </div>

            {!t.removed && (
              <div className="lessonbox">
                {!t.lesson ? (
                  !isOwner ? (
                    <>
                      <b>Is there a lesson to carry forward?</b>
                      <input type="text" value={lessonText} onChange={e => setLessonText(e.target.value)} placeholder="The lesson in one line, for example: never move a stop once set" aria-label="Lesson" />
                      <div className="steps">
                        <button className="btn small" onClick={() => call(() => api.put(`${base}/lesson`, { lesson: true, lessonText }))} disabled={!lessonText.trim()}>Flag this lesson</button>
                        <button className="btn small ghost" onClick={() => call(() => api.put(`${base}/lesson`, { lesson: false }))} aria-pressed={t.journal.lesson === false}>{t.journal.lesson === false ? "Marked clean" : "No lesson, clean trade"}</button>
                      </div>
                    </>
                  ) : <span className="muted">{t.journal.lesson === false ? `${t.reviewer} marked this a clean trade.` : `${t.reviewer} decides whether this trade carries a lesson.`}</span>
                ) : (
                  <>
                    <b>Lesson: {t.journal.lessonText}</b>
                    <span className="muted">Every lesson is reviewed together. It closes when both of you sign off.</span>
                    <div className="kv">
                      <span>{t.owner}: what changes next time</span><b>{t.lessonReview?.traderAckAt ? "Signed" : "Waiting"}</b>
                      <span>{t.reviewer}: went over it together</span><b>{t.lessonReview?.reviewerAckAt ? `Signed, discussed ${t.lessonReview.discussedOn}` : "Waiting"}</b>
                    </div>
                    {t.lessonReview?.traderNote && <div className="ro">{t.lessonReview.traderNote}</div>}
                    {isOwner && !t.lessonReview?.traderAckAt && (
                      <>
                        <textarea value={ackNote} onChange={e => setAckNote(e.target.value)} placeholder="What I’ll do differently next time" aria-label="What you'll do differently" />
                        <div className="steps"><button className="btn small primary" disabled={ackNote.trim().length < 10} onClick={() => call(() => api.post(`${base}/lesson-review/ack`, { note: ackNote }))}>Sign off the lesson</button></div>
                      </>
                    )}
                    {!isOwner && !t.lessonReview?.reviewerAckAt && (
                      <div className="steps">
                        <label className="muted" htmlFor={`d-${t.key}`}>Discussed together on</label>
                        <input id={`d-${t.key}`} type="date" value={discussedOn} onChange={e => setDiscussedOn(e.target.value)} />
                        <button className="btn small primary" onClick={() => call(() => api.post(`${base}/lesson-review/ack`, { discussedOn }))}>Sign off the lesson</button>
                      </div>
                    )}
                    {!isOwner && !t.lessonReview?.traderAckAt && !t.lessonReview?.reviewerAckAt && (
                      <div className="steps"><button className="btn small ghost" onClick={() => call(() => api.put(`${base}/lesson`, { lesson: null }))}>Clear the lesson</button></div>
                    )}
                  </>
                )}
              </div>
            )}

            <div>
              <p className="ttl">Rules</p>
              {rules.filter(r => r.active).length ? rules.filter(r => r.active).map((r, i) => {
                const v = t.ratings[r.id];
                return (
                  <div className="rrow" key={r.id}>
                    <p>{i + 1}. {r.text}</p>
                    <span className="rate" role="group" aria-label={`Rule ${i + 1}`}>
                      {RATINGS.map(o => (
                        <button key={o.v} className={o.cls} aria-pressed={v === o.v} title={o.label} aria-label={o.label} disabled={t.removed}
                          onClick={() => call(() => api.put(`${base}/ratings/${r.id}`, { value: v === o.v ? null : o.v }))}>{o.sym}</button>
                      ))}
                    </span>
                  </div>
                );
              }) : <p className="muted">No active rules. Add them on the Rules page.</p>}
            </div>

            {error && <p className="error" role="alert">{error}</p>}
            <div className="foot">
              {t.removed ? (
                <><span>Removed as erroneous: {t.journal.removedReason}</span><button className="btn small" onClick={() => call(() => api.post(`${base}/restore`))}>Put back in the log</button></>
              ) : removing ? (
                <span className="steps" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <label htmlFor={`rm-${t.key}`}>Why remove it?</label>
                  <select id={`rm-${t.key}`} value={reason} onChange={e => setReason(e.target.value)}>{REASONS.map(r => <option key={r}>{r}</option>)}</select>
                  <button className="btn small danger" onClick={() => { call(() => api.post(`${base}/remove`, { reason })); setRemoving(false); }}>Remove from the log</button>
                  <button className="btn small ghost" onClick={() => setRemoving(false)}>Keep it</button>
                </span>
              ) : (
                <><span>{t.discipline.score !== null ? `Rules followed ${t.discipline.score}% (grade ${t.discipline.grade})` : "Not rated yet"}</span><button className="btn small ghost" onClick={() => setRemoving(true)}>Remove as erroneous</button></>
              )}
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
