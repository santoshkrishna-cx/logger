import type { Me, Scope } from "./api";

/** Account codes a scope covers. "" | "all" -> everyone; "g:<code>" -> group; "p:<owner>" -> person; else one account. */
export function accountsInScope(scope: Scope, me: Me): string[] {
  const a = me.accounts;
  if (!scope || scope === "all" || scope === "both") return a.map(x => x.code);
  if (scope.startsWith("g:")) return a.filter(x => x.groupCode === scope.slice(2)).map(x => x.code);
  if (scope.startsWith("p:")) return a.filter(x => x.ownerName === scope.slice(2)).map(x => x.code);
  return a.filter(x => x.code === scope).map(x => x.code);
}

export function scopeLabel(scope: Scope, me: Me): string {
  if (!scope || scope === "all" || scope === "both") return "Everyone";
  if (scope.startsWith("g:")) return me.groups.find(g => g.code === scope.slice(2))?.name ?? scope.slice(2);
  if (scope.startsWith("p:")) return scope.slice(2);
  const acct = me.accounts.find(x => x.code === scope);
  if (!acct) return scope;
  const g = me.groups.find(x => x.code === acct.groupCode)?.name ?? acct.groupCode;
  return `${acct.ownerName} — ${g}`;
}

/** More than one account in scope means "combined" presentation. */
export const scopeIsCombined = (scope: Scope, me: Me) => accountsInScope(scope, me).length > 1;

/** True if this account code is part of the current scope. */
export const accountInScope = (scope: Scope, code: string, me: Me) => accountsInScope(scope, me).includes(code);
