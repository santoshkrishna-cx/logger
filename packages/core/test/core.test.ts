import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyze, applyCash, buildTrades, daySections, discipline, parseFlex, periodRange, pnlBand, shiftPeriod, type Fill, type ReviewedTrade, type Rule } from "../src/index.js";

const fixture = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");
const MAP: Record<string, string> = { anilsub02: "anilsub02", anilsub01: "anilsub01" };
const toFills = (text: string): Fill[] => parseFlex(text).fills.map(({ ibkrAccount, alias, raw, ...f }) => ({ ...f, account: MAP[alias] ?? ibkrAccount }));

describe("parseFlex", () => {
  it("reads Activity executions, cash, NAV and positions and skips order-level rows", () => {
    const r = parseFlex(fixture("activity.xml"));
    expect(r.kind).toBe("activity");
    expect(r.fills).toHaveLength(8);
    expect(r.cash.map(c => c.startingCash)).toEqual([50000, 52000]);
    expect(r.nav[0].total).toBe(51071.4);
    expect(r.positions[0].quantity).toBe(5);
    const f = r.fills[0];
    expect(f).toMatchObject({ id: "0001.01", executedAt: "2026-10-20T09:38:05", side: "BUY", quantity: 10, openClose: "O", underlying: "SPX", realizedPnl: 0 });
  });
  it("reads Trade Confirmation executions, taking open/close from the code field", () => {
    const r = parseFlex(fixture("trade-confirm.xml"));
    expect(r.kind).toBe("trade-confirmation");
    expect(r.fills.map(f => f.openClose)).toEqual(["O", "C"]);
    expect(r.fills[0].realizedPnl).toBeNull();
  });
  it("reads CSV with HEADER/DATA prefixes", () => {
    const csv = [
      '"HEADER","TRNT","ClientAccountID","AccountAlias","Conid","Description","Multiplier","IBExecID","DateTime","Quantity","TradePrice","IBCommission","NetCash","FifoPnlRealized","Buy/Sell","Open/CloseIndicator"',
      '"DATA","TRNT","U1","anilsub02","5","SPXW 20OCT26 5910 C","100","x1","20261020;093805","10","4.4","-8.2","-4408.2","0","BUY","O"'
    ].join("\n");
    const r = parseFlex(csv);
    expect(r.fills).toHaveLength(1);
    expect(r.fills[0].alias).toBe("anilsub02");
  });
});

describe("buildTrades", () => {
  const { fills, days } = applyCash(toFills(fixture("activity.xml")), { anilsub02: { "2026-10-20": 50000 } });
  const trades = buildTrades(fills);
  it("groups scale-outs into one trade and uses IBKR realized P&L", () => {
    const t = trades.find(x => x.conid === "7001")!;
    expect(t.fills).toHaveLength(3);
    expect(t.status).toBe("closed");
    expect(t.realizedPnl).toBe(958.6);
    expect(t.avgEntry).toBe(4.4);
    expect(t.avgExit).toBeCloseTo(5.375, 3);
    expect(t.zeroDte).toBe(true);
    expect(t.fills.map(f => f.positionAfter)).toEqual([10, 5, 0]);
  });
  it("tracks cash after each fill from the opening balance", () => {
    const t = trades.find(x => x.conid === "7001")!;
    expect(t.fills[0].cashAfter).toBe(45591.8);
    expect(days.find(d => d.account === "anilsub02")!.closing).toBe(50192.2);
  });
  it("marks carry-ins and still-open trades", () => {
    expect(trades.find(x => x.conid === "8002")!.carryIn).toBe(true);
    const mu = trades.find(x => x.conid === "8001")!;
    expect(mu.status).toBe("open");
    expect(mu.openQuantity).toBe(5);
    const s = daySections(trades, "2026-10-20");
    expect(s.roundTrips.length).toBe(2);
    expect(s.carriedIn.length).toBe(1);
    expect(s.stillOpen.length).toBe(1);
  });
  it("falls back to net cash for a round trip without IBKR realized P&L", () => {
    const tc = buildTrades(applyCash(toFills(fixture("trade-confirm.xml")), {}).fills);
    expect(tc[0].realizedPnl).toBe(783.6);
  });
});

describe("scoring and bands", () => {
  const rules: Rule[] = [{ id: "a", text: "A", active: true, position: 1 }, { id: "b", text: "B", active: true, position: 2 }, { id: "c", text: "C", active: false, position: 3 }];
  it("scores followed, partly and broken; ignores N/A and inactive rules", () => {
    expect(discipline({ a: 2, b: 1, c: 0 }, rules)).toMatchObject({ score: 75, grade: "B", broken: [] });
    expect(discipline({ a: 0, b: -1 }, rules)).toMatchObject({ score: 0, grade: "F", broken: ["a"] });
    expect(discipline({}, rules).score).toBeNull();
  });
  it("bands P&L", () => {
    expect([pnlBand(800), pnlBand(120), pnlBand(-20), pnlBand(-300), pnlBand(-900), pnlBand(null)]).toEqual(["big-win", "win", "scratch", "loss", "big-loss", "none"]);
  });
});

describe("periods", () => {
  it("builds Monday-start weeks, months and years", () => {
    expect(periodRange("week", "2026-10-21")).toEqual({ from: "2026-10-19", to: "2026-10-25" });
    expect(periodRange("month", "2026-02-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodRange("year", "2026-10-21")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(shiftPeriod("day", "2026-10-19", -1)).toBe("2026-10-16");
  });
});

describe("analyze", () => {
  const rules: Rule[] = [{ id: "stop", text: "Honor the stop", active: true, position: 1 }];
  const trades = buildTrades(applyCash(toFills(fixture("activity.xml")), {}).fills).map((t, i): ReviewedTrade => ({
    ...t, removed: false, lesson: i === 1, lessonReviewComplete: false,
    discipline: discipline(t.realizedPnl !== null && t.realizedPnl < 0 ? { stop: 0 } : { stop: 2 }, rules)
  }));
  const a = analyze(trades, { rules, minTradesForLeak: 1, dailyLossLimit: { anilsub02: 500 } });
  it("summarises closed trades", () => {
    expect(a.summary.trades).toBe(3);
    expect(a.summary.net).toBe(910.9);
    expect(a.bestWeekday!.label).toBe("Tuesday");
  });
  it("ranks symbols and finds leaks", () => {
    expect(a.bestSymbols[0].label).toBe("META");
    expect(a.byBrokenRule[0].net).toBe(-766.4);
    expect(a.leaks.some(l => l.dimension === "Broken rule")).toBe(true);
  });
  it("tracks lesson review completion", () => {
    expect(a.lessons).toEqual({ total: 1, completed: 0, completionRate: 0 });
  });
});

describe("parseFlex funding (cash transactions and transfers)", () => {
  const xml = `<FlexQueryResponse><FlexStatements><FlexStatement>
    <CashTransactions>
      <CashTransaction accountId="U17271146" acctAlias="anilsub02" type="Deposits/Withdrawals" amount="10000" currency="USD" dateTime="20260901" transactionID="D1" description="ACH deposit"/>
      <CashTransaction accountId="U17271146" acctAlias="anilsub02" type="Broker Interest Paid" amount="-3.5" currency="USD" dateTime="20260902" transactionID="I1"/>
    </CashTransactions>
    <Transfers>
      <Transfer accountId="U17271146" acctAlias="anilsub02" type="INTERNAL" direction="IN" cashTransfer="5000" account="U0000000" dateTime="20260903" transactionID="T1"/>
    </Transfers>
  </FlexStatement></FlexStatements></FlexQueryResponse>`;
  const r = parseFlex(xml);
  it("reads deposits, interest and internal transfers", () => {
    const by = Object.fromEntries(r.cashTxns.map(c => [c.id, c]));
    expect(by.D1).toMatchObject({ category: "deposit", amount: 10000, alias: "anilsub02" });
    expect(by.I1.category).toBe("interest");
    expect(by.T1).toMatchObject({ category: "transfer_in", amount: 5000, counterparty: "U0000000" });
  });
});
