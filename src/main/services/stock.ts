import type { DB } from "../db/connection"
import { AppError } from "@core/errors"

export type MovementType =
  | "opening"
  | "purchase"
  | "sale"
  | "sale_return"
  | "purchase_return"
  | "sale_void"
  | "purchase_void"
  | "damage"
  | "adjustment_in"
  | "adjustment_out"

export interface MovementInput {
  variantId: number
  qtyDelta: number
  /** Required when stock increases. Ignored when it decreases (current average cost is used). */
  unitCost?: number
  type: MovementType
  sourceType?: string
  sourceId?: number
  note?: string
  userId: number | null
  ts: string
  warehouseId?: number
  batchId?: number | null
  allowNegative?: boolean
  /**
   * Exact value (minor units, positive) of the goods moved. When omitted, an increase is valued at
   * unitCost * qty and a decrease takes its exact share of the stock value (everything left when the
   * last unit leaves), so stock value and cost of goods always add up to the paisa.
   */
  value?: number
}

/**
 * The only way stock changes. Updates the stock_levels cache and appends a movement
 * in the caller's transaction. Returns the unit cost and the exact (positive) value moved.
 */
export function postMovement(db: DB, m: MovementInput): { unitCost: number; value: number } {
  if (!Number.isInteger(m.qtyDelta) || m.qtyDelta === 0) throw new AppError("VALIDATION", "Quantity must be a non-zero whole number")
  if (m.value !== undefined && (!Number.isSafeInteger(m.value) || m.value < 0)) throw new AppError("VALIDATION", "Invalid stock value")
  const warehouseId = m.warehouseId ?? 1

  const variant = db.prepare("SELECT id FROM variants WHERE id = ?").get(m.variantId)
  if (!variant) throw new AppError("NOT_FOUND", `Variant ${m.variantId} not found`)

  db.prepare("INSERT OR IGNORE INTO stock_levels(variant_id, warehouse_id, qty, avg_cost, value) VALUES (?,?,0,0,0)").run(m.variantId, warehouseId)
  const level = db.prepare("SELECT qty, avg_cost, value FROM stock_levels WHERE variant_id = ? AND warehouse_id = ?").get(m.variantId, warehouseId) as {
    qty: number
    avg_cost: number
    value: number
  }

  const qty = Math.abs(m.qtyDelta)
  let value: number
  if (m.qtyDelta < 0) {
    if (!m.allowNegative && level.qty + m.qtyDelta < 0) {
      throw new AppError("INSUFFICIENT_STOCK", `Only ${level.qty} in stock, ${qty} requested`, {
        variantId: m.variantId,
        available: level.qty,
        requested: qty,
      })
    }
    if (m.value !== undefined) value = m.value
    else if (level.qty <= 0) value = qty * level.avg_cost
    else if (qty >= level.qty) value = level.value
    else value = Math.round((level.value * qty) / level.qty)
  } else {
    if (m.value === undefined && (m.unitCost === undefined || !Number.isSafeInteger(m.unitCost) || m.unitCost < 0)) {
      throw new AppError("VALIDATION", "A unit cost is required when stock increases")
    }
    value = m.value ?? (m.unitCost as number) * qty
  }

  const newQty = level.qty + m.qtyDelta
  const newValue = level.value + (m.qtyDelta > 0 ? value : -value)
  const newAvg = newQty > 0 ? Math.max(0, Math.round(newValue / newQty)) : level.avg_cost
  const unitCost = m.qtyDelta > 0 && m.unitCost !== undefined ? m.unitCost : Math.round(value / qty)

  db.prepare("UPDATE stock_levels SET qty = ?, value = ?, avg_cost = ? WHERE variant_id = ? AND warehouse_id = ?").run(newQty, newValue, newAvg, m.variantId, warehouseId)
  db.prepare(
    `INSERT INTO stock_movements(ts, variant_id, warehouse_id, batch_id, qty_delta, unit_cost, value, type, source_type, source_id, note, user_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(m.ts, m.variantId, warehouseId, m.batchId ?? null, m.qtyDelta, unitCost, m.qtyDelta > 0 ? value : -value, m.type, m.sourceType ?? null, m.sourceId ?? null, m.note ?? null, m.userId)
  return { unitCost, value }
}
