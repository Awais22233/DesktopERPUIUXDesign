export const sql = `
-- The shop's own people who carry bills and collect money: salesmen and recovery persons.
-- They are not program users; they only appear (name and phone) on bills.
CREATE TABLE staff (
  id     INTEGER PRIMARY KEY,
  name   TEXT NOT NULL COLLATE NOCASE,
  phone  TEXT,
  role   TEXT NOT NULL CHECK (role IN ('salesman','recovery','both')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
) STRICT;
-- Each customer can have a usual salesman and a usual recovery person; the bill is prefilled from them.
ALTER TABLE parties ADD COLUMN salesman_id INTEGER REFERENCES staff(id);
ALTER TABLE parties ADD COLUMN recovery_id INTEGER REFERENCES staff(id);
-- A bill keeps the name and phone as they were when it was made, so a reprint never changes.
ALTER TABLE sales ADD COLUMN booked_by TEXT;
ALTER TABLE sales ADD COLUMN booked_phone TEXT;
ALTER TABLE sales ADD COLUMN recovery_by TEXT;
ALTER TABLE sales ADD COLUMN recovery_phone TEXT;
`
