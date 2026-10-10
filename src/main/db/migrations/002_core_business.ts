export const sql = /* sql */ `
-- A default warehouse always exists. It is hidden in V1 and only here so
-- branches/warehouses can be added later without changing stock tables.
CREATE TABLE warehouses (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1))
) STRICT;
INSERT INTO warehouses(id, name, is_default) VALUES (1, 'Main', 1);

CREATE TABLE cities (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
) STRICT;

-- ---------- Product master data: Company > Item > Variant ----------
CREATE TABLE companies (
  id     INTEGER PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
) STRICT;

-- Optional classification. parent_id NULL = category, otherwise subcategory.
CREATE TABLE categories (
  id        INTEGER PRIMARY KEY,
  name      TEXT NOT NULL COLLATE NOCASE,
  parent_id INTEGER REFERENCES categories(id),
  UNIQUE (parent_id, name)
) STRICT;

CREATE TABLE items (
  id          INTEGER PRIMARY KEY,
  company_id  INTEGER NOT NULL REFERENCES companies(id),
  category_id INTEGER REFERENCES categories(id),
  name        TEXT NOT NULL COLLATE NOCASE,
  code        TEXT,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  UNIQUE (company_id, name)
) STRICT;

CREATE TABLE variants (
  id              INTEGER PRIMARY KEY,
  item_id         INTEGER NOT NULL REFERENCES items(id),
  sku             TEXT UNIQUE,
  barcode         TEXT UNIQUE,
  color           TEXT,
  design          TEXT,
  size_label      TEXT,                       -- free text, e.g. '40 meter' or '180 ml'
  unit            TEXT NOT NULL DEFAULT 'piece',
  purchase_price  INTEGER NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
  sale_price      INTEGER NOT NULL DEFAULT 0 CHECK (sale_price >= 0),
  wholesale_price INTEGER CHECK (wholesale_price IS NULL OR wholesale_price >= 0),
  min_stock       INTEGER NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
) STRICT;
CREATE INDEX variants_item ON variants(item_id);

CREATE TABLE batches (
  id          INTEGER PRIMARY KEY,
  variant_id  INTEGER NOT NULL REFERENCES variants(id),
  batch_no    TEXT NOT NULL,
  mfg_date    TEXT,
  expiry_date TEXT,
  UNIQUE (variant_id, batch_no)
) STRICT;
CREATE INDEX batches_expiry ON batches(expiry_date);

-- ---------- Stock ----------
-- stock_levels is a cache maintained inside the same transaction as the movement.
-- stock_movements is the source of truth; reconcile() proves they agree.
CREATE TABLE stock_levels (
  variant_id   INTEGER NOT NULL REFERENCES variants(id),
  warehouse_id INTEGER NOT NULL DEFAULT 1 REFERENCES warehouses(id),
  qty          INTEGER NOT NULL DEFAULT 0,
  avg_cost     INTEGER NOT NULL DEFAULT 0 CHECK (avg_cost >= 0),
  value        INTEGER NOT NULL DEFAULT 0,               -- exact stock value in minor units (avg_cost is only a display/estimate)
  PRIMARY KEY (variant_id, warehouse_id)
) STRICT;

CREATE TABLE stock_movements (
  id           INTEGER PRIMARY KEY,
  ts           TEXT NOT NULL,
  variant_id   INTEGER NOT NULL REFERENCES variants(id),
  warehouse_id INTEGER NOT NULL DEFAULT 1 REFERENCES warehouses(id),
  batch_id     INTEGER REFERENCES batches(id),
  qty_delta    INTEGER NOT NULL CHECK (qty_delta <> 0),
  unit_cost    INTEGER NOT NULL CHECK (unit_cost >= 0),
  value        INTEGER NOT NULL DEFAULT 0,               -- exact value moved, same sign as qty_delta
  type         TEXT NOT NULL CHECK (type IN (
                 'opening','purchase','sale','sale_return','purchase_return',
                 'sale_void','purchase_void','damage','adjustment_in','adjustment_out')),
  source_type  TEXT,
  source_id    INTEGER,
  note         TEXT,
  user_id      INTEGER REFERENCES users(id)
) STRICT;
CREATE INDEX movements_variant ON stock_movements(variant_id, ts);
CREATE INDEX movements_source ON stock_movements(source_type, source_id);

-- ---------- Parties and suppliers ----------
CREATE TABLE parties (
  id                 INTEGER PRIMARY KEY,
  code               TEXT UNIQUE,
  name               TEXT NOT NULL,
  contact_person     TEXT,
  phone              TEXT,
  whatsapp           TEXT,
  city_id            INTEGER REFERENCES cities(id),
  area               TEXT,
  address            TEXT,
  notes              TEXT,
  credit_limit       INTEGER NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  payment_terms_days INTEGER CHECK (payment_terms_days IS NULL OR payment_terms_days >= 0),
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  is_walk_in         INTEGER NOT NULL DEFAULT 0 CHECK (is_walk_in IN (0,1)),
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE INDEX parties_city ON parties(city_id);
-- Exactly one walk-in party may exist.
CREATE UNIQUE INDEX parties_one_walk_in ON parties(is_walk_in) WHERE is_walk_in = 1;

CREATE TABLE suppliers (
  id                 INTEGER PRIMARY KEY,
  code               TEXT UNIQUE,
  name               TEXT NOT NULL,
  contact_person     TEXT,
  phone              TEXT,
  city_id            INTEGER REFERENCES cities(id),
  address            TEXT,
  notes              TEXT,
  payment_terms_days INTEGER CHECK (payment_terms_days IS NULL OR payment_terms_days >= 0),
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

-- ---------- Ledgers (balances are always derived) ----------
-- Customer balance (they owe us)  = SUM(debit) - SUM(credit)
-- Supplier balance (we owe them)  = SUM(credit) - SUM(debit)
CREATE TABLE ledger_entries (
  id          INTEGER PRIMARY KEY,
  ts          TEXT NOT NULL,
  party_kind  TEXT NOT NULL CHECK (party_kind IN ('customer','supplier')),
  party_id    INTEGER NOT NULL,
  debit       INTEGER NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit      INTEGER NOT NULL DEFAULT 0 CHECK (credit >= 0),
  kind        TEXT NOT NULL CHECK (kind IN (
                'opening','sale','sale_return','receipt','purchase','purchase_return',
                'payment','sale_void','purchase_void','adjustment')),
  source_type TEXT,
  source_id   INTEGER,
  description TEXT,
  user_id     INTEGER REFERENCES users(id),
  CHECK ((debit = 0) <> (credit = 0))
) STRICT;
CREATE INDEX ledger_party ON ledger_entries(party_kind, party_id, ts, id);
CREATE INDEX ledger_source ON ledger_entries(source_type, source_id);

-- ---------- Cash and bank ----------
CREATE TABLE accounts (
  id     INTEGER PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  type   TEXT NOT NULL CHECK (type IN ('cash','bank')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
) STRICT;

-- Positive = money in, negative = money out. Balance = SUM(amount).
CREATE TABLE account_entries (
  id          INTEGER PRIMARY KEY,
  ts          TEXT NOT NULL,
  account_id  INTEGER NOT NULL REFERENCES accounts(id),
  amount      INTEGER NOT NULL CHECK (amount <> 0),
  kind        TEXT NOT NULL CHECK (kind IN (
                'opening','sale_receipt','customer_receipt','supplier_payment','purchase_payment',
                'expense','transfer_in','transfer_out','void_reversal','refund','adjustment')),
  source_type TEXT,
  source_id   INTEGER,
  description TEXT,
  user_id     INTEGER REFERENCES users(id)
) STRICT;
CREATE INDEX account_entries_account ON account_entries(account_id, ts);
CREATE INDEX account_entries_source ON account_entries(source_type, source_id);

-- ---------- Sales ----------
CREATE TABLE sales (
  id          INTEGER PRIMARY KEY,
  invoice_no  TEXT NOT NULL UNIQUE,
  ts          TEXT NOT NULL,
  party_id    INTEGER NOT NULL REFERENCES parties(id),
  subtotal    INTEGER NOT NULL CHECK (subtotal >= 0),
  discount    INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total       INTEGER NOT NULL CHECK (total >= 0),
  paid        INTEGER NOT NULL DEFAULT 0 CHECK (paid >= 0),
  status      TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','void')),
  void_reason TEXT,
  voided_at   TEXT,
  voided_by   INTEGER REFERENCES users(id),
  notes       TEXT,
  user_id     INTEGER REFERENCES users(id),
  CHECK (total = subtotal - discount),
  CHECK (paid <= total)
) STRICT;
CREATE INDEX sales_party ON sales(party_id, ts);
CREATE INDEX sales_ts ON sales(ts);

CREATE TABLE sale_lines (
  id         INTEGER PRIMARY KEY,
  sale_id    INTEGER NOT NULL REFERENCES sales(id),
  variant_id INTEGER NOT NULL REFERENCES variants(id),
  qty        INTEGER NOT NULL CHECK (qty > 0),
  rate       INTEGER NOT NULL CHECK (rate >= 0),
  discount   INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
  line_total INTEGER NOT NULL CHECK (line_total >= 0),
  unit_cost  INTEGER NOT NULL CHECK (unit_cost >= 0),   -- cost snapshot for display
  cost_total INTEGER NOT NULL DEFAULT 0 CHECK (cost_total >= 0), -- exact cost of goods sold for this line
  size_label TEXT,                                      -- label snapshot for printing
  CHECK (line_total = qty * rate - discount)
) STRICT;
CREATE INDEX sale_lines_sale ON sale_lines(sale_id);
CREATE INDEX sale_lines_variant ON sale_lines(variant_id);

CREATE TABLE sale_payments (
  id         INTEGER PRIMARY KEY,
  sale_id    INTEGER NOT NULL REFERENCES sales(id),
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  method     TEXT NOT NULL,
  amount     INTEGER NOT NULL CHECK (amount > 0)
) STRICT;

-- ---------- Purchases ----------
CREATE TABLE purchases (
  id                  INTEGER PRIMARY KEY,
  purchase_no         TEXT NOT NULL UNIQUE,
  supplier_invoice_no TEXT,
  ts                  TEXT NOT NULL,
  supplier_id         INTEGER NOT NULL REFERENCES suppliers(id),
  subtotal            INTEGER NOT NULL CHECK (subtotal >= 0),
  discount            INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total               INTEGER NOT NULL CHECK (total >= 0),
  paid                INTEGER NOT NULL DEFAULT 0 CHECK (paid >= 0),
  status              TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','void')),
  void_reason         TEXT,
  voided_at           TEXT,
  voided_by           INTEGER REFERENCES users(id),
  notes               TEXT,
  user_id             INTEGER REFERENCES users(id),
  CHECK (total = subtotal - discount),
  CHECK (paid <= total)
) STRICT;
CREATE INDEX purchases_supplier ON purchases(supplier_id, ts);

CREATE TABLE purchase_lines (
  id          INTEGER PRIMARY KEY,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id),
  variant_id  INTEGER NOT NULL REFERENCES variants(id),
  qty         INTEGER NOT NULL CHECK (qty > 0),
  rate        INTEGER NOT NULL CHECK (rate >= 0),
  discount    INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
  line_total  INTEGER NOT NULL CHECK (line_total >= 0),
  batch_id    INTEGER REFERENCES batches(id),
  CHECK (line_total = qty * rate - discount)
) STRICT;
CREATE INDEX purchase_lines_purchase ON purchase_lines(purchase_id);

CREATE TABLE purchase_payments (
  id          INTEGER PRIMARY KEY,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id),
  account_id  INTEGER NOT NULL REFERENCES accounts(id),
  method      TEXT NOT NULL,
  amount      INTEGER NOT NULL CHECK (amount > 0)
) STRICT;

-- ---------- Standalone receipts (recovery) and supplier payments ----------
CREATE TABLE payments (
  id          INTEGER PRIMARY KEY,
  doc_no      TEXT NOT NULL UNIQUE,
  ts          TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('customer_receipt','supplier_payment')),
  party_id    INTEGER NOT NULL,          -- parties.id or suppliers.id depending on kind
  account_id  INTEGER NOT NULL REFERENCES accounts(id),
  method      TEXT NOT NULL,
  amount      INTEGER NOT NULL CHECK (amount > 0),
  reference   TEXT,
  notes       TEXT,
  received_by TEXT,
  status      TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','void')),
  user_id     INTEGER REFERENCES users(id)
) STRICT;
CREATE INDEX payments_party ON payments(kind, party_id, ts);
CREATE INDEX payments_ts ON payments(ts);

-- ---------- Expenses and transfers ----------
CREATE TABLE expense_categories (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
) STRICT;

CREATE TABLE expenses (
  id          INTEGER PRIMARY KEY,
  ts          TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES expense_categories(id),
  amount      INTEGER NOT NULL CHECK (amount > 0),
  account_id  INTEGER NOT NULL REFERENCES accounts(id),
  description TEXT,
  reference   TEXT,
  user_id     INTEGER REFERENCES users(id)
) STRICT;
CREATE INDEX expenses_ts ON expenses(ts);

-- A transfer moves money between accounts. It is neither income nor expense.
CREATE TABLE account_transfers (
  id              INTEGER PRIMARY KEY,
  ts              TEXT NOT NULL,
  from_account_id INTEGER NOT NULL REFERENCES accounts(id),
  to_account_id   INTEGER NOT NULL REFERENCES accounts(id),
  amount          INTEGER NOT NULL CHECK (amount > 0),
  note            TEXT,
  user_id         INTEGER REFERENCES users(id),
  CHECK (from_account_id <> to_account_id)
) STRICT;

-- ---------- Derived views ----------
CREATE VIEW v_customer_balance AS
  SELECT party_id, SUM(debit) - SUM(credit) AS balance
  FROM ledger_entries WHERE party_kind = 'customer' GROUP BY party_id;

CREATE VIEW v_supplier_balance AS
  SELECT party_id AS supplier_id, SUM(credit) - SUM(debit) AS balance
  FROM ledger_entries WHERE party_kind = 'supplier' GROUP BY party_id;

CREATE VIEW v_account_balance AS
  SELECT account_id, SUM(amount) AS balance FROM account_entries GROUP BY account_id;
`
