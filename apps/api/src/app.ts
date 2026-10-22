import connectPg from "connect-pg-simple";
import express from "express";
import session from "express-session";
import helmet from "helmet";
import { requireAuth, setupAuth } from "./auth.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { errorHandler } from "./http.js";
import { analyticsRouter } from "./routes/analytics.js";
import { calendarRouter } from "./routes/calendar.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { importsRouter } from "./routes/imports.js";
import { journalRouter } from "./routes/journal.js";
import { lessonsRouter } from "./routes/lessons.js";
import { logRouter } from "./routes/log.js";
import { meRouter } from "./routes/me.js";
import { rulesRouter } from "./routes/rules.js";
import { settingsRouter } from "./routes/settings.js";
import { syncRouter } from "./routes/sync.js";

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: "1mb" }));

  const PgStore = connectPg(session);
  app.use(session({
    store: new PgStore({ pool, tableName: "session" }),
    secret: config.sessionSecret,
    name: "logger.sid",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax", secure: config.cookieSecure, maxAge: 30 * 864e5 }
  }));
  setupAuth(app);

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api", requireAuth);
  app.use("/api", meRouter);
  app.use("/api", logRouter);
  app.use("/api", journalRouter);
  app.use("/api", lessonsRouter);
  app.use("/api", rulesRouter);
  app.use("/api", dashboardRouter);
  app.use("/api", analyticsRouter);
  app.use("/api", calendarRouter);
  app.use("/api", importsRouter);
  app.use("/api", syncRouter);
  app.use("/api", settingsRouter);
  app.use(errorHandler);
  return app;
}
