import "dotenv/config";

const required = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing environment variable ${k}. See .env.example.`);
  return v;
};

/** ALLOWED_USERS="santosh@x.com:anilsub02,anil@y.com:anilsub01" -> Map(email -> account code) */
function parseAllowed(v: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const pair of v.split(",").map(s => s.trim()).filter(Boolean)) {
    const [email, account] = pair.split(":").map(s => s.trim());
    if (!email || !account) throw new Error(`ALLOWED_USERS entry "${pair}" must look like email:account`);
    m.set(email.toLowerCase(), account);
  }
  if (m.size === 0) throw new Error("ALLOWED_USERS must list at least one email:account pair");
  return m;
}

export interface FlexSource { group: string; name: string; token: string; tradeConfirmQueryId: string; activityQueryId: string }

/** One Flex-enabled IBKR master per group, built from the environment.
 *  Adding a group: add a line here, set its FLEX_<X>_* env vars, and insert a groups row. */
function parseFlexSources(): FlexSource[] {
  const sources: FlexSource[] = [];
  const add = (group: string, name: string, prefix: string) => {
    const token = process.env[`${prefix}TOKEN`] ?? "";
    const tradeConfirmQueryId = process.env[`${prefix}TRADE_CONFIRM_QUERY_ID`] ?? "";
    const activityQueryId = process.env[`${prefix}ACTIVITY_QUERY_ID`] ?? "";
    if (token && (tradeConfirmQueryId || activityQueryId)) sources.push({ group, name, token, tradeConfirmQueryId, activityQueryId });
  };
  add("shikharam", "Shikharam LLC", "FLEX_");       // FLEX_TOKEN / FLEX_TRADE_CONFIRM_QUERY_ID / FLEX_ACTIVITY_QUERY_ID
  add("santoshodc", "Santosh ODC", "FLEX_ODC_");    // FLEX_ODC_TOKEN / FLEX_ODC_TRADE_CONFIRM_QUERY_ID / FLEX_ODC_ACTIVITY_QUERY_ID
  return sources;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  production: process.env.NODE_ENV === "production",
  // Secure cookies need HTTPS. Defaults to on in production; set COOKIE_SECURE=false to test over plain http://localhost.
  cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "true" : process.env.NODE_ENV === "production",
  databaseUrl: required("DATABASE_URL"),
  sessionSecret: required("SESSION_SECRET"),
  appOrigin: process.env.APP_ORIGIN ?? "http://localhost:5173",
  google: {
    clientId: required("GOOGLE_CLIENT_ID"),
    clientSecret: required("GOOGLE_CLIENT_SECRET"),
    callbackUrl: required("GOOGLE_CALLBACK_URL")
  },
  allowedUsers: parseAllowed(required("ALLOWED_USERS")),
  flex: {
    token: process.env.FLEX_TOKEN ?? "",
    tradeConfirmQueryId: process.env.FLEX_TRADE_CONFIRM_QUERY_ID ?? "",
    activityQueryId: process.env.FLEX_ACTIVITY_QUERY_ID ?? "",
    baseUrl: process.env.FLEX_BASE_URL ?? "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService"
  },
  // One entry per IBKR master that has Flex credentials set. Drives the per-group sync.
  flexSources: parseFlexSources()
};
