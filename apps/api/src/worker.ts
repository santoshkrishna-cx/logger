import cron from "node-cron";
import { config } from "./config.js";
import { runSync } from "./sync/runSync.js";

const tz = "America/New_York";
const log = (msg: string) => console.log(`[worker ${new Date().toISOString()}] ${msg}`);
const safe = (kind: "trade-confirmation" | "activity") => async () => {
  for (const src of config.flexSources) {
    try {
      const r = await runSync(kind, "schedule", null, src);
      log(`${src.group} ${kind}: +${r.added} fills, ${r.upgraded} upgraded`);
    } catch (e) { log(`${src.group} ${kind} failed: ${(e as Error).message}`); }
  }
};

// Same-day fills, every 15 minutes from 9:30 to 16:45 ET on weekdays (IBKR lags 5-10 minutes).
cron.schedule("*/15 9-16 * * 1-5", safe("trade-confirmation"), { timezone: tz });
// Prior day's official P&L, cash and positions, 06:00 ET Tuesday to Saturday.
cron.schedule("0 6 * * 2-6", safe("activity"), { timezone: tz });

log("scheduled Trade Confirmation every 15 min in session and Activity at 06:00 ET");
