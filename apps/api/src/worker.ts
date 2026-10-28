import cron from "node-cron";
import { config } from "./config.js";
import { queryFor, runSync, type SyncKind } from "./sync/runSync.js";

const tz = "America/New_York";
const log = (msg: string) => console.log(`[worker ${new Date().toISOString()}] ${msg}`);
const safe = (kind: SyncKind) => async () => {
  for (const src of config.flexSources) {
    if (!queryFor(src, kind)) continue;
    try {
      const r = await runSync(kind, "schedule", null, src);
      log(`${src.group} ${kind}: +${r.added} fills, ${r.upgraded} upgraded, +${r.cashAdded} cash txns`);
    } catch (e) { log(`${src.group} ${kind} failed: ${(e as Error).message}`); }
  }
};

// Same-day fills, every 15 minutes from 9:30 to 16:45 ET on weekdays (IBKR lags 5-10 minutes).
cron.schedule("*/15 9-16 * * 1-5", safe("trade-confirmation"), { timezone: tz });
// Prior day's official P&L, cash and positions, 06:00 ET Tuesday to Saturday.
cron.schedule("0 6 * * 2-6", safe("activity"), { timezone: tz });
// Deposits, withdrawals and internal transfers, daily at 06:10 ET, right after Activity.
cron.schedule("10 6 * * *", safe("cash"), { timezone: tz });

log("scheduled Trade Confirmation every 15 min in session, Activity at 06:00 ET, cash at 06:10 ET");
