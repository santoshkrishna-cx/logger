import { BAND_LABELS, MONTHS, type PnlBand } from "@logger/core";

export function money(n: number | null | undefined, opts: { sign?: boolean; cents?: boolean } = {}) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const { sign = true, cents = false } = opts;
  const a = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  if (!sign) return (n < 0 ? "−$" : "$") + a;
  if (!cents && Math.round(n) === 0) return "$0";
  return (n > 0 ? "+$" : n < 0 ? "−$" : "$") + a;
}
export const price = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toFixed(2));
export const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n}%`);
export const hhmm = (dt: string | null | undefined) => (dt ?? "").slice(11, 16);
export const bandLabel = (b: PnlBand) => BAND_LABELS[b];

export function dayLong(d: string) {
  return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
export function dayShort(d: string) {
  return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}
export function rangeLabel(period: string, from: string, to: string) {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [, tm, td] = to.split("-").map(Number);
  if (period === "day") return dayLong(from);
  if (period === "week") return `Week of ${MONTHS[fm - 1]} ${fd} to ${MONTHS[tm - 1]} ${td}, ${fy}`;
  if (period === "month") return `${new Date(Date.UTC(fy, fm - 1, 1)).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })} ${fy}`;
  return String(fy);
}
export const personClass = (account: string) => (account === "anilsub02" ? "p1" : "p2");
