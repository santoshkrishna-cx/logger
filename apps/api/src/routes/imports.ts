import { parseFlex } from "@tradelog/core";
import express, { Router } from "express";
import { z } from "zod";
import { q } from "../db.js";
import { HttpError, ah } from "../http.js";
import { ingest } from "../services/ingest.js";

export const importsRouter = Router();

/**
 * Manual import of a Flex report file. POST the file body as text.
 * ?commit=false returns a preview; ?commit=true writes. mapping is a JSON object of U-number -> account code.
 */
importsRouter.post("/imports", express.text({ type: () => true, limit: "20mb" }), ah(async (req, res) => {
  const { commit, mapping } = z.object({
    commit: z.enum(["true", "false"]).default("false").transform(v => v === "true"),
    mapping: z.string().optional().transform(v => (v ? (JSON.parse(v) as Record<string, string>) : {}))
  }).parse(req.query);
  if (typeof req.body !== "string" || !req.body.trim()) throw new HttpError(400, "The file was empty. Export the Flex report again and retry.");
  let report;
  try { report = parseFlex(req.body); } catch (e) { throw new HttpError(400, (e as Error).message); }
  if (!report.fills.length) throw new HttpError(400, "No executions found. Check that the Flex Query includes Trades at execution level.");
  let runId: string | null = null;
  if (commit) [{ id: runId }] = await q<{ id: string }>("INSERT INTO sync_runs (kind, trigger, started_by) VALUES ('file','upload',$1) RETURNING id", [req.user!.id]);
  const result = await ingest(report, "file", { commit, mapping });
  if (runId) await q("UPDATE sync_runs SET status='succeeded', finished_at=now(), fills_added=$2, fills_upgraded=$3 WHERE id=$1", [runId, result.added, result.upgraded]);
  res.json(result);
}));
