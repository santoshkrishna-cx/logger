/** One IBKR execution. Times are Eastern (exchange) local time, as IBKR reports them. */
export interface Fill {
  id: string;               // IBKR execution ID (ibExecID / execID) - dedupe key
  account: string;          // our account code: anilsub01 | anilsub02
  conid: string;
  symbol: string;
  underlying: string;
  description: string;
  assetClass: string;       // OPT, STK, FUT ...
  multiplier: number;
  executedAt: string;       // 'YYYY-MM-DDTHH:mm:ss' (ET)
  tradeDate: string;        // 'YYYY-MM-DD'
  side: "BUY" | "SELL";
  quantity: number;         // signed: + buy, - sell
  price: number;
  commission: number;       // negative = cost
  netCash: number;          // signed cash effect including commission
  realizedPnl: number | null; // IBKR fifoPnlRealized (Activity report only)
  openClose: "O" | "C" | "";
}

export interface FillWithState extends Fill {
  positionAfter: number | null; // null for carry-in fills (prior size unknown)
  cashAfter: number | null;     // null when no opening cash is known
  cashDelta: number;            // change in cash since the open of that day
}

export interface Contract {
  name: string;        // "SPXW 20 Oct 5910C"
  expiry: string | null; // YYYY-MM-DD
  right: "C" | "P" | null;
  strike: number | null;
}

export type TradeStatus = "closed" | "open";

export interface Trade {
  key: string;
  account: string;
  conid: string;
  symbol: string;
  underlying: string;
  description: string;
  contract: Contract;
  assetClass: string;
  multiplier: number;
  fills: FillWithState[];
  carryIn: boolean;
  status: TradeStatus;
  openAt: string;
  openDate: string;
  closeAt: string | null;
  closeDate: string | null;
  direction: "Long" | "Short";
  quantity: number;
  openQuantity: number;
  avgEntry: number | null;
  avgExit: number | null;
  commission: number;
  realizedPnl: number | null;
  profitPct: number | null;    // realized P&L as a % of entry notional (null when entry is unknown)
  zeroDte: boolean;
  holdMinutes: number | null;
}

export interface Rule { id: string; text: string; active: boolean; position: number }

/** Rule rating: 2 followed, 1 partly, 0 broken, -1 not applicable */
export type RatingValue = 2 | 1 | 0 | -1;

export interface Discipline {
  score: number | null;   // 0..100
  grade: "A" | "B" | "C" | "F" | null;
  rated: number;
  broken: string[];       // rule ids rated 0
}

export type PnlBand = "big-win" | "win" | "scratch" | "loss" | "big-loss" | "none";

export interface BandSettings { scratch: number; big: number }

/** A trade joined with the human side of the journal. */
export interface ReviewedTrade extends Trade {
  removed: boolean;
  lesson: boolean;
  lessonReviewComplete: boolean;
  discipline: Discipline;
}
