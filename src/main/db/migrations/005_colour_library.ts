export const sql = `
-- The colour library: each colour is written once, so "Navy Blue" is never typed three different ways.
-- Products keep the colour as plain text (variants.color); this table is the list they are chosen from.
CREATE TABLE colours (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(name)) > 0),
  hex   TEXT CHECK (hex IS NULL OR hex GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]')
) STRICT;

-- Every colour already used by a product goes into the library (first spelling wins, case ignored).
INSERT OR IGNORE INTO colours(name) SELECT trim(color) FROM variants WHERE trim(COALESCE(color, '')) <> '' ORDER BY id;
`
