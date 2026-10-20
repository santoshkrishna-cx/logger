import type { Discipline, RatingValue, Rule } from "@tradelog/core";

export function RuleStrip({ rules, ratings, discipline }: { rules: Rule[]; ratings: Record<string, RatingValue>; discipline: Discipline }) {
  const active = rules.filter(r => r.active);
  if (!active.length) return null;
  return (
    <span className="pips" aria-label={discipline.score === null ? "Rules not rated yet" : `Rules followed ${discipline.score}%`}>
      {active.map(r => {
        const v = ratings[r.id];
        const c = v === 2 ? "v2" : v === 1 ? "v1" : v === 0 ? "v0" : v === -1 ? "vn" : "";
        return <i key={r.id} className={`pip ${c}`} title={r.text} />;
      })}
      <span className="grade">{discipline.grade ?? ""}</span>
    </span>
  );
}
