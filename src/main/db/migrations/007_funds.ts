export const sql = `
-- Money coming into an account from somewhere that is not a customer: owner capital, a loan, other income.
-- It needs its own entry kind in the cash/bank book, and SQLite cannot change a CHECK, so the table is rebuilt.
DROP VIEW v_account_balance;
CREATE TABLE account_entries_new (
  id          INTEGER PRIMARY KEY,
  ts          TEXT NOT NULL,
  account_id  INTEGER NOT NULL REFERENCES accounts(id),
  amount      INTEGER NOT NULL CHECK (amount <> 0),
  kind        TEXT NOT NULL CHECK (kind IN (
                'opening','sale_receipt','customer_receipt','supplier_payment','purchase_payment',
                'expense','transfer_in','transfer_out','void_reversal','refund','adjustment','fund_in')),
  source_type TEXT,
  source_id   INTEGER,
  description TEXT,
  user_id     INTEGER REFERENCES users(id)
) STRICT;
INSERT INTO account_entries_new(id, ts, account_id, amount, kind, source_type, source_id, description, user_id)
  SELECT id, ts, account_id, amount, kind, source_type, source_id, description, user_id FROM account_entries;
DROP TABLE account_entries;
ALTER TABLE account_entries_new RENAME TO account_entries;
CREATE INDEX account_entries_account ON account_entries(account_id, ts);
CREATE INDEX account_entries_source ON account_entries(source_type, source_id);
CREATE VIEW v_account_balance AS
  SELECT account_id, SUM(amount) AS balance FROM account_entries GROUP BY account_id;

CREATE TABLE funds (
  id          INTEGER PRIMARY KEY,
  ts          TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('capital','loan','income','other')),
  amount      INTEGER NOT NULL CHECK (amount > 0),
  account_id  INTEGER NOT NULL REFERENCES accounts(id),
  from_name   TEXT,
  reference   TEXT,
  notes       TEXT,
  user_id     INTEGER REFERENCES users(id)
) STRICT;
CREATE INDEX funds_ts ON funds(ts);
`
