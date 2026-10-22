import { XMLParser } from "fast-xml-parser";
import { config } from "../config.js";

const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** IBKR error codes that mean "try again shortly" rather than "this is broken". */
const RETRYABLE = new Set(["1001", "1004", "1005", "1006", "1007", "1008", "1009", "1018", "1019", "1021"]);

interface FlexStatementResponse { Status?: string; ReferenceCode?: string; ErrorCode?: string; ErrorMessage?: string }

async function get(url: string) {
  const res = await fetch(url, { headers: { "User-Agent": "Logger/0.1" } });
  if (!res.ok) throw new Error(`IBKR Flex Web Service answered HTTP ${res.status}`);
  return res.text();
}

/**
 * Two-step Flex Web Service call: SendRequest returns a reference code, GetStatement returns the report.
 * IBKR allows 1 request per second and 10 per minute per token, so waits are generous.
 */
export async function fetchFlexStatement(queryId: string, token: string = config.flex.token, maxAttempts = 8): Promise<string> {
  const { baseUrl } = config.flex;
  if (!token || !queryId) throw new Error("Flex token or query ID is not set. Add FLEX_TOKEN and the query IDs to the environment.");
  const sendXml = await get(`${baseUrl}/SendRequest?t=${encodeURIComponent(token)}&q=${encodeURIComponent(queryId)}&v=3`);
  const send = (parser.parse(sendXml).FlexStatementResponse ?? {}) as FlexStatementResponse;
  if (send.Status !== "Success" || !send.ReferenceCode) {
    throw new Error(`IBKR refused the Flex request: ${send.ErrorCode ?? "?"} ${send.ErrorMessage ?? "no message"}`);
  }
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await sleep(Math.min(30_000, 3_000 * attempt));
    const body = await get(`${baseUrl}/GetStatement?t=${encodeURIComponent(token)}&q=${encodeURIComponent(send.ReferenceCode)}&v=3`);
    if (body.includes("<FlexQueryResponse")) return body;
    const err = (parser.parse(body).FlexStatementResponse ?? {}) as FlexStatementResponse;
    if (!err.ErrorCode || !RETRYABLE.has(String(err.ErrorCode))) {
      throw new Error(`IBKR could not return the statement: ${err.ErrorCode ?? "?"} ${err.ErrorMessage ?? "unexpected response"}`);
    }
  }
  throw new Error("IBKR was still generating the statement after several tries. The next scheduled run will pick it up.");
}
