import type { BandSettings, CashDay, PnlBand, RatingValue, Rule, Trade, Discipline } from "@logger/core";

// "all" | "g:<groupCode>" | "p:<ownerName>" | "<accountCode>"
export type Scope = string;

export interface Me {
  user: { id: string; email: string; name: string | null; avatarUrl: string | null; account: string };
  accounts: { code: string; ownerName: string; groupCode: string }[];
  groups: { code: string; name: string }[];
}

export interface LessonReview { traderNote: string | null; traderAckAt: string | null; reviewerAckAt: string | null; discussedOn: string | null; completedAt: string | null; openedAt: string; overdue: boolean; waitingOn: ("trader" | "reviewer")[] }

export interface TradeView extends Trade {
  owner: string; reviewer: string; band: PnlBand; removed: boolean; lesson: boolean; lessonReviewComplete: boolean; discipline: Discipline;
  ratings: Record<string, RatingValue>;
  lessonReview: LessonReview | null;
  journal: { rationale: string | null; rationaleAt: string | null; review: string | null; reviewAt: string | null; lesson: boolean | null; lessonText: string | null; removed: boolean; removedReason: string | null; removedAt: string | null };
}

export interface LogDay {
  date: string;
  sections: { roundTrips: TradeView[]; carriedIn: TradeView[]; stillOpen: TradeView[]; removed: TradeView[] };
  summary: { realized: Record<string, number>; total: number; trades: number; wins: number; discipline: number | null; awaitingReview: number; openLessons: number };
  cash: CashDay[];
  nav: Record<string, number>;
  rules: Rule[];
  bands: BandSettings;
}

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

async function request<T>(method: string, path: string, body?: unknown, raw?: string): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: raw !== undefined ? { "content-type": "text/plain" } : body !== undefined ? { "content-type": "application/json" } : {},
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined
  });
  if (res.status === 401 && !location.pathname.startsWith("/login")) { location.href = "/login"; throw new ApiError(401, "Sign in to continue."); }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  put: <T = void>(path: string, body: unknown) => request<T>("PUT", path, body),
  post: <T = void>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  patch: <T = void>(path: string, body: unknown) => request<T>("PATCH", path, body),
  upload: <T>(path: string, text: string) => request<T>("POST", path, undefined, text),
  logout: () => fetch("/auth/logout", { method: "POST", credentials: "same-origin" }).then(() => (location.href = "/login"))
};

export const qs = (o: Record<string, string | undefined>) =>
  "?" + Object.entries(o).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join("&");
