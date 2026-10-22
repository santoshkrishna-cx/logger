-- 003: multi-group (masthead) support.
-- Each group is one IBKR master with its own Flex credentials (in the environment).
-- Accounts belong to a group; fills stay account-scoped, so groups layer cleanly on top.

CREATE TABLE groups (
  code       text PRIMARY KEY,                 -- shikharam | santoshodc
  name       text NOT NULL,
  masthead   text,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO groups (code, name, masthead) VALUES
  ('shikharam',  'Shikharam LLC', 'Shikharam LLC'),
  ('santoshodc', 'Santosh ODC',   'ODC');

-- Attach existing accounts to the original master.
ALTER TABLE accounts ADD COLUMN group_code text REFERENCES groups(code);
UPDATE accounts SET group_code = 'shikharam' WHERE group_code IS NULL;

-- ODC master's sub-account (Santosh), U-number already known so no mapping step needed.
INSERT INTO accounts (code, owner_name, ibkr_account_id, group_code) VALUES
  ('odcsub01', 'Santosh', 'U5275227', 'santoshodc')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE accounts ALTER COLUMN group_code SET NOT NULL;

-- Record which group a sync run pulled from.
ALTER TABLE sync_runs ADD COLUMN group_code text REFERENCES groups(code);
