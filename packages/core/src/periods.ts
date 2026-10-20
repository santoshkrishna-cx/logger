export type Period = "day" | "week" | "month" | "year";

const pad = (n: number) => String(n).padStart(2, "0");
const toIso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const fromIso = (s: string) => new Date(s + "T00:00:00Z");

export function addDays(iso: string, n: number) { const d = fromIso(iso); d.setUTCDate(d.getUTCDate() + n); return toIso(d); }
export function weekday(iso: string) { return fromIso(iso).getUTCDay(); } // 0 Sun .. 6 Sat

/** Inclusive date range for a period containing `date`. Weeks run Monday to Sunday. */
export function periodRange(period: Period, date: string): { from: string; to: string } {
  const d = fromIso(date);
  if (period === "day") return { from: date, to: date };
  if (period === "week") {
    const dow = (d.getUTCDay() + 6) % 7; // Mon = 0
    const from = addDays(date, -dow);
    return { from, to: addDays(from, 6) };
  }
  if (period === "month") {
    const from = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-01`;
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    return { from, to: toIso(end) };
  }
  return { from: `${d.getUTCFullYear()}-01-01`, to: `${d.getUTCFullYear()}-12-31` };
}

/** Shifts a date by one period (for previous / next buttons). */
export function shiftPeriod(period: Period, date: string, by: number): string {
  if (period === "day") {
    let d = addDays(date, by);
    while (weekday(d) === 0 || weekday(d) === 6) d = addDays(d, by);
    return d;
  }
  if (period === "week") return addDays(date, 7 * by);
  const x = fromIso(date);
  if (period === "month") return toIso(new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + by, 1)));
  return `${x.getUTCFullYear() + by}-01-01`;
}

/** Today's date in New York, where the market keeps time. */
export function todayET(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return parts; // en-CA formats as YYYY-MM-DD
}
