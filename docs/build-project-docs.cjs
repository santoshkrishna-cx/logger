// Builds docs/Logger_Project_Docs.docx — the 7 founding documents (project-docs skill format).
// Run: node docs/build-project-docs.cjs
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, AlignmentType, WidthType,
  ShadingType, BorderStyle, LevelFormat, TableOfContents, PageOrientation, PageBreak, Footer, PageNumber
} = require("docx");

const FONT = "Calibri";
const PORTRAIT_W = 9360;   // US Letter, 1" margins
const LANDSCAPE_W = 13680; // US Letter landscape, 0.75" margins
const border = { style: BorderStyle.SINGLE, size: 4, color: "B7C1CD" };
const borders = { top: border, bottom: border, left: border, right: border };
let listInstance = 0;

const p = (text, opts = {}) => new Paragraph({ spacing: { after: 80 }, ...opts, children: [new TextRun({ text, font: FONT, size: 20, ...(opts.run || {}) })] });
const runs = (parts) => parts.map(x => (typeof x === "string" ? new TextRun({ text: x, font: FONT, size: 20 }) : new TextRun({ font: FONT, size: 20, ...x })));
const h1 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, spacing: { after: 120 }, children: [new TextRun({ text, font: FONT })] });
const h2 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 80 }, children: [new TextRun({ text, font: FONT })] });
const purpose = (text) => new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text, italics: true, font: FONT, size: 21, color: "5B6676" })] });

/** Cell content: string -> paragraph; array -> bullets; {ol:[...]} -> numbered list restarting at 1. */
function cellContent(v) {
  if (Array.isArray(v)) return v.map(t => new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 40 }, children: runs([t]) }));
  if (v && v.ol) { const inst = ++listInstance; return v.ol.map(t => new Paragraph({ numbering: { reference: "steps", level: 0, instance: inst }, spacing: { after: 40 }, children: runs([t]) })); }
  return String(v).split("\n").map(line => new Paragraph({ spacing: { after: 40 }, children: runs([line]) }));
}
function cell(v, width, { header = false, shade } = {}) {
  return new TableCell({
    borders, width: { size: width, type: WidthType.DXA },
    shading: header ? { fill: "16202E", type: ShadingType.CLEAR, color: "auto" } : shade ? { fill: shade, type: ShadingType.CLEAR, color: "auto" } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: header ? [new Paragraph({ children: [new TextRun({ text: v, bold: true, color: "FFFFFF", font: FONT, size: 19 })] })] : cellContent(v)
  });
}
function kv(rows, total = PORTRAIT_W) {
  const w = [Math.round(total * 0.26), total - Math.round(total * 0.26)];
  return new Table({
    width: { size: total, type: WidthType.DXA }, columnWidths: w,
    rows: [new TableRow({ tableHeader: true, children: [cell("Field", w[0], { header: true }), cell("Value", w[1], { header: true })] }),
      ...rows.map(([k, v]) => new TableRow({ children: [
        new TableCell({ borders, width: { size: w[0], type: WidthType.DXA }, shading: { fill: "EDF1F5", type: ShadingType.CLEAR, color: "auto" }, margins: { top: 60, bottom: 60, left: 100, right: 100 }, children: [new Paragraph({ children: [new TextRun({ text: k, bold: true, font: FONT, size: 20 })] })] }),
        cell(v, w[1])
      ] }))]
  });
}
function grid(headers, rows, fractions, total = PORTRAIT_W) {
  const sum = fractions.reduce((a, b) => a + b, 0);
  const w = fractions.map(f => Math.floor((f / sum) * total));
  w[w.length - 1] += total - w.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: total, type: WidthType.DXA }, columnWidths: w,
    rows: [new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(h, w[i], { header: true })) }),
      ...rows.map((r, ri) => new TableRow({ children: r.map((c, i) => cell(c, w[i], { shade: ri % 2 ? "F6F8FA" : undefined })) }))]
  });
}
const gap = () => new Paragraph({ spacing: { after: 120 }, children: [] });

// ---------------------------------------------------------------- 01 PRD
const prd = [
  h1("01 — PRD"),
  purpose("The north star — what we're building and for whom."),
  kv([
    ["App Name", "Logger"],
    ["Tagline", "A shared, rule-rated trade journal that turns every IBKR execution into a reviewed trade, so two traders can see which habits make money and which cost it."],
    ["Problem", "Santosh and Anil day-trade options (mostly 0DTE SPX/SPXW calls, plus MU, META, SNDK and others) in two IBKR sub-accounts. Reviews happen from TWS blotter screenshots: there is no shared record of why a trade was taken, what the other person thought of it, whether the rules held, or whether a lesson was actually discussed. Patterns that cost money (a bad weekday, late-day trades, revenge entries, moved stops) stay invisible."],
    ["Target User", "Two people only: Santosh (account anilsub02) and Anil (account anilsub01), friends who trade separately under one IBKR master account and review each other's trades. Both are active intraday traders who scale out of 10-lot entries and leave a runner; they want a daily review loop and hard numbers on discipline."],
    ["Core Features (Must Have)", [
      "Google sign-in restricted to exactly two Google accounts; no one else can sign in.",
      "Automatic pull of executions for both sub-accounts from IBKR (Trade Confirmation intraday, Activity next morning); manual Flex file import as fallback.",
      "Fills grouped into trades and logged per day, in time order: round trips, carry-ins closed that day, and positions still open at the close.",
      "Each trade shows buys and sells, average in and out, realized P&L, commissions, position after each fill and cash after each fill.",
      "Rationale written by the trader; review written by the other person.",
      "A shared rulebook; every trade rated per rule (followed, partly, broken, not applicable) with a 0–100% discipline score and grade.",
      "Lessons: the reviewer flags a lesson; it stays open until both people sign off (trader: what changes next time; reviewer: date discussed together). Target: 100% of lessons reviewed together.",
      "Erroneous trades (duplicate fill, fat-finger, wrong account, data error, test order) removed from P&L and stats with a reason; restorable; fills never deleted.",
      "Five-band colour scale for P&L (big win, win, scratch, loss, big loss) with a legend and configurable thresholds; colour always paired with sign and label.",
      "Dashboard: combined realized P&L, cash, IBKR account value and open position for the day, week, month and year, with previous-period comparison and drill-down to Santosh or Anil individually.",
      "Analytics: best and worst day of week, best and worst symbols, equity curve and drawdown, and failure-pattern breakdowns (entry time, time in trade, trade number of the day, re-entries after a loss, cost of each broken rule, size, expiry, calls vs puts, trading after the daily loss limit), with a ranked 'Where it leaks' list."
    ]],
    ["Nice to Have", [
      "Weekly summary email to both people (P&L, leaks, open lessons).",
      "Screenshot or chart image attached to a trade.",
      "Unrealized P&L on open positions intraday via the IBKR Client Portal API.",
      "Assignment and expiry records from the Activity report shown in the log.",
      "Setup tags (ORB, VWAP fade, etc.) with P&L by setup.",
      "Mobile push or Slack nudge when a lesson is waiting on you."
    ]],
    ["Out of Scope", [
      "Placing, modifying or cancelling orders; any money movement. Logger is read-only toward IBKR.",
      "Real-time streaming; IBKR report data lags 5–10 minutes, which suits a review tool.",
      "Tax lots, wash sales and 1099 reconciliation.",
      "Users beyond Santosh and Anil, sign-up, or public sharing.",
      "Personalized investment advice."
    ]],
    ["User Stories", [
      "As a trader, I want my executions to appear without retyping so that the log is complete and correct.",
      "As a trader, I want each scale-out grouped into one trade so that I review the decision, not the individual fills.",
      "As a trader, I want to write why I took a trade while it is fresh so that the review judges the plan, not just the outcome.",
      "As the reviewer, I want to comment on my partner's trade and flag a lesson so that mistakes are named once and not repeated.",
      "As either person, I want a flagged lesson to stay open until we have both signed off so that every lesson is actually discussed.",
      "As a trader, I want to rate each trade against our rules so that I can see what discipline is worth in dollars.",
      "As either person, I want to remove a fat-finger or duplicate trade with a reason so that it does not distort our numbers.",
      "As either person, I want a dashboard of combined P&L, cash, account value and positions by day, week, month and year so that I can see where we stand at a glance.",
      "As either person, I want to drill down from combined to just Santosh or just Anil so that I can compare our performance.",
      "As a trader, I want to see my best and worst weekdays, symbols and times of day so that I can cut what is not working."
    ]],
    ["Success Metrics", [
      "100% of trading days imported with no manual retyping within one week of launch.",
      "Rationale written on 90% or more of trades within 24 hours.",
      "Review written on 90% or more of the other person's trades within 48 hours.",
      "100% of lessons signed off by both people (the explicit target), none overdue more than 2 days.",
      "Rules rated on 90% or more of closed trades.",
      "Within one month, each person identifies and acts on at least one leak from Analytics."
    ]]
  ])
];

// ---------------------------------------------------------------- 02 TRD
const trd = [
  h1("02 — TRD"),
  purpose("The technical blueprint — locked-in stack decisions the agent uses across every file."),
  kv([
    ["Frontend", "React 18 + TypeScript + Vite 5; React Router 6; TanStack Query 5 for server state; Recharts for charts; plain CSS with design tokens (no CSS framework)."],
    ["Backend", "Node.js 20 + TypeScript + Express 4 (run with tsx); Zod request validation; separate node-cron worker process for the IBKR sync. Shared pure-TypeScript package @logger/core holds the Flex parser, trade builder, scoring and analytics used by both API and web."],
    ["Database", "PostgreSQL 16 via node-postgres (pg); plain SQL migrations applied by scripts/migrate.ts; sessions stored in Postgres (connect-pg-simple)."],
    ["Auth", "Google OAuth 2.0 via Passport (passport-google-oauth20). Server-side allow-list ALLOWED_USERS maps exactly two verified Google emails to their accounts; checked at sign-in and on every request. Google consent screen kept in Testing mode with only those two test users as a second lock. Cookie session: httpOnly, SameSite=Lax, Secure in production, 30-day expiry."],
    ["Hosting", "Docker Compose stack (Postgres, API, worker, nginx web) on one Linux server with a static IP for the IBKR token lock. TBD — which host: the existing OVH server, Azure, or a new VPS? TBD — which domain or subdomain will serve Logger?"],
    ["Third-party APIs", [
      "IBKR Flex Web Service — SendRequest/GetStatement for Trade Confirmation and Activity Flex queries — Free with IBKR account",
      "Google OAuth 2.0 / OpenID Connect — sign-in for the two users — Free",
      "Google Fonts — Schibsted Grotesk and Newsreader — Free"
    ]],
    ["Key Libraries", [
      "fast-xml-parser (Flex XML)", "passport, passport-google-oauth20, express-session, connect-pg-simple", "helmet", "zod", "node-cron",
      "@tanstack/react-query, react-router-dom, recharts", "vitest (unit tests)"
    ]],
    ["Environment Variables", [
      "PORT", "NODE_ENV", "DATABASE_URL", "SESSION_SECRET", "APP_ORIGIN",
      "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_CALLBACK_URL", "ALLOWED_USERS",
      "FLEX_TOKEN", "FLEX_TRADE_CONFIRM_QUERY_ID", "FLEX_ACTIVITY_QUERY_ID", "FLEX_BASE_URL", "POSTGRES_PASSWORD"
    ]],
    ["Constraints", [
      "Exactly two users; any other Google account is refused before a user row is created.",
      "Read-only toward IBKR: no order, transfer or account-settings call exists anywhere.",
      "IBKR Flex rate limit: 1 request per second and 10 per minute per token; worker polls at most every 15 minutes.",
      "Fills are written only by import or sync and never edited by people; journal data is separate and keyed by trade.",
      "Times are stored and shown in exchange time (America/New_York).",
      "Trades are derived from fills on read (no stored trade table), so re-imports and P&L upgrades never collide with reviews.",
      "Works on phone and desktop; light and dark themes; WCAG AA contrast.",
      "No paid services required."
    ]]
  ])
];

// ---------------------------------------------------------------- 03 App Flow
const flow = [
  h1("03 — App Flow"),
  purpose("Every page, every click, every navigation path — mapped before a single screen is built."),
  h2("Pages List"),
  grid(["Route", "Page Name", "Auth Required", "Purpose"], [
    ["/login", "Login", "No", "Sign in with Google; explains a refused account"],
    ["/auth/google, /auth/google/callback", "Google OAuth (server)", "No", "Starts and completes Google sign-in; enforces the allow-list"],
    ["/", "Dashboard", "Yes", "Combined and per-person P&L, cash, account value, open position, trades, rules followed, open lessons; day/week/month/year; drill-down"],
    ["/log, /log/:date", "Log", "Yes", "Trading days rail; one day's round trips, carry-ins, still-open and removed trades as expandable tickets"],
    ["(expanded ticket in Log and Lessons)", "Trade ticket", "Yes", "Executions with position and cash after each fill; rationale; review; lesson sign-off; rule ratings; remove or restore"],
    ["/lessons", "Lessons", "Yes", "Open and closed lessons, completion rate against the 100% target, waiting-on-you and overdue counts"],
    ["/analytics", "Analytics", "Yes", "Summary stats, leaks, weekday, equity curve, best/worst symbols, behavioural breakdowns, loss-limit breaches"],
    ["/rules", "Rules", "Yes", "Edit, add, switch off rules; times each rule was broken"],
    ["/import", "Import", "Yes", "IBKR sync status and manual run; Flex file drop with preview and U-number mapping; recent runs"],
    ["/settings", "Settings", "Yes", "P&L band thresholds, daily loss limit per person, revenge window, lesson overdue days"],
    ["* (any other)", "Not found", "Yes", "Points back to Dashboard and Log"]
  ], [2.2, 1.4, 1, 4]),
  gap(),
  kv([
    ["Navigation Type", "Top bar with brand, main nav (Dashboard, Log, Lessons with a waiting-on-you badge, Analytics, Rules, Import, Settings) and the signed-in person with Sign out. On phones the nav becomes one horizontally scrolling row and the day rail becomes horizontal chips."],
    ["First Screen", "A signed-out visitor sees /login with one 'Sign in with Google' button. A signed-in person lands on the Dashboard for today (Day view, Both)."],
    ["Auth Flow", "Login → Google account chooser → allow-list check → Dashboard (refused → /login?error=not-allowed)"],
    ["Core User Journey 1", { ol: [
      "Trader closes trades during the session; the sync pulls them within 15 minutes.",
      "Trader opens Log for today and expands each trade.",
      "Trader writes why they took it and rates each rule.",
      "Next morning the Activity sync fills in IBKR's realized P&L and opening cash.",
      "Outcome: the day is fully logged with the trader's side of every trade."
    ] }],
    ["Core User Journey 2", { ol: [
      "Reviewer opens Log, switches to the partner's trades, expands a trade.",
      "Reviewer writes the review.",
      "Reviewer either marks it a clean trade or writes the lesson in one line and flags it.",
      "Trader sees the Lessons badge, opens the lesson and writes what changes next time, then signs off.",
      "They discuss it; the reviewer picks the date and signs off.",
      "Outcome: the lesson closes and counts toward the 100% reviewed-together target."
    ] }],
    ["Core User Journey 3", { ol: [
      "Either person opens the Dashboard and picks Week, Month or Year.",
      "They read combined realized P&L, cash, account value and open position against the previous period.",
      "They select a person's row to drill down to that person alone, or a bar to open that day's log.",
      "They open Analytics, read 'Where it leaks', best and worst weekday and symbols.",
      "Outcome: one concrete change agreed (for example, no trades after the third of the day)."
    ] }],
    ["Core User Journey 4", { ol: [
      "A fat-finger or duplicate shows up in the log.",
      "Either person opens the ticket, chooses Remove as erroneous and picks the reason.",
      "The trade moves to the day's Removed list and leaves every figure.",
      "Outcome: numbers stay honest; the trade can be put back from the Removed list."
    ] }],
    ["Empty States", [
      "Log with no fills: 'No trades yet' with a button to import an IBKR report.",
      "Dashboard period with no closed trades: figures show $0 and the chart says no trades closed in this period.",
      "Lessons with none open: 'Every lesson has been reviewed together. Nothing is waiting.'",
      "Analytics with no closed trades in range: 'No closed trades in this range yet.'",
      "Rules empty: add-rule field (starter rules are seeded by migration 002)."
    ]],
    ["Error States", [
      "Google account not on the list: /login shows that Logger is private to Santosh and Anil.",
      "Unverified Google email: /login asks to verify with Google first.",
      "Session expired (401): redirect to /login.",
      "Writing someone else's side (403): inline message naming who writes it.",
      "Bad or empty Flex file: inline message saying what is missing (for example Trades at execution level).",
      "IBKR sync failure: run marked failed with IBKR's error on the Import page; next scheduled run retries.",
      "Server error: generic retry message; details in API logs.",
      "Unknown route: Not found page with links back."
    ]],
    ["Redirects", [
      "After login → /",
      "Refused sign-in → /login?error=not-allowed",
      "Any /api call without a session → 401 → /login",
      "After sign out → /login",
      "Dashboard bar selected → /log/:date",
      "Dashboard lessons figure selected → /lessons",
      "/log with no date → latest trading day"
    ]]
  ])
];

// ---------------------------------------------------------------- 04 UI/UX
const ui = [
  h1("04 — UI/UX Design Brief"),
  purpose("Visual language and interaction style — so the agent builds something cohesive, not a patchwork."),
  kv([
    ["Aesthetic", "A trader's working notebook on cool drafting-film paper: dense tabular figures, white trade tickets with a left edge coloured by P&L band, machine facts on the left and the two people's words on the right. Data in a grotesk, anything a person wrote in a serif, reviews on a pale highlighter yellow."],
    ["Primary Color", "#2A4D8F (navy ink; as built in the prototype — confirm)"],
    ["Background Color", "#EDF1F5 light; #10161F dark (as built — confirm)"],
    ["Text Color", "#16202E light; #E6EBF1 dark (as built — confirm)"],
    ["Accent / CTA Color", "#2A4D8F primary buttons. P&L bands (as built — confirm): big win #0B6B4F, win #1F8A5B, scratch #5B6676, loss #C2412D, big loss #8E1B10. Person colours: Santosh #2A4D8F, Anil #7A3E9D. Review highlight #FBF1D2."],
    ["Font", "Schibsted Grotesk (UI and all numbers, tabular figures); Newsreader (rationale, review, lesson text). System fallbacks."],
    ["Border Radius", "10px tickets and panels; 8px buttons and inputs; 5px chips."],
    ["Shadows", "One soft shadow on trade tickets only; panels are flat with a 1px border."],
    ["Dark/Light Mode", "Follows the device setting; both themes fully specified with tokens."],
    ["Reference Apps", "Linear, Stripe Dashboard, TradeZella, Tradervue"],
    ["Mobile", "Fully responsive down to 380px: nav scrolls in one row, day rail becomes chips, trade summary wraps to four lines, ticket body stacks machine above human."],
    ["Accessibility", "WCAG AA 4.5:1 contrast for text in both themes; P&L colour always paired with a +/− sign and the band name (tooltip and screen-reader label); visible keyboard focus on every control; 44×44px minimum tap targets on phones; respects reduced motion; font scales with browser settings."]
  ])
];

// ---------------------------------------------------------------- 05 Backend Schema
const col = (name, type, cons, notes) => [name, type, cons, notes];
const tables = [
  ["users", [
    col("id", "uuid", "PK", "Default gen_random_uuid()"),
    col("email", "text", "NOT NULL, UNIQUE", "Verified Google email; must be in ALLOWED_USERS"),
    col("name", "text", "", "From Google profile"),
    col("avatar_url", "text", "", "From Google profile"),
    col("account_code", "text", "FK → accounts.code, NOT NULL", "Which account this person trades"),
    col("created_at", "timestamptz", "NOT NULL, DEFAULT now()", ""),
    col("last_login_at", "timestamptz", "", "")
  ]],
  ["accounts", [
    col("code", "text", "PK", "anilsub01 (Anil) | anilsub02 (Santosh); seeded"),
    col("owner_name", "text", "NOT NULL", ""),
    col("ibkr_account_id", "text", "UNIQUE", "IBKR U-number, learned on first matched import"),
    col("ibkr_alias", "text", "", "IBKR alias used for matching"),
    col("created_at", "timestamptz", "NOT NULL, DEFAULT now()", "")
  ]],
  ["fills", [
    col("exec_id", "text", "PK", "IBKR ibExecID / execID; dedupe key"),
    col("account_code", "text", "FK → accounts.code, NOT NULL", ""),
    col("conid", "text", "NOT NULL", "IBKR contract ID"),
    col("symbol, underlying, description, asset_class", "text", "NOT NULL", "Contract identity; description like 'SPXW 20OCT26 5910 C'"),
    col("multiplier", "numeric", "NOT NULL, DEFAULT 1", "100 for equity options"),
    col("executed_at_et", "timestamp", "NOT NULL", "Exchange local time (America/New_York)"),
    col("trade_date", "date", "NOT NULL", ""),
    col("side", "text", "NOT NULL, CHECK BUY|SELL", ""),
    col("quantity", "numeric", "NOT NULL", "Signed: + buy, − sell"),
    col("price, commission, net_cash", "numeric", "NOT NULL", "IBKR values; commission negative"),
    col("realized_pnl", "numeric", "", "IBKR fifoPnlRealized; null until Activity report"),
    col("open_close", "text", "NOT NULL, CHECK O|C|''", ""),
    col("source", "text", "NOT NULL", "trade-confirmation | activity | file"),
    col("raw", "jsonb", "NOT NULL", "Original Flex row for audit"),
    col("imported_at, upgraded_at", "timestamptz", "", "upgraded_at set when Activity fills in P&L")
  ]],
  ["account_days", [
    col("account_code", "text", "PK (with trade_date), FK → accounts.code", ""),
    col("trade_date", "date", "PK (with account_code)", ""),
    col("opening_cash", "numeric", "", "IBKR Cash Report startingCash or typed"),
    col("opening_cash_source", "text", "CHECK ibkr|manual", ""),
    col("ending_cash", "numeric", "", "IBKR endingCash"),
    col("nav", "numeric", "", "IBKR NAV in base (account value)"),
    col("updated_at", "timestamptz", "NOT NULL, DEFAULT now()", "")
  ]],
  ["open_positions", [
    col("account_code, report_date, conid", "text, date, text", "PK", "From Activity Open Positions (summary)"),
    col("symbol, description", "text", "NOT NULL", ""),
    col("quantity", "numeric", "NOT NULL", ""),
    col("mark_price, position_value, cost_basis, unrealized_pnl", "numeric", "", "IBKR values")
  ]],
  ["rules", [
    col("id", "uuid", "PK", "Default gen_random_uuid()"),
    col("position", "integer", "NOT NULL", "Display order"),
    col("text", "text", "NOT NULL", ""),
    col("active", "boolean", "NOT NULL, DEFAULT true", "Switched off, never deleted"),
    col("created_by", "uuid", "FK → users.id", ""),
    col("created_at, updated_at", "timestamptz", "NOT NULL, DEFAULT now()", "")
  ]],
  ["journal", [
    col("trade_key", "text", "PK", "account_conid_firstExecId (derived trade identity)"),
    col("account_code", "text", "FK → accounts.code, NOT NULL", "Trade owner"),
    col("rationale, rationale_by, rationale_at", "text, uuid FK → users.id, timestamptz", "", "Written by the trader only"),
    col("review, review_by, review_at", "text, uuid FK → users.id, timestamptz", "", "Written by the other person only"),
    col("lesson", "boolean", "", "Set by the reviewer: true lesson, false clean, null undecided"),
    col("lesson_text", "text", "", "The lesson in one line"),
    col("removed, removed_reason, removed_by, removed_at", "boolean, text, uuid FK → users.id, timestamptz", "removed NOT NULL DEFAULT false", "Erroneous-trade removal"),
    col("updated_at", "timestamptz", "NOT NULL, DEFAULT now()", "")
  ]],
  ["rule_ratings", [
    col("trade_key", "text", "PK (with rule_id), FK → journal.trade_key ON DELETE CASCADE", ""),
    col("rule_id", "uuid", "PK (with trade_key), FK → rules.id", ""),
    col("value", "smallint", "NOT NULL, CHECK IN (−1,0,1,2)", "2 followed, 1 partly, 0 broken, −1 not applicable"),
    col("rated_by", "uuid", "FK → users.id, NOT NULL", ""),
    col("rated_at", "timestamptz", "NOT NULL, DEFAULT now()", "")
  ]],
  ["lesson_reviews", [
    col("trade_key", "text", "PK, FK → journal.trade_key ON DELETE CASCADE", "Created when a lesson is flagged"),
    col("opened_at", "timestamptz", "NOT NULL, DEFAULT now()", "Overdue after lesson_review_due_days"),
    col("trader_note, trader_ack_by, trader_ack_at", "text, uuid FK → users.id, timestamptz", "", "What the trader will do differently"),
    col("reviewer_ack_by, reviewer_ack_at, discussed_on", "uuid FK → users.id, timestamptz, date", "", "Date the two discussed it"),
    col("completed_at", "timestamptz", "", "Set when both have signed")
  ]],
  ["settings", [
    col("key", "text", "PK", "pnl_bands, daily_loss_limit, revenge_window_minutes, lesson_review_due_days"),
    col("value", "jsonb", "NOT NULL", ""),
    col("updated_by", "uuid", "FK → users.id", ""),
    col("updated_at", "timestamptz", "NOT NULL, DEFAULT now()", "")
  ]],
  ["sync_runs", [
    col("id", "uuid", "PK", ""),
    col("kind", "text", "NOT NULL", "trade-confirmation | activity | file"),
    col("trigger", "text", "NOT NULL", "schedule | manual | upload"),
    col("started_at, finished_at", "timestamptz", "", ""),
    col("status", "text", "NOT NULL", "running | succeeded | failed"),
    col("fills_added, fills_upgraded", "integer", "NOT NULL, DEFAULT 0", ""),
    col("error", "text", "", "IBKR or parser message"),
    col("started_by", "uuid", "FK → users.id", "")
  ]],
  ["audit_events", [
    col("id", "bigint", "PK (bigserial)", ""),
    col("user_id", "uuid", "FK → users.id", ""),
    col("entity, entity_id, action", "text", "NOT NULL", "e.g. journal / key / review"),
    col("before, after", "jsonb", "", ""),
    col("at", "timestamptz", "NOT NULL, DEFAULT now()", "")
  ]],
  ["session", [
    col("sid", "varchar", "PK", "connect-pg-simple session store"),
    col("sess", "json", "NOT NULL", "Holds the Passport user id"),
    col("expire", "timestamp", "NOT NULL", "Indexed for cleanup")
  ]]
];
const schema = [
  h1("05 — Backend Schema"),
  purpose("Data model, relationships, and auth rules — defined before the first migration."),
  new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 120, after: 80 }, children: [new TextRun({ text: "Tables", font: FONT })] }),
  p("Trades are not stored: they are rebuilt from fills on every read (a trade is every fill in one contract in one account from flat to flat). The journal, ratings and lesson reviews hang off the derived trade key."),
  ...tables.flatMap(([name, rows]) => [h2(name), grid(["Column", "Type", "Constraints", "Notes"], rows, [2.2, 1.7, 2.2, 3])]),
  gap(),
  kv([
    ["Relationships", [
      "users.account_code → accounts.code (many-to-one)",
      "fills.account_code → accounts.code (many-to-one)",
      "account_days.account_code → accounts.code (many-to-one)",
      "open_positions.account_code → accounts.code (many-to-one)",
      "journal.account_code → accounts.code (many-to-one)",
      "journal.rationale_by / review_by / removed_by → users.id (many-to-one)",
      "rule_ratings.trade_key → journal.trade_key (many-to-one)",
      "rule_ratings.rule_id → rules.id (many-to-one)",
      "lesson_reviews.trade_key → journal.trade_key (one-to-one)",
      "journal.trade_key ↔ fills (logical: derived from account_code + conid + first exec_id)"
    ]],
    ["Auth Provider", "Google OAuth 2.0 via Passport; server-side cookie session stored in Postgres; allow-list ALLOWED_USERS (email → account) checked at sign-in and on every request."],
    ["Row Level Security", [
      "Not Postgres RLS: the API is the only database client and enforces every rule below.",
      "Anyone not signed in: no access to /api (401).",
      "Rationale on a trade: writable only by the user whose account owns the trade.",
      "Review and lesson flag on a trade: writable only by the other user.",
      "Lesson sign-off: trader signs the trader step; the other user signs the reviewer step.",
      "A lesson with any sign-off cannot be cleared.",
      "Rule ratings, removal, restore, rules, settings and opening cash: either user.",
      "Fills: written only by import and sync; no endpoint edits or deletes a fill."
    ]],
    ["User Roles", "trader: own account's rationale and trader sign-off; reviewer: the other account's review, lesson flag and reviewer sign-off. Both users hold both roles (each is trader of their own trades and reviewer of the other's). No admin role in v1; IBKR credentials and Google settings live in server environment, managed by Santosh."],
    ["File Storage", "N/A — v1 stores no files; Flex reports are parsed in memory and the original rows kept in fills.raw."],
    ["Sensitive Fields", [
      "FLEX_TOKEN and GOOGLE_CLIENT_SECRET live only in server environment / secrets store; never sent to the browser or logged.",
      "Flex token IP-locked to the server and set to expire after 1 year.",
      "No passwords, card or bank numbers are stored; account balances limited to daily cash and NAV from IBKR.",
      "Session cookie httpOnly and Secure in production."
    ]],
    ["Webhooks / Triggers", [
      "Worker cron: Trade Confirmation sync every 15 min 9:30–16:45 ET weekdays.",
      "Worker cron: Activity sync 06:00 ET Tuesday–Saturday.",
      "On lesson flagged → insert lesson_reviews row.",
      "On both sign-offs → set lesson_reviews.completed_at.",
      "On Activity import of a known fill with null realized_pnl → upgrade P&L, commission and net cash in place.",
      "Every journal, rating, rule, setting and opening-cash change → audit_events row."
    ]],
    ["API Endpoints", "See the table below."]
  ]),
  gap(),
  grid(["Method", "Path", "Auth", "Purpose"], [
    ["GET", "/auth/google, /auth/google/callback", "No", "Google sign-in and allow-list check"],
    ["POST", "/auth/logout", "Yes", "End the session"],
    ["GET", "/api/health", "No", "Liveness"],
    ["GET", "/api/me", "Yes", "Signed-in user and accounts"],
    ["GET", "/api/days?account=", "Yes", "Trading days with realized P&L for the rail"],
    ["GET", "/api/log?date=&account=", "Yes", "One day: sections, summary, cash, rules, bands"],
    ["GET", "/api/trades/:key", "Yes", "One trade with journal and ratings"],
    ["PUT", "/api/trades/:key/rationale", "Owner", "Write the rationale"],
    ["PUT", "/api/trades/:key/review", "Other", "Write the review"],
    ["PUT", "/api/trades/:key/lesson", "Other", "Flag or clear a lesson (with one-line lesson)"],
    ["POST", "/api/trades/:key/lesson-review/ack", "Yes", "Trader or reviewer sign-off"],
    ["PUT", "/api/trades/:key/ratings/:ruleId", "Yes", "Rate one rule (2/1/0/−1 or null)"],
    ["POST", "/api/trades/:key/remove, /restore", "Yes", "Remove as erroneous with reason; put back"],
    ["PUT", "/api/account-days/:account/:date/opening-cash", "Yes", "Typed opening cash"],
    ["GET", "/api/lessons?status=open|all", "Yes", "Lessons, completion rate, waiting on me, overdue"],
    ["GET, POST, PATCH", "/api/rules, /api/rules/:id", "Yes", "List with times broken, add, edit or switch off"],
    ["GET", "/api/dashboard?period=&date=&account=", "Yes", "Period figures combined and per person, series, positions"],
    ["GET", "/api/analytics?from=&to=&account=", "Yes", "Summary, breakdowns, leaks, loss-limit breaches, lessons"],
    ["POST", "/api/imports?commit=&mapping=", "Yes", "Preview or import a Flex file (text body)"],
    ["GET, POST", "/api/sync/runs, /api/sync/run", "Yes", "Sync history and configuration; run a sync now"],
    ["GET, PUT", "/api/settings", "Yes", "Bands, loss limits, revenge window, lesson due days"]
  ], [1, 3, 0.8, 3.2])
];

// ---------------------------------------------------------------- 06 Implementation Plan
const impl = [
  h1("06 — Implementation Plan"),
  purpose("Build order — so the agent never skips a foundation layer."),
  grid(["Phase", "Goal", "Tasks", "Done Criteria"], [
    ["1. Setup", "Project skeleton ready", ["npm workspaces monorepo: packages/core, apps/api, apps/web", "TypeScript base config, .env.example, .gitignore", "Dockerfiles, docker-compose.yml, nginx config"], "npm install, typecheck and both dev servers run locally."],
    ["2. Database", "Schema in place", ["001_init.sql: 12 tables plus session store and seeds (accounts, settings)", "002_starter_rules.sql: 8 starter rules", "scripts/migrate.ts with schema_migrations"], "npm run migrate creates every table on an empty database."],
    ["3. Auth", "Users can sign in", ["Passport Google strategy with ALLOWED_USERS allow-list", "Postgres-backed sessions; requireAuth on /api", "Login page with refusal messages; Google Cloud OAuth client and Testing-mode consent screen"], "Santosh and Anil sign in with Google; any other Google account is refused."],
    ["4. Trade engine", "Fills become trades", ["Flex parser (Activity, Trade Confirmation; XML, CSV)", "Trade builder: flat-to-flat grouping, carry-ins, open trades", "Cash and position after each fill; discipline score; P&L bands", "Unit tests with fixtures"], "Core tests pass on the Activity and Trade Confirmation fixtures."],
    ["5. Import and IBKR sync", "Data arrives without retyping", ["Ingest: account matching, dedupe by exec ID, P&L upgrade, cash, NAV, positions", "File import endpoint with preview and mapping", "Flex Web Service client and node-cron worker", "Import page with sync status"], "A Flex file imports both accounts and a re-import adds nothing; the worker pulls a live report."],
    ["6. Log and journal", "Each trade reviewed", ["Days and log endpoints; day sections", "Rationale, review, lesson flag, ratings, remove and restore with ownership checks and audit", "Log page and trade ticket"], "Each person writes their side of a trade and cannot write the other's."],
    ["7. Lessons", "Every lesson reviewed together", ["lesson_reviews with trader and reviewer sign-off", "Lessons page and nav badge; overdue rule"], "A flagged lesson closes only after both sign-offs and completion shows 100%."],
    ["8. Dashboard", "Position, cash and P&L at a glance", ["Period ranges (day, week, month, year) with previous-period comparison", "Per-person figures and drill-down; series and intraday charts; open positions with IBKR market value"], "Dashboard figures match the log for any period and either person."],
    ["9. Analytics", "Failures made visible", ["Weekday, symbol, time, hold, trade-number, revenge, discipline, rule, size, expiry, right breakdowns", "Equity curve and drawdown; loss-limit breaches; leak ranking", "Rules and Settings pages"], "Analytics shows best and worst weekday and symbols and ranks the worst leaks."],
    ["10. UI Polish", "Cohesive and usable on any device", ["Band legend on every money page; dark theme", "Phone layouts for nav, rail and tickets", "Empty and error states"], "Every page reads correctly at 380px and 1440px in both themes."],
    ["11. Testing", "Confidence before go-live", ["End-to-end smoke test against Postgres (29 checks)", "One week of live trades checked against IBKR statements by both people"], "Smoke passes and a week of Logger P&L matches IBKR to the cent."],
    ["12. Deploy", "Live for both people", ["Provision host with static IP; DNS and TLS", "docker compose up; migrations; production Google redirect URI", "Flex token IP-locked to the server"], "Both sign in at the production URL and the 06:00 Activity sync succeeds."]
  ], [1.1, 1.4, 4, 2]),
  new Paragraph({ spacing: { before: 200, after: 80 }, children: [new TextRun({ text: "Overall Done Criteria", bold: true, font: FONT, size: 22 })] }),
  p("Santosh and Anil sign in with Google at the production URL (anyone else is refused). During the session their fills appear in the Log within 15 minutes; each writes the rationale on their own trades, rates the rules, and reviews the other's. A flagged lesson is signed off by both and the Lessons page shows 100%. The next morning the Activity sync fills in IBKR's realized P&L, opening cash and account value without duplicating anything. The Dashboard shows combined and per-person P&L, cash, account value and open position for day, week, month and year, matching IBKR, and Analytics shows the best and worst weekdays and symbols and the worst leaks — all without anyone retyping a trade.")
];

// ---------------------------------------------------------------- 07 Project Plan (landscape)
const T = "2026-10-20";
const sched = [
  ["1", "Setup", "Scaffold monorepo, configs, Docker files", "AI Agent", "0.5d", T, T, T, T, "Done", "Repo built in Claude workspace; delivered as zip"],
  ["1", "Setup", "Place repo in repos folder and push to GitHub", "Santosh", "0.5d", "2026-10-21", "2026-10-21", T, "—", "In Progress", "Repo santoshkrishna-cx/logger created (public); push pending"],
  ["2", "Database", "Write migrations 001 and 002", "AI Agent", "0.5d", T, T, T, T, "Done", "Verified on PostgreSQL 16"],
  ["3", "Auth", "Google allow-list auth and sessions", "AI Agent", "1d", T, T, T, T, "Done", "Refusal and 401 paths covered by smoke test"],
  ["3", "Auth", "Create Google OAuth client and Testing-mode consent screen", "Santosh", "0.5d", "2026-10-21", "2026-10-21", "—", "—", "Not Started", "Add both Gmail addresses as test users; register http://localhost:8080/auth/google/callback first"],
  ["3", "Auth", "Confirm both Google addresses for ALLOWED_USERS", "Santosh", "0.5d", "2026-10-21", "2026-10-21", T, T, "Done", "santosh.krishna0909@gmail.com (anilsub02), mailanilkumar@gmail.com (anilsub01)"],
  ["4", "Trade engine", "Flex parser, trade builder, scoring, unit tests", "AI Agent", "1d", T, T, T, T, "Done", "13 unit tests pass"],
  ["5", "Import and IBKR sync", "Ingest, file import, Flex client, worker", "AI Agent", "1d", T, T, T, T, "Done", "Re-import and next-morning upgrade verified"],
  ["5", "Import and IBKR sync", "Set aliases, create both Flex queries, generate IP-locked token", "Santosh", "0.5d", "2026-10-21", "2026-10-21", "—", "—", "Not Started", "Follow docs/ibkr-flex-setup.md; parallel with Auth tasks"],
  ["5", "Import and IBKR sync", "Confirm one query covers both sub-accounts", "Santosh", "0.5d", "2026-10-21", "2026-10-21", "—", "—", "Not Started", "Santosh will configure both queries to cover both accounts"],
  ["6", "Log and journal", "Log endpoints, journal permissions, trade ticket", "AI Agent", "1d", T, T, T, T, "Done", ""],
  ["7", "Lessons", "Joint sign-off flow and Lessons page", "AI Agent", "0.5d", T, T, T, T, "Done", "100% target tracked"],
  ["8", "Dashboard", "Period figures, drill-down, charts, positions", "AI Agent", "1d", T, T, T, T, "Done", ""],
  ["9", "Analytics", "Breakdowns, equity curve, leaks, Rules and Settings pages", "AI Agent", "1d", T, T, T, T, "Done", ""],
  ["9", "Analytics", "Agree rulebook, P&L thresholds and daily loss limits", "Santosh, Anil", "0.5d", "2026-10-22", "2026-10-22", T, T, "Done", "Defaults kept: $50 scratch, $500 big, starter rules, loss limit unset"],
  ["10", "UI Polish", "Band legend, dark theme, phone layouts, empty states", "AI Agent", "0.5d", T, T, T, T, "Done", "Reviewed at 390px and 1440px"],
  ["11", "Testing", "End-to-end smoke test", "AI Agent", "0.5d", T, T, T, T, "Done", "29 checks pass"],
  ["11", "Testing", "One-command local Docker start (local-up scripts)", "AI Agent", "0.5d", T, T, T, T, "Done", "Added in v2; images and script verified in workspace"],
  ["11", "Testing", "CI and Deploy pipeline (GitHub Actions, GHCR, droplet scripts)", "AI Agent", "1d", T, T, T, T, "Done", "Added in v3; workflows pass actionlint; first live run pending"],
  ["1", "Setup", "Rename the app and repo to Logger", "AI Agent", "0.5d", T, T, T, T, "Done", "Added in v3; GitHub repo santoshkrishna-cx/logger"],
  ["11", "Testing", "Test locally on Docker Desktop", "Santosh", "1d", "2026-10-21", "2026-10-21", "—", "—", "Not Started", "Added in v2; run scripts/local-up with --demo, then --reset before real imports"],
  ["11", "Testing", "One week of live trades reconciled to IBKR", "Santosh, Anil", "5d", "2026-10-26", "2026-10-30", "—", "—", "Not Started", "Needs Deploy done first"],
  ["12", "Deploy", "Choose host and provision server with static IP", "Santosh", "1d", "2026-10-22", "2026-10-22", T, "—", "In Progress", "DigitalOcean droplet chosen; Santosh provisions after local testing. TBD — domain?"],
  ["12", "Deploy", "Deploy with Docker Compose, TLS and production redirect URI", "Santosh", "0.5d", "2026-10-23", "2026-10-23", "—", "—", "Not Started", "Owner changed to Santosh in v2; steps in README > Deploying to a DigitalOcean droplet"],
  ["12", "Deploy", "First scheduled Activity sync succeeds", "Reviewer", "0.5d", "2026-10-26", "2026-10-26", "—", "—", "Not Started", "06:00 ET Monday run covers Friday"]
];
const plan = [
  new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { after: 120 }, children: [new TextRun({ text: "07 — Project Plan", font: FONT })] }),
  purpose("Living schedule — phases, activities, owners, durations, and dates, updated after every round of progress."),
  h2("07.1 — Plan Metadata"),
  kv([
    ["Plan Version", "v3"],
    ["Last Updated", T],
    ["Project Start Date", `${T} (assumed — confirm)`],
    ["Target Launch Date", "2026-11-02 (assumed — confirm; follows one week of live reconciliation)"],
    ["Working Days Per Week", "5"],
    ["Holidays / Blackout Dates", "None"],
    ["Status Legend", "Not Started | In Progress | Blocked | Done | Deferred"]
  ], LANDSCAPE_W),
  h2("07.2 — Phase Schedule"),
  grid(["Phase #", "Phase Name", "Activity", "Owner / Role", "Duration", "Planned Start", "Planned End", "Actual Start", "Actual End", "Status", "Notes"], sched,
    [0.75, 1.1, 2.3, 1.0, 0.85, 1.2, 1.2, 1.2, 1.2, 1.0, 2.2], LANDSCAPE_W),
  h2("07.3 — Milestones"),
  grid(["Milestone", "Target Date", "Status", "Notes"], [
    ["Setup complete", T, "Done", "Repo in GitHub pending"],
    ["Database complete", T, "Done", ""],
    ["Auth complete", "2026-10-21", "In Progress", "Code done; Google OAuth client to create"],
    ["Trade engine complete", T, "Done", ""],
    ["Import and IBKR sync complete", "2026-10-21", "In Progress", "Code done; Flex queries and token to create"],
    ["Log, Lessons, Dashboard, Analytics complete", T, "Done", ""],
    ["UI Polish complete", T, "Done", ""],
    ["Deployed", "2026-10-23", "Not Started", "DigitalOcean droplet; Santosh sets it up"],
    ["Testing complete (live reconciliation)", "2026-10-30", "Not Started", ""],
    ["Launch", "2026-11-02", "Not Started", "Assumed — confirm"]
  ], [3, 1.3, 1.3, 4], LANDSCAPE_W),
  h2("07.4 — Change Log"),
  grid(["Version", "Date", "Change Summary"], [["v1", T, "Initial plan created"], ["v2", T, "Confirmed Gmail sign-in addresses and kept default thresholds (Done); chose DigitalOcean with Santosh owning deploy; added local Docker start (Done) and local testing (Not Started)."], ["v3", T, "Renamed the app from Tradelog to Logger across all documents; added the CI and Deploy pipeline (Done); repo push In Progress."]], [1, 1.5, 8], LANDSCAPE_W)
];

// ---------------------------------------------------------------- assemble
const footer = new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "Logger Project Docs  |  page ", font: FONT, size: 16, color: "5B6676" }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: "5B6676" })] })] });
const doc = new Document({
  creator: "Santosh Krishna",
  features: { updateFields: true },
  title: "Logger Project Docs",
  styles: {
    default: { document: { run: { font: FONT, size: 20 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 34, bold: true, color: "16202E", font: FONT }, paragraph: { spacing: { before: 120, after: 120 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 25, bold: true, color: "2A4D8F", font: FONT }, paragraph: { spacing: { before: 240, after: 80 }, outlineLevel: 1 } }
    ]
  },
  numbering: { config: [
    { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 300, hanging: 200 } } } }] },
    { reference: "steps", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 260 } } } }] }
  ] },
  sections: [
    {
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
      footers: { default: footer },
      children: [
        new Paragraph({ spacing: { before: 1800, after: 120 }, children: [new TextRun({ text: "Logger", bold: true, size: 64, font: FONT, color: "16202E" })] }),
        new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: "Project Docs: PRD, TRD, App Flow, UI/UX Design Brief, Backend Schema, Implementation Plan, Project Plan", size: 26, font: FONT, color: "2A4D8F" })] }),
        new Paragraph({ spacing: { after: 600 }, children: [new TextRun({ text: `Version v3  |  ${T}  |  Owner: Santosh Krishna`, size: 20, font: FONT, color: "5B6676" })] }),
        new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: "Contents", bold: true, size: 28, font: FONT })] }),
        new TableOfContents("Contents", { hyperlink: true, headingStyleRange: "1-1" }),
        new Paragraph({ spacing: { before: 200 }, children: [new TextRun({ text: "Open Word's References > Update Table to refresh page numbers.", italics: true, size: 18, color: "5B6676", font: FONT })] }),
        ...prd, ...trd, ...flow, ...ui, ...schema, ...impl
      ]
    },
    {
      properties: { page: { size: { width: 12240, height: 15840, orientation: PageOrientation.LANDSCAPE }, margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } } },
      footers: { default: footer },
      children: plan
    }
  ]
});

Packer.toBuffer(doc).then(buf => {
  const out = path.join(__dirname, "Logger_Project_Docs.docx");
  fs.writeFileSync(out, buf);
  console.log("wrote", out, buf.length, "bytes");
});
