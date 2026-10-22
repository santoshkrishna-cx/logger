-- 004: funding ledger. Deposits, withdrawals and internal transfers from the
-- Flex Activity report's Cash Transactions and Transfers sections.

CREATE TABLE cash_txns (
  id            text PRIMARY KEY,                 -- IBKR transactionID, or synthesized
  account_code  text NOT NULL REFERENCES accounts(code),
  txn_date      date NOT NULL,
  category      text NOT NULL,                    -- deposit|withdrawal|transfer_in|transfer_out|fee|interest|dividend|other
  amount        numeric NOT NULL,                 -- signed: + into the account, - out
  currency      text NOT NULL DEFAULT 'USD',
  counterparty  text,                             -- the other account, for internal transfers
  description   text,
  source        text NOT NULL,                    -- activity | file
  raw           jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cash_txns_account_date ON cash_txns (account_code, txn_date);
