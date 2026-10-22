import type { Scope } from "../api";
import { useMe } from "../hooks";

/** Filter by everyone, a group, a person, or a single account. Options come from /api/me. */
export function ScopeSwitch({ value, onChange }: { value: Scope; onChange: (s: Scope) => void }) {
  const { data: me } = useMe();
  if (!me) return null;
  const groupName = (code: string) => me.groups.find(g => g.code === code)?.name ?? code;
  const people = [...new Set(me.accounts.map(a => a.ownerName))];
  // "both" is the old default; show it as "all" so the control stays in sync.
  const current = value === "both" ? "all" : value;
  return (
    <select className="scope" aria-label="Whose trades" value={current} onChange={e => onChange(e.target.value)}>
      <option value="all">Everyone</option>
      {me.groups.length > 1 && (
        <optgroup label="Groups">
          {me.groups.map(g => <option key={g.code} value={`g:${g.code}`}>{g.name}</option>)}
        </optgroup>
      )}
      {people.length > 1 && (
        <optgroup label="People">
          {people.map(p => <option key={p} value={`p:${p}`}>{p}</option>)}
        </optgroup>
      )}
      <optgroup label="Accounts">
        {me.accounts.map(a => <option key={a.code} value={a.code}>{a.ownerName} — {groupName(a.groupCode)}</option>)}
      </optgroup>
    </select>
  );
}
