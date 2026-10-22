import { XMLParser } from "fast-xml-parser";
import type { Fill } from "../types.js";
import { r2 } from "../util.js";

/** A fill as read from a report, before its IBKR account is mapped to our account code. */
export interface ParsedFill extends Omit<Fill, "account"> {
  ibkrAccount: string;
  alias: string;
  raw: Record<string, string>;
}
export interface ParsedCash { ibkrAccount: string; alias: string; fromDate: string; toDate: string; startingCash: number; endingCash: number | null }
export interface ParsedNav { ibkrAccount: string; alias: string; date: string; total: number; cash: number | null }
export interface ParsedPosition {
  ibkrAccount: string; alias: string; date: string; conid: string; symbol: string; description: string;
  quantity: number; markPrice: number | null; positionValue: number | null; costBasis: number | null; unrealizedPnl: number | null;
}
export type CashCategory = "deposit" | "withdrawal" | "transfer_in" | "transfer_out" | "fee" | "interest" | "dividend" | "other";
export interface ParsedCashTxn {
  ibkrAccount: string; alias: string; id: string; date: string;
  category: CashCategory; amount: number; currency: string; counterparty: string | null; description: string; raw: Record<string, string>;
}
export interface FlexReport {
  kind: "activity" | "trade-confirmation" | "unknown";
  fills: ParsedFill[];
  cash: ParsedCash[];
  nav: ParsedNav[];
  positions: ParsedPosition[];
  cashTxns: ParsedCashTxn[];
}

type Rec = Record<string, string>;
const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");

/** IBKR spells the same field differently across Activity, Trade Confirmation and CSV exports. */
const FIELDS = {
  account: ["accountid", "clientaccountid", "account"],
  alias: ["acctalias", "accountalias", "alias"],
  conid: ["conid"],
  symbol: ["symbol"],
  underlying: ["underlyingsymbol"],
  description: ["description"],
  assetClass: ["assetcategory", "assetclass"],
  multiplier: ["multiplier"],
  execId: ["ibexecid", "execid"],
  tradeId: ["tradeid"],
  dateTime: ["datetime"],
  tradeDate: ["tradedate"],
  quantity: ["quantity"],
  price: ["tradeprice", "price"],
  commission: ["ibcommission", "commission"],
  netCash: ["netcash"],
  realized: ["fifopnlrealized"],
  side: ["buysell"],
  openClose: ["opencloseindicator"],
  code: ["code", "notescodes"],
  level: ["levelofdetail"]
} as const;

function getter(rec: Rec) {
  const n: Rec = {};
  for (const k in rec) n[norm(k)] = rec[k];
  return (f: keyof typeof FIELDS): string | undefined => {
    for (const c of FIELDS[f]) {
      const v = n[c];
      if (v !== undefined && v !== "") return String(v);
    }
    return undefined;
  };
}

const num = (v: string | undefined): number | null => {
  if (v === undefined || v === "" || v === "--" || v === "N/A") return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isNaN(n) ? null : n;
};

export function parseFlexDateTime(dt?: string, tradeDate?: string): string | null {
  const d = String(dt ?? "").replace(/\D/g, "");
  if (d.length >= 12) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${d.slice(8, 10)}:${d.slice(10, 12)}:${d.slice(12, 14) || "00"}`;
  const t = String(tradeDate ?? "").replace(/\D/g, "");
  if (t.length === 8) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T00:00:00`;
  return null;
}

const isoDate = (v?: string) => {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : "";
};

export function recordToFill(rec: Rec): ParsedFill | null {
  const g = getter(rec);
  const level = g("level");
  if (level && !/execution/i.test(level)) return null;
  const executedAt = parseFlexDateTime(g("dateTime"), g("tradeDate"));
  if (!executedAt) return null;
  const quantity = num(g("quantity"));
  const price = num(g("price"));
  if (!quantity || price === null) return null;
  const multiplier = num(g("multiplier")) || 1;
  const commission = num(g("commission")) ?? 0;
  const netCash = num(g("netCash")) ?? r2(-quantity * price * multiplier + commission);
  let oc = (g("openClose") || "").toUpperCase();
  if (!oc) {
    const toks = (g("code") || "").toUpperCase().split(/[;,\s]+/);
    oc = toks.includes("O") && !toks.includes("C") ? "O" : toks.includes("C") && !toks.includes("O") ? "C" : "";
  }
  const openClose: Fill["openClose"] = oc.includes("C") && !oc.includes("O") ? "C" : oc.includes("O") && !oc.includes("C") ? "O" : "";
  const description = (g("description") || g("symbol") || "").trim();
  const symbol = (g("symbol") || description).trim();
  const id = g("execId") || g("tradeId") || `${executedAt}_${g("conid")}_${quantity}_${price}`;
  const side = (g("side") || (quantity > 0 ? "BUY" : "SELL")).toUpperCase().startsWith("B") ? "BUY" : "SELL";
  const realized = num(g("realized"));
  return {
    id: String(id).trim(),
    ibkrAccount: g("account") || "",
    alias: g("alias") || "",
    conid: g("conid") || symbol,
    symbol,
    underlying: (g("underlying") || description.split(/\s+/)[0] || symbol).trim(),
    description,
    assetClass: g("assetClass") || "",
    multiplier,
    executedAt,
    tradeDate: executedAt.slice(0, 10),
    side,
    quantity,
    price,
    commission: r2(commission),
    netCash: r2(netCash),
    realizedPnl: realized === null ? null : r2(realized),
    openClose,
    raw: rec
  };
}

const TAGS = new Set(["Trade", "TradeConfirm", "CashReportCurrency", "EquitySummaryByReportDateInBase", "OpenPosition", "CashTransaction", "Transfer"]);

const normRec = (rec: Rec): Rec => { const n: Rec = {}; for (const k in rec) n[norm(k)] = rec[k]; return n; };

function parseCashTransaction(rec: Rec, account: string, alias: string): ParsedCashTxn | null {
  const n = normRec(rec);
  const amount = num(n.amount);
  if (amount === null || amount === 0) return null;
  const t = (n.type || "").toLowerCase();
  const category: CashCategory =
    /deposit|withdraw/.test(t) ? (amount >= 0 ? "deposit" : "withdrawal")
    : /interest/.test(t) ? "interest" : /dividend/.test(t) ? "dividend"
    : /fee|commission|tax/.test(t) ? "fee" : "other";
  const date = isoDate(n.settledate || n.datetime || n.reportdate || n.date);
  if (!date) return null;
  const id = n.transactionid || `ct_${account}_${date}_${amount}_${t}`.replace(/\s+/g, "");
  return { ibkrAccount: account, alias, id, date, category, amount: r2(amount), currency: n.currency || "USD", counterparty: null, description: n.description || "", raw: rec };
}

function parseTransfer(rec: Rec, account: string, alias: string): ParsedCashTxn | null {
  const n = normRec(rec);
  const amt = num(n.cashtransfer) ?? num(n.amount);
  if (amt === null || amt === 0) return null;
  const inbound = (n.direction || "").toUpperCase() === "IN" || amt > 0;
  const amount = Math.abs(amt) * (inbound ? 1 : -1);
  const date = isoDate(n.datetime || n.date || n.reportdate || n.settledate);
  if (!date) return null;
  const counterparty = n.account || n.otheracct || n.toacct || null;
  const id = n.transactionid || `tr_${account}_${date}_${amount}_${counterparty || ""}`.replace(/\s+/g, "");
  return { ibkrAccount: account, alias, id, date, category: inbound ? "transfer_in" : "transfer_out", amount: r2(amount), currency: n.currency || "USD", counterparty, description: n.description || n.type || "", raw: rec };
}

function walk(node: unknown, tag: string | null, out: { tag: string; rec: Rec }[]) {
  if (Array.isArray(node)) {
    node.forEach(n => walk(n, tag, out));
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  if (tag && TAGS.has(tag)) {
    const rec: Rec = {};
    for (const k in obj) if (typeof obj[k] !== "object") rec[k] = String(obj[k]);
    out.push({ tag, rec });
  }
  for (const k in obj) if (obj[k] && typeof obj[k] === "object") walk(obj[k], k, out);
}

function parseXml(text: string): FlexReport {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", parseAttributeValue: false, parseTagValue: false });
  let doc: unknown;
  try {
    doc = parser.parse(text, true);
  } catch {
    throw new Error("The XML report could not be read. Download it from IBKR again.");
  }
  const nodes: { tag: string; rec: Rec }[] = [];
  walk(doc, null, nodes);
  const report: FlexReport = { kind: "unknown", fills: [], cash: [], nav: [], positions: [], cashTxns: [] };
  for (const { tag, rec } of nodes) {
    const g = getter(rec);
    if (tag === "Trade" || tag === "TradeConfirm") {
      if (tag === "Trade") report.kind = "activity";
      if (tag === "TradeConfirm" && report.kind === "unknown") report.kind = "trade-confirmation";
      const f = recordToFill(rec);
      if (f) report.fills.push(f);
    } else if (tag === "CashReportCurrency") {
      if (!/BASE/i.test(rec.currency || "")) continue;
      const start = num(rec.startingCash);
      if (start === null) continue;
      report.cash.push({
        ibkrAccount: g("account") || "", alias: g("alias") || "",
        fromDate: isoDate(rec.fromDate), toDate: isoDate(rec.toDate), startingCash: start, endingCash: num(rec.endingCash)
      });
    } else if (tag === "EquitySummaryByReportDateInBase") {
      const total = num(rec.total);
      if (total === null) continue;
      report.nav.push({ ibkrAccount: g("account") || "", alias: g("alias") || "", date: isoDate(rec.reportDate), total, cash: num(rec.cash) });
    } else if (tag === "OpenPosition") {
      if (rec.levelOfDetail && !/SUMMARY/i.test(rec.levelOfDetail)) continue;
      report.positions.push({
        ibkrAccount: g("account") || "", alias: g("alias") || "", date: isoDate(rec.reportDate), conid: rec.conid || "",
        symbol: rec.symbol || "", description: rec.description || "", quantity: num(rec.position) ?? 0,
        markPrice: num(rec.markPrice), positionValue: num(rec.positionValue),
        costBasis: num(rec.costBasisMoney), unrealizedPnl: num(rec.fifoPnlUnrealized)
      });
    } else if (tag === "CashTransaction") {
      const ct = parseCashTransaction(rec, g("account") || "", g("alias") || "");
      if (ct) report.cashTxns.push(ct);
    } else if (tag === "Transfer") {
      const tr = parseTransfer(rec, g("account") || "", g("alias") || "");
      if (tr) report.cashTxns.push(tr);
    }
  }
  return report;
}

export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function parseCsv(text: string): FlexReport {
  const report: FlexReport = { kind: "unknown", fills: [], cash: [], nav: [], positions: [], cashTxns: [] };
  let header: string[] | null = null;
  for (let row of parseCsvRows(text)) {
    if (!row.length || row.every(c => !c.trim())) continue;
    const tag = (row[0] || "").toUpperCase();
    if (/^(BOF|EOF|BOA|EOA|BOS|EOS)$/.test(tag)) continue;
    if (tag === "HEADER" || tag === "DATA") row = row.slice(2);
    const keys = row.map(norm);
    if (keys.includes("tradeprice") || (keys.includes("quantity") && keys.includes("conid")) || keys.includes("startingcash")) {
      header = row;
      continue;
    }
    if (!header) continue;
    const rec: Rec = {};
    header.forEach((h, i) => (rec[h] = row[i] ?? ""));
    if (header.map(norm).includes("startingcash")) {
      const n: Rec = {};
      for (const k in rec) n[norm(k)] = rec[k];
      const g = getter(rec);
      const s = num(n.startingcash);
      if (/BASE/i.test(n.currencyprimary || n.currency || "") && s !== null) {
        report.cash.push({ ibkrAccount: g("account") || "", alias: g("alias") || "", fromDate: isoDate(n.fromdate), toDate: isoDate(n.todate), startingCash: s, endingCash: num(n.endingcash) });
      }
      continue;
    }
    const f = recordToFill(rec);
    if (f) report.fills.push(f);
  }
  report.kind = report.fills.some(f => f.realizedPnl !== null) ? "activity" : report.fills.length ? "trade-confirmation" : "unknown";
  return report;
}

/** Parses an IBKR Flex report (Activity or Trade Confirmation; XML or CSV). */
export function parseFlex(text: string): FlexReport {
  const t = text.replace(/^\uFEFF/, "").trim();
  return t.startsWith("<") ? parseXml(t) : parseCsv(t);
}
