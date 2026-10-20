/** Dev only: loads a sample Flex file and a few journal entries into a local database, and prints login cookies. */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { createHmac, randomUUID } from "node:crypto";
import { parseFlex } from "@tradelog/core";
import { config } from "../src/config.js";
import { pool, q } from "../src/db.js";
import { ingest } from "../src/services/ingest.js";
import { loadContext } from "../src/services/data.js";

const file = process.argv[2];
if (!file) { console.error("usage: tsx scripts/seed-demo.ts <flex.xml>"); process.exit(1); }
const sign = (sid: string) => "s:" + sid + "." + createHmac("sha256", config.sessionSecret).update(sid).digest("base64").replace(/=+$/, "");
const users: Record<string, string> = {};
const cookies: Record<string, string> = {};
for (const [email, account] of config.allowedUsers) {
  const [u] = await q<{ id: string }>("INSERT INTO users (email, account_code, name) VALUES ($1,$2,$3) ON CONFLICT (email) DO UPDATE SET account_code=EXCLUDED.account_code RETURNING id", [email, account, account === "anilsub02" ? "Santosh Krishna" : "Anil"]);
  users[account] = u.id;
  const sid = randomUUID();
  await q(`INSERT INTO "session" (sid, sess, expire) VALUES ($1,$2, now() + interval '7 days')`, [sid, JSON.stringify({ cookie: { originalMaxAge: 6048e5, httpOnly: true, path: "/" }, passport: { user: u.id } })]);
  cookies[account] = sign(sid);
}
const r = await ingest(parseFlex(readFileSync(file, "utf8")), "file", { commit: true });
console.error(`imported ${r.added} fills`);
const ctx = await loadContext();
const rules = ctx.rules;
const day = ctx.trades.filter(t => t.closeDate === "2026-10-20" || t.openDate === "2026-10-20");
for (const [i, t] of day.entries()) {
  const reviewer = t.account === "anilsub02" ? "anilsub01" : "anilsub02";
  await q("INSERT INTO journal (trade_key, account_code, rationale, rationale_by, rationale_at, review, review_by, review_at, lesson, lesson_text) VALUES ($1,$2,$3,$4,now(),$5,$6,now(),$7,$8) ON CONFLICT DO NOTHING",
    [t.key, t.account, i % 2 ? "Opening range break with breadth positive. First tranche at +$1, stop under the low." : "Fade of the overnight high; looked like a quick reclaim.",
     users[t.account], i === 1 ? null : (t.realizedPnl ?? 0) < 0 ? "Stop wasn't written down and you sat through the drop. Write the stop before the order goes in." : "Clean. Trailing the runner is what made this trade.",
     users[reviewer], i === 1 ? null : (t.realizedPnl ?? 0) < 0, (t.realizedPnl ?? 0) < 0 ? "Write the stop before the order goes in" : null]);
  if ((t.realizedPnl ?? 0) < 0 && i !== 1) await q("INSERT INTO lesson_reviews (trade_key) VALUES ($1) ON CONFLICT DO NOTHING", [t.key]);
  for (const [j, rule] of rules.entries()) {
    const v = (t.realizedPnl ?? 0) < 0 && (j === 0 || j === 3) ? 0 : j > 5 ? -1 : 2;
    await q("INSERT INTO rule_ratings (trade_key, rule_id, value, rated_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [t.key, rule.id, v, users[t.account]]);
  }
}
// Rate a spread of older trades so analytics has discipline data
for (const t of ctx.trades.filter(t => t.closeDate && t.closeDate < "2026-10-20")) {
  await q("INSERT INTO journal (trade_key, account_code) VALUES ($1,$2) ON CONFLICT DO NOTHING", [t.key, t.account]);
  const brokeStop = (t.realizedPnl ?? 0) < -300;
  await q("INSERT INTO rule_ratings (trade_key, rule_id, value, rated_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [t.key, rules[3].id, brokeStop ? 0 : 2, users[t.account]]);
  await q("INSERT INTO rule_ratings (trade_key, rule_id, value, rated_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING", [t.key, rules[0].id, 2, users[t.account]]);
}
await q(`UPDATE settings SET value='{"anilsub01": 800, "anilsub02": 800}' WHERE key='daily_loss_limit'`);
console.log(JSON.stringify(cookies));
await pool.end();
