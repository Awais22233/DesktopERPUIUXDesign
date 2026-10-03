export const sql = /* sql */ `
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE TABLE feature_flags (
  key     TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL CHECK (enabled IN (0,1))
) STRICT;

CREATE TABLE roles (
  id        INTEGER PRIMARY KEY,
  name      TEXT NOT NULL UNIQUE,
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0,1))
) STRICT;

CREATE TABLE role_permissions (
  role_id    INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY (role_id, permission)
) STRICT;

CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role_id       INTEGER NOT NULL REFERENCES roles(id),
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

-- Append-only audit trail.
CREATE TABLE audit_log (
  id        INTEGER PRIMARY KEY,
  ts        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  user_id   INTEGER REFERENCES users(id),
  action    TEXT NOT NULL,
  entity    TEXT NOT NULL,
  entity_id TEXT,
  detail    TEXT
) STRICT;
CREATE INDEX audit_entity ON audit_log(entity, entity_id);
CREATE INDEX audit_ts ON audit_log(ts);
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

CREATE TABLE document_sequences (
  kind        TEXT PRIMARY KEY,
  prefix      TEXT NOT NULL,
  next_number INTEGER NOT NULL CHECK (next_number >= 1),
  padding     INTEGER NOT NULL DEFAULT 5
) STRICT;
INSERT INTO document_sequences(kind, prefix, next_number) VALUES
  ('sale','INV-',1), ('purchase','PUR-',1), ('receipt','RCT-',1), ('payment','PAY-',1),
  ('sale_return','SRT-',1), ('purchase_return','PRT-',1);
`
