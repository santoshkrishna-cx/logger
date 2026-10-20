import type { Discipline, PnlBand, BandSettings, RatingValue, Rule } from "../types.js";

/** Score = sum of ratings / (2 x rated rules). "Not applicable" (-1) and unrated rules don't count. */
export function discipline(ratings: Record<string, RatingValue | null | undefined>, rules: Rule[]): Discipline {
  let total = 0, rated = 0;
  const broken: string[] = [];
  for (const r of rules) {
    if (!r.active) continue;
    const v = ratings[r.id];
    if (v === undefined || v === null || v === -1) continue;
    total += v; rated++;
    if (v === 0) broken.push(r.id);
  }
  if (!rated) return { score: null, grade: null, rated: 0, broken };
  const score = Math.round((total / (2 * rated)) * 100);
  const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 50 ? "C" : "F";
  return { score, grade, rated, broken };
}

export const DEFAULT_BANDS: BandSettings = { scratch: 50, big: 500 };

/** Five-band colour scale for P&L. Always shown with a sign and a label, never colour alone. */
export function pnlBand(value: number | null | undefined, bands: BandSettings = DEFAULT_BANDS): PnlBand {
  if (value === null || value === undefined || Number.isNaN(value)) return "none";
  if (Math.abs(value) < bands.scratch) return "scratch";
  if (value >= bands.big) return "big-win";
  if (value > 0) return "win";
  if (value <= -bands.big) return "big-loss";
  return "loss";
}

export const BAND_LABELS: Record<PnlBand, string> = {
  "big-win": "Big win",
  win: "Win",
  scratch: "Scratch",
  loss: "Loss",
  "big-loss": "Big loss",
  none: "No P&L yet"
};
