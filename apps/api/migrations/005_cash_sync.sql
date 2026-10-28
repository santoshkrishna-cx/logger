-- 005: 'cash' sync kind — a daily Flex query carrying only the Cash
-- Transactions and Transfers sections (deposits and internal transfers).

ALTER TABLE sync_runs DROP CONSTRAINT sync_runs_kind_check;
ALTER TABLE sync_runs ADD CONSTRAINT sync_runs_kind_check CHECK (kind IN ('trade-confirmation','activity','cash','file'));

ALTER TABLE fills DROP CONSTRAINT fills_source_check;
ALTER TABLE fills ADD CONSTRAINT fills_source_check CHECK (source IN ('trade-confirmation','activity','cash','file'));
