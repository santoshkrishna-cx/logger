export const r2 = (n: number) => Math.round(n * 100) / 100;
export const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const safeKey = (s: string) => s.replace(/[^A-Za-z0-9_\-.~:@+]/g, "-").slice(0, 180);
export function minutesBetween(a: string, b: string) {
  return Math.round((Date.parse(b + "Z") - Date.parse(a + "Z")) / 60000);
}
