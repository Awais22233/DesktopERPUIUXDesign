export const sql = /* sql */ `
-- ---------- Sale returns (also used for exchange) ----------
CREATE TABLE sale_returns (
  id         INTEGER PRIMARY KEY,
  return_no  TEXT NOT NULL UNIQUE,
  ts         TEXT NOT NULL,
  sale_id    INTEGER REFERENCES sales(id),          -- NULL only for an admin-approved return without invoice
  party_id   INTEGER NOT NULL REFERENCES parties(id),
  total      INTEGER NOT NULL CHECK (total > 0),
  refunded   INTEGER NOT NULL DEFAULT 0 CHECK (refunded >= 0),
  account_id INTEGER REFERENCES accounts(id),       -- account the cash refund was paid from
  reason     TEXT,
  user_id    INTEGER REFERENCES users(id),
  CHECK (refunded <= total)
) STRICT;
CREATE INDEX sale_returns_sale ON sale_returns(sale_id);
CREATE INDEX sale_returns_ts ON sale_returns(ts);

CREATE TABLE sale_return_lines (
  id           INTEGER PRIMARY KEY,
  return_id    INTEGER NOT NULL REFERENCES sale_returns(id),
  sale_line_id INTEGER REFERENCES sale_lines(id),
  variant_id   INTEGER NOT NULL REFERENCES variants(id),
  qty          INTEGER NOT NULL CHECK (qty > 0),
  amount       INTEGER NOT NULL CHECK (amount >= 0),   -- value credited to the party for this line
  unit_cost    INTEGER NOT NULL CHECK (unit_cost >= 0),
  cost_total   INTEGER NOT NULL DEFAULT 0 CHECK (cost_total >= 0), -- exact cost of the goods that came back
  damaged      INTEGER NOT NULL DEFAULT 0 CHECK (damaged IN (0,1))
) STRICT;
CREATE INDEX sale_return_lines_return ON sale_return_lines(return_id);
CREATE INDEX sale_return_lines_saleline ON sale_return_lines(sale_line_id);

-- ---------- Purchase returns ----------
CREATE TABLE purchase_returns (
  id          INTEGER PRIMARY KEY,
  return_no   TEXT NOT NULL UNIQUE,
  ts          TEXT NOT NULL,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id),
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  total       INTEGER NOT NULL CHECK (total > 0),
  refunded    INTEGER NOT NULL DEFAULT 0 CHECK (refunded >= 0),   -- cash received back from the supplier
  account_id  INTEGER REFERENCES accounts(id),
  reason      TEXT,
  user_id     INTEGER REFERENCES users(id),
  CHECK (refunded <= total)
) STRICT;

CREATE TABLE purchase_return_lines (
  id               INTEGER PRIMARY KEY,
  return_id        INTEGER NOT NULL REFERENCES purchase_returns(id),
  purchase_line_id INTEGER NOT NULL REFERENCES purchase_lines(id),
  variant_id       INTEGER NOT NULL REFERENCES variants(id),
  qty              INTEGER NOT NULL CHECK (qty > 0),
  amount           INTEGER NOT NULL CHECK (amount >= 0)
) STRICT;
CREATE INDEX purchase_return_lines_pl ON purchase_return_lines(purchase_line_id);

-- ---------- Daily cash closing ----------
CREATE TABLE cash_closings (
  id            INTEGER PRIMARY KEY,
  ts            TEXT NOT NULL,
  business_date TEXT NOT NULL,
  account_id    INTEGER NOT NULL REFERENCES accounts(id),
  expected      INTEGER NOT NULL,
  counted       INTEGER NOT NULL,
  variance      INTEGER NOT NULL,
  notes         TEXT,
  user_id       INTEGER REFERENCES users(id),
  UNIQUE (business_date, account_id),
  CHECK (variance = counted - expected)
) STRICT;

-- ---------- Physical stock count ----------
CREATE TABLE stock_counts (
  id      INTEGER PRIMARY KEY,
  ts      TEXT NOT NULL,
  note    TEXT,
  user_id INTEGER REFERENCES users(id)
) STRICT;

CREATE TABLE stock_count_lines (
  id          INTEGER PRIMARY KEY,
  count_id    INTEGER NOT NULL REFERENCES stock_counts(id),
  variant_id  INTEGER NOT NULL REFERENCES variants(id),
  system_qty  INTEGER NOT NULL,
  counted_qty INTEGER NOT NULL CHECK (counted_qty >= 0)
) STRICT;
CREATE INDEX stock_count_lines_count ON stock_count_lines(count_id);

INSERT INTO document_sequences(kind, prefix, next_number) VALUES ('expense','EXP-',1), ('transfer','TRF-',1);
`
