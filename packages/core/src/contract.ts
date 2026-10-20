import type { Contract } from "./types.js";
import { MONTHS } from "./util.js";

const MON_UP = MONTHS.map(m => m.toUpperCase());

/** Parses IBKR option descriptions like "SPXW 20OCT26 5910 C". Anything else keeps its description. */
export function parseContract(description: string): Contract {
  const m = /^(\S+)\s+(\d{1,2})([A-Z]{3})(\d{2})\s+([\d.]+)\s+([CP])$/.exec((description || "").trim());
  if (!m) return { name: description || "", expiry: null, right: null, strike: null };
  const mi = MON_UP.indexOf(m[3]);
  const expiry = mi < 0 ? null : `20${m[4]}-${String(mi + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return {
    name: `${m[1]} ${Number(m[2])} ${MONTHS[mi] ?? m[3]} ${m[5]}${m[6]}`,
    expiry,
    right: m[6] as "C" | "P",
    strike: Number(m[5])
  };
}
