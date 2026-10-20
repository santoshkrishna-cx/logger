-- Tradelog initial schema. Fills come only from IBKR; people write only the journal side.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE accounts (
  code            text PRIMARY KEY,                 -- anilsub01 | anilsub02
  owner_name      text NOT NULL,
  ibkr_account_id text UNIQUE,                      -- U-number, learned on first import
  ibkr_alias      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  name          text,
  avatar_url    text,
  account_code  text NOT NULL REFERENCES accounts(code),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE TABLE fills (
  exec_id        text PRIMARY KEY,                  -- IBKR ibExecID / execID
  account_code   text NOT NULL REFERENCES accounts(code),
  conid          text NOT NULL,
  symbol         text NOT NULL,
  underlying     text NOT NULL,
  description    text NOT NULL,
  asset_class    text NOT NULL DEFAULT '',
  multiplier     numeric NOT NULL DEFAULT 1,
  executed_at_et timestamp NOT NULL,                -- exchange local time (America/New_York)
  trade_date     date NOT NULL,
  side           text NOT NULL CHECK (side IN ('BUY','SELL')),
  quantity       numeric NOT NULL,                  -- signed
  price          numeric NOT NULL,
  commission     numeric NOT NULL DEFAULT 0,
  net_cash       numeric NOT NULL,
  realized_pnl   numeric,                           -- null until the Activity report arrives
  open_close     text NOT NULL DEFAULT '' CHECK (open_close IN ('O','C','')),
  source         text NOT NULL CHECK (source IN ('trade-confirmation','activity','file')),
  raw            jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at    timestamptz NOT NULL DEFAULT now(),
  upgraded_at    timestamptz
);
CREATE INDEX fills_account_date ON fills (account_code, trade_date);
CREATE INDEX fills_conid_time ON fills (account_code, conid, executed_at_et);

CREATE TABLE account_days (
  account_code  text NOT NULL REFERENCES accounts(code),
  trade_date    date NOT NULL,
  opening_cash  numeric,
  ending_cash   numeric,
  nav           numeric,
  opening_cash_source text CHECK (opening_cash_source IN ('ibkr','manual')),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_code, trade_date)
);

CREATE TABLE open_positions (
  account_code    text NOT NULL REFERENCES accounts(code),
  report_date     date NOT NULL,
  conid           text NOT NULL,
  symbol          text NOT NULL,
  description     text NOT NULL,
  quantity        numeric NOT NULL,
  mark_price      numeric,
  position_value  numeric,
  cost_basis      numeric,
  unrealized_pnl  numeric,
  PRIMARY KEY (account_code, report_date, conid)
);

CREATE TABLE rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position    integer NOT NULL,
  text        text NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Journal is keyed by the derived trade key: account_conid_firstExecId
CREATE TABLE journal (
  trade_key      text PRIMARY KEY,
  account_code   text NOT NULL REFERENCES accounts(code),
  rationale      text,
  rationale_by   uuid REFERENCES users(id),
  rationale_at   timestamptz,
  review         text,
  review_by      uuid REFERENCES users(id),
  review_at      timestamptz,
  lesson         boolean,                           -- set by the reviewer
  lesson_text    text,                              -- the lesson, in one line
  removed        boolean NOT NULL DEFAULT false,
  removed_reason text,
  removed_by     uuid REFERENCES users(id),
  removed_at     timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rule_ratings (
  trade_key  text NOT NULL REFERENCES journal(trade_key) ON DELETE CASCADE,
  rule_id    uuid NOT NULL REFERENCES rules(id),
  value      smallint NOT NULL CHECK (value IN (-1, 0, 1, 2)),
  rated_by   uuid NOT NULL REFERENCES users(id),
  rated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trade_key, rule_id)
);

-- A trade with a lesson is complete only when both people have signed off.
CREATE TABLE lesson_reviews (
  trade_key        text PRIMARY KEY REFERENCES journal(trade_key) ON DELETE CASCADE,
  opened_at        timestamptz NOT NULL DEFAULT now(),
  trader_note      text,                            -- what the trader will do differently
  trader_ack_by    uuid REFERENCES users(id),
  trader_ack_at    timestamptz,
  reviewer_ack_by  uuid REFERENCES users(id),
  reviewer_ack_at  timestamptz,
  discussed_on     date,                            -- the day they went over it together
  completed_at     timestamptz
);

CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sync_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind           text NOT NULL CHECK (kind IN ('trade-confirmation','activity','file')),
  trigger        text NOT NULL CHECK (trigger IN ('schedule','manual','upload')),
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  status         text NOT NULL DEFAULT 'running' CHECK (status IN ('running','succeeded','failed')),
  fills_added    integer NOT NULL DEFAULT 0,
  fills_upgraded integer NOT NULL DEFAULT 0,
  error          text,
  started_by     uuid REFERENCES users(id)
);

CREATE TABLE audit_events (
  id         bigserial PRIMARY KEY,
  user_id    uuid REFERENCES users(id),
  entity     text NOT NULL,
  entity_id  text NOT NULL,
  action     text NOT NULL,
  before     jsonb,
  after      jsonb,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_entity ON audit_events (entity, entity_id);

-- Session store used by connect-pg-simple
CREATE TABLE "session" (
  sid    varchar NOT NULL PRIMARY KEY,
  sess   json NOT NULL,
  expire timestamp(6) NOT NULL
);
CREATE INDEX session_expire ON "session" (expire);

INSERT INTO accounts (code, owner_name, ibkr_alias) VALUES
  ('anilsub02', 'Santosh', 'anilsub02'),
  ('anilsub01', 'Anil', 'anilsub01');

INSERT INTO settings (key, value) VALUES
  ('pnl_bands', '{"scratch": 50, "big": 500}'),
  ('daily_loss_limit', '{"anilsub01": null, "anilsub02": null}'),
  ('revenge_window_minutes', '10'),
  ('lesson_review_due_days', '2');
