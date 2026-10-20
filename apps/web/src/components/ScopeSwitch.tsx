import type { Scope } from "../api";

export function ScopeSwitch({ value, onChange }: { value: Scope; onChange: (s: Scope) => void }) {
  const opts: [Scope, string][] = [["both", "Both"], ["anilsub02", "Santosh"], ["anilsub01", "Anil"]];
  return (
    <div className="seg" role="group" aria-label="Whose trades">
      {opts.map(([v, l]) => <button key={v} aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}
