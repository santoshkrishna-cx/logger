import type { BandSettings } from "@tradelog/core";
import { money } from "../format";

/** Explains the colour scale every P&L figure uses. */
export function BandLegend({ bands }: { bands: BandSettings }) {
  const items: [string, string, string][] = [
    ["big-win", "Big win", `${money(bands.big)} or more`],
    ["win", "Win", `${money(bands.scratch)} to ${money(bands.big)}`],
    ["scratch", "Scratch", `within ±$${bands.scratch}`],
    ["loss", "Loss", `${money(-bands.scratch)} to ${money(-bands.big)}`],
    ["big-loss", "Big loss", `${money(-bands.big)} or worse`]
  ];
  return (
    <div className="legend" role="list" aria-label="P&L colour scale">
      {items.map(([k, label, range]) => (
        <span className="sw" role="listitem" key={k}>
          <i style={{ background: `var(--${k})` }} aria-hidden="true" />
          <b style={{ color: `var(--${k})` }}>{label}</b> {range}
        </span>
      ))}
    </div>
  );
}
