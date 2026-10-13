export const sql = `
-- Optional product photo. Holds the base file name; the files live in the data folder's images/ directory.
ALTER TABLE variants ADD COLUMN image TEXT;
`
