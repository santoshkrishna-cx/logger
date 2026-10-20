import type { Express, NextFunction, Request, Response } from "express";
import passport from "passport";
import { Strategy as GoogleStrategy, type Profile } from "passport-google-oauth20";
import { config } from "./config.js";
import { q } from "./db.js";

export interface SessionUser { id: string; email: string; name: string | null; avatarUrl: string | null; account: string }

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface User extends SessionUser {} }
}

/**
 * Google sign-in, restricted to the two addresses in ALLOWED_USERS.
 * Anyone else is turned away before a user row is ever created.
 */
export function setupAuth(app: Express) {
  passport.use(new GoogleStrategy(
    { clientID: config.google.clientId, clientSecret: config.google.clientSecret, callbackURL: config.google.callbackUrl, scope: ["openid", "email", "profile"] },
    async (_at: string, _rt: string, profile: Profile, done: (err: unknown, user?: Express.User | false, info?: { message: string }) => void) => {
      try {
        const email = profile.emails?.[0];
        const verified = (profile._json as { email_verified?: boolean }).email_verified ?? (email as { verified?: boolean } | undefined)?.verified;
        if (!email || verified === false) return done(null, false, { message: "unverified" });
        const address = email.value.toLowerCase();
        const account = config.allowedUsers.get(address);
        if (!account) return done(null, false, { message: "not-allowed" });
        const [row] = await q<{ id: string }>(
          `INSERT INTO users (email, name, avatar_url, account_code, last_login_at) VALUES ($1,$2,$3,$4, now())
           ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url, account_code = EXCLUDED.account_code, last_login_at = now()
           RETURNING id`,
          [address, profile.displayName ?? null, profile.photos?.[0]?.value ?? null, account]
        );
        done(null, { id: row.id, email: address, name: profile.displayName ?? null, avatarUrl: profile.photos?.[0]?.value ?? null, account });
      } catch (e) { done(e); }
    }
  ));

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id: string, done) => {
    try {
      const [u] = await q<{ id: string; email: string; name: string | null; avatar_url: string | null; account_code: string }>(
        "SELECT id, email, name, avatar_url, account_code FROM users WHERE id = $1", [id]);
      // Re-check the allow-list on every request so removing an address takes effect at once.
      if (!u || config.allowedUsers.get(u.email) !== u.account_code) return done(null, false);
      done(null, { id: u.id, email: u.email, name: u.name, avatarUrl: u.avatar_url, account: u.account_code });
    } catch (e) { done(e); }
  });

  app.use(passport.initialize());
  app.use(passport.session());

  app.get("/auth/google", passport.authenticate("google", { prompt: "select_account" }));
  app.get("/auth/google/callback", (req, res, next) => {
    passport.authenticate("google", (err: unknown, user: Express.User | false, info?: { message?: string }) => {
      if (err) return next(err);
      if (!user) return res.redirect(`/login?error=${encodeURIComponent(info?.message ?? "not-allowed")}`);
      req.logIn(user, e => (e ? next(e) : res.redirect("/")));
    })(req, res, next);
  });
  app.post("/auth/logout", (req, res, next) => {
    req.logout(err => {
      if (err) return next(err);
      req.session.destroy(() => res.status(204).end());
    });
  });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  res.status(401).json({ error: "Sign in with Google to continue." });
}
