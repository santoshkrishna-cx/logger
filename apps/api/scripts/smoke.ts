/**
 * End-to-end smoke test against a real (throwaway) database.
 * Mints signed sessions for the two allowed users instead of going through Google,
 * imports the core test fixtures, and exercises the main endpoints.
 *   DATABASE_URL=... npm run smoke --workspace @tradelog/api
 * Never point this at production: it writes test data.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { createHmac, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { pool, q } from "../src/db.js";

const fixture = (n: string) => readFileSync(new URL(`../../../packages/core/test/fixtures/${n}`, import.meta.url), "utf8");
const sign = (sid: string) => "s:" + sid + "." + createHmac("sha256", config.sessionSecret).update(sid).digest("base64").replace(/=+$/, "");

async function sessionFor(email: string, account: string) {
  const [u] = await q<{ id: string }>(
    "INSERT INTO users (email, account_code) VALUES ($1,$2) ON CONFLICT (email) DO UPDATE SET account_code=EXCLUDED.account_code RETURNING id", [email, account]);
  const sid = randomUUID();
  const sess = { cookie: { originalMaxAge: 864e5, expires: new Date(Date.now() + 864e5).toISOString(), httpOnly: true, path: "/" }, passport: { user: u.id } };
  await q(`INSERT INTO "session" (sid, sess, expire) VALUES ($1,$2, now() + interval '1 day')`, [sid, JSON.stringify(sess)]);
  return `tradelog.sid=${encodeURIComponent(sign(sid))}`;
}

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + JSON.stringify(detail)}`);
  if (!ok) failures++;
};

const [santoshEmail] = [...config.allowedUsers.entries()].find(([, a]) => a === "anilsub02")!;
const [anilEmail] = [...config.allowedUsers.entries()].find(([, a]) => a === "anilsub01")!;
const santosh = await sessionFor(santoshEmail, "anilsub02");
const anil = await sessionFor(anilEmail, "anilsub01");

const server = createApp().listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const call = async (cookie: string | null, method: string, path: string, body?: unknown, raw = false) => {
  const res = await fetch(base + path, {
    method, headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": raw ? "text/plain" : "application/json" } : {}) },
    body: body === undefined ? undefined : raw ? String(body) : JSON.stringify(body)
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
};

try {
  check("unauthenticated requests are refused", (await call(null, "GET", "/api/me")).status === 401);
  const me = await call(santosh, "GET", "/api/me");
  check("signed-in user resolves to their account", me.json?.user?.account === "anilsub02", me.json);

  const preview = await call(santosh, "POST", "/api/imports?commit=false", fixture("activity.xml"), true);
  check("import preview counts new fills per account", preview.json?.accounts?.length === 2 && preview.json.accounts.every((a: any) => a.newFills > 0), preview.json);
  const imp = await call(santosh, "POST", "/api/imports?commit=true", fixture("activity.xml"), true);
  check("import writes 8 fills", imp.json?.added === 8, imp.json);
  const again = await call(santosh, "POST", "/api/imports?commit=true", fixture("activity.xml"), true);
  check("re-import adds nothing", again.json?.added === 0 && again.json?.upgraded === 0, again.json);

  const log = await call(anil, "GET", "/api/log?date=2026-10-20");
  check("day log has 2 round trips, 1 carry-in, 1 still open",
    log.json?.sections?.roundTrips?.length === 2 && log.json.sections.carriedIn.length === 1 && log.json.sections.stillOpen.length === 1, log.json?.sections && Object.fromEntries(Object.entries(log.json.sections).map(([k, v]: any) => [k, v.length])));
  const put = log.json.sections.roundTrips.find((t: any) => t.description.includes("5900 P"));
  check("cash after each fill uses IBKR starting cash", put.fills[0].cashAfter === 47850.4, put.fills[0]);

  check("trader cannot write their own review", (await call(santosh, "PUT", `/api/trades/${put.key}/review`, { text: "x" })).status === 403);
  check("reviewer cannot write the rationale", (await call(anil, "PUT", `/api/trades/${put.key}/rationale`, { text: "x" })).status === 403);
  check("trader writes rationale", (await call(santosh, "PUT", `/api/trades/${put.key}/rationale`, { text: "Rejection at VWAP, stop above 5905" })).status === 204);
  check("reviewer writes review", (await call(anil, "PUT", `/api/trades/${put.key}/review`, { text: "Stop was moved twice." })).status === 204);
  check("lesson needs a one-line lesson", (await call(anil, "PUT", `/api/trades/${put.key}/lesson`, { lesson: true })).status === 400);
  check("reviewer flags a lesson", (await call(anil, "PUT", `/api/trades/${put.key}/lesson`, { lesson: true, lessonText: "Never move a stop once set" })).status === 204);

  const rules = await call(santosh, "GET", "/api/rules");
  const stopRule = rules.json.find((r: any) => r.text.startsWith("Honor the stop"));
  check("rating a rule", (await call(santosh, "PUT", `/api/trades/${put.key}/ratings/${stopRule.id}`, { value: 0 })).status === 204);

  let lessons = await call(santosh, "GET", "/api/lessons");
  check("lesson review is open and waiting on both", lessons.json?.total === 1 && lessons.json.completionRate === 0 && lessons.json.trades[0].lessonReview.waitingOn.length === 2, lessons.json);
  check("trader sign-off needs a note", (await call(santosh, "POST", `/api/trades/${put.key}/lesson-review/ack`, {})).status === 400);
  await call(santosh, "POST", `/api/trades/${put.key}/lesson-review/ack`, { note: "I will leave the stop where I set it and size down instead." });
  check("reviewer sign-off needs the discussion date", (await call(anil, "POST", `/api/trades/${put.key}/lesson-review/ack`, {})).status === 400);
  await call(anil, "POST", `/api/trades/${put.key}/lesson-review/ack`, { discussedOn: "2026-10-20" });
  lessons = await call(santosh, "GET", "/api/lessons?status=all");
  check("lesson review completes at 100% once both sign", lessons.json?.completionRate === 100, lessons.json);
  check("a signed lesson can't be cleared", (await call(anil, "PUT", `/api/trades/${put.key}/lesson`, { lesson: false })).status === 409);

  const dash = await call(santosh, "GET", "/api/dashboard?period=day&date=2026-10-20");
  check("dashboard combines realized P&L for both", dash.json?.combined?.realized === 910.9, dash.json?.combined);
  check("dashboard drill-down has each person", dash.json?.byAccount?.length === 2 && dash.json.byAccount.find((a: any) => a.account === "anilsub01").realized === 718.7, dash.json?.byAccount?.map((a: any) => [a.account, a.realized]));
  check("dashboard cash and NAV", dash.json?.combined?.cash === 106275.8 && dash.json.combined.nav === 51071.4, dash.json?.combined);
  check("dashboard open position from MU runner", dash.json?.combined?.openContracts === 5 && dash.json.positions[0].markValue === 1550, dash.json?.positions);
  const santoshOnly = await call(santosh, "GET", "/api/dashboard?period=year&date=2026-10-20&account=anilsub02");
  check("dashboard scoped to Santosh", santoshOnly.json?.combined?.realized === 192.2, santoshOnly.json?.combined);

  const an = await call(anil, "GET", "/api/analytics");
  check("analytics best weekday and symbols", an.json?.bestWeekday?.label === "Tuesday" && an.json.bestSymbols.length > 0, { w: an.json?.bestWeekday, s: an.json?.bestSymbols });

  const fat = log.json.sections.roundTrips.find((t: any) => t.description.includes("5910 C"));
  await call(anil, "POST", `/api/trades/${fat.key}/remove`, { reason: "Duplicate fill" });
  const dash2 = await call(santosh, "GET", "/api/dashboard?period=day&date=2026-10-20");
  check("removed trade leaves the P&L", dash2.json?.combined?.realized === r(910.9 - 958.6), dash2.json?.combined?.realized);
  await call(anil, "POST", `/api/trades/${fat.key}/restore`);

  const tc = await call(santosh, "POST", "/api/imports?commit=true", fixture("trade-confirm.xml"), true);
  check("trade confirmation import", tc.json?.added === 2, tc.json);
  const next = fixture("trade-confirm.xml").replace(/TradeConfirm /g, "Trade ").replace(/execID=/g, "ibExecID=")
    .replace('code="O"', 'openCloseIndicator="O" fifoPnlRealized="0"').replace('code="C;P"', 'openCloseIndicator="C" fifoPnlRealized="775.4"');
  const up = await call(santosh, "POST", "/api/imports?commit=true", next, true);
  check("next-morning Activity report upgrades P&L instead of duplicating", up.json?.added === 0 && up.json?.upgraded >= 1, up.json);
  const day21 = await call(santosh, "GET", "/api/log?date=2026-10-21");
  check("upgraded trade shows IBKR realized P&L", day21.json?.sections?.roundTrips?.[0]?.realizedPnl === 775.4, day21.json?.sections?.roundTrips?.[0]?.realizedPnl);
} finally {
  server.close();
  await pool.end();
}
function r(n: number) { return Math.round(n * 100) / 100; }
console.log(failures ? `\n${failures} check(s) failed` : "\nAll smoke checks passed");
process.exit(failures ? 1 : 0);
