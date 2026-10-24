export const sql = `
-- Cloth is priced per METER. A than has a length (one decimal, stored in tenths of a meter: 44.5 m = 445).
-- A variant with a length is one length of a product (article + colour). Variants without a length behave exactly as before.
-- Prices of a variant that has a length (purchase_price, sale_price, wholesale_price) are per meter.
ALTER TABLE variants ADD COLUMN length_tenths INTEGER CHECK (length_tenths IS NULL OR length_tenths > 0);
CREATE INDEX variants_length ON variants(item_id, length_tenths);

-- Bill lines remember the length and the rate per meter, so a reprint always shows "9 x 20 m @ rate".
-- rate (per than) stays the amount that is multiplied by the quantity, as it always was.
ALTER TABLE sale_lines ADD COLUMN length_tenths INTEGER;
ALTER TABLE sale_lines ADD COLUMN rate_m INTEGER;
ALTER TABLE purchase_lines ADD COLUMN length_tenths INTEGER;
ALTER TABLE purchase_lines ADD COLUMN rate_m INTEGER;
`
