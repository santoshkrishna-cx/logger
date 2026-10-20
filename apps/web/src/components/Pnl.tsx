import { pnlBand, type BandSettings, type PnlBand } from "@tradelog/core";
import { bandLabel, money } from "../format";

/** P&L figure coloured by band, with its band named for screen readers and on hover. */
export function Pnl({ value, bands, band, pill, cents, className = "" }: { value: number | null | undefined; bands?: BandSettings; band?: PnlBand; pill?: boolean; cents?: boolean; className?: string }) {
  const b = band ?? pnlBand(value, bands);
  return (
    <span className={`pnl band-${b} ${pill ? "pill" : ""} ${className}`} title={bandLabel(b)} aria-label={`${money(value, { cents })}, ${bandLabel(b)}`}>
      {money(value, { cents })}
    </span>
  );
}
