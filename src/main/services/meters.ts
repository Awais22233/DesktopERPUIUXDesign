import type { DB } from "../db/connection"
import { AppError } from "@core/errors"

/** Meters typed by a person (one decimal at most) to the whole number of tenths kept in the database. */
export function toTenths(meters: number): number {
  const t = Math.round(meters * 10)
  if (!Number.isFinite(meters) || Math.abs(meters * 10 - t) > 1e-6) throw new AppError("VALIDATION", "Length can have only one decimal, e.g. 44.5")
  if (t <= 0 || t > 100_000) throw new AppError("VALIDATION", "Length must be between 0.1 and 10,000 meters")
  return t
}

/** 400 -> "40", 445 -> "44.5" */
export function fmtMeters(tenths: number): string {
  return tenths % 10 === 0 ? String(tenths / 10) : (tenths / 10).toFixed(1)
}

export const lengthLabel = (tenths: number) => `${fmtMeters(tenths)} meter`

/** Price of one than from the price of one meter (both in paisa; the result is rounded to the paisa). */
export const perThan = (ratePerMeter: number, tenths: number) => Math.round((ratePerMeter * tenths) / 10)

interface VariantRow {
  id: number
  item_id: number
  color: string | null
  design: string | null
  length_tenths: number | null
}

/**
 * The variant of this product (article + colour + design) that has the given length.
 * Finds the existing one, uses the product's own empty variant when it has no length yet, or creates the length.
 * Called inside the caller's transaction.
 */
export function variantForLength(db: DB, variantId: number, tenths: number): number {
  const base = db.prepare("SELECT id, item_id, color, design, length_tenths FROM variants WHERE id = ?").get(variantId) as VariantRow | undefined
  if (!base) throw new AppError("NOT_FOUND", `Variant ${variantId} not found`)
  if (base.length_tenths === tenths) return base.id
  const sibling = db
    .prepare("SELECT id FROM variants WHERE item_id = ? AND COALESCE(color,'') = COALESCE(?, '') AND COALESCE(design,'') = COALESCE(?, '') AND length_tenths = ? ORDER BY active DESC, id LIMIT 1")
    .get(base.item_id, base.color, base.design, tenths) as { id: number } | undefined
  if (sibling) return sibling.id
  const used =
    db.prepare("SELECT 1 FROM stock_movements WHERE variant_id = ? LIMIT 1").get(base.id) ||
    db.prepare("SELECT 1 FROM sale_lines WHERE variant_id = ? LIMIT 1").get(base.id) ||
    db.prepare("SELECT 1 FROM purchase_lines WHERE variant_id = ? LIMIT 1").get(base.id)
  if (base.length_tenths === null && !used) {
    db.prepare("UPDATE variants SET length_tenths = ?, size_label = ? WHERE id = ?").run(tenths, lengthLabel(tenths), base.id)
    return base.id
  }
  return Number(
    db
      .prepare(
        `INSERT INTO variants(item_id, color, design, size_label, length_tenths, unit, purchase_price, sale_price, wholesale_price, min_stock, image)
         SELECT item_id, color, design, ?, ?, unit, purchase_price, sale_price, wholesale_price, 0, image FROM variants WHERE id = ?`,
      )
      .run(lengthLabel(tenths), tenths, base.id).lastInsertRowid,
  )
}
