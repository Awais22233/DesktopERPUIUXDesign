import type { DB } from "../db/connection"
import { AppError } from "@core/errors"
import { weightedAverage } from "@core/money"

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
}

/**
 * The only way stock changes. Updates the stock_levels cache and appends a movement
 * in the caller's transaction. Returns the unit cost that was recorded.
 */
export function postMovement(db: DB, m: MovementInput): { unitCost: number } {
  if (!Number.isInteger(m.qtyDelta) || m.qtyDelta === 0) throw new AppError("VALIDATION", "Quantity must be a non-zero whole number")
  const warehouseId = m.warehouseId ?? 1

  const variant = db.prepare("SELECT id FROM variants WHERE id = ?").get(m.variantId)
  if (!variant) throw new AppError("NOT_FOUND", `Variant ${m.variantId} not found`)

  db.prepare("INSERT OR IGNORE INTO stock_levels(variant_id, warehouse_id, qty, avg_cost) VALUES (?,?,0,0)").run(m.variantId, warehouseId)
  const level = db.prepare("SELECT qty, avg_cost FROM stock_levels WHERE variant_id = ? AND warehouse_id = ?").get(m.variantId, warehouseId) as {
    qty: number
    avg_cost: number
  }

  let unitCost: number
  let newAvg = level.avg_cost
  if (m.qtyDelta < 0) {
    if (!m.allowNegative && level.qty + m.qtyDelta < 0) {
      throw new AppError("INSUFFICIENT_STOCK", `Only ${level.qty} in stock, ${-m.qtyDelta} requested`, {
        variantId: m.variantId,
        available: level.qty,
        requested: -m.qtyDelta,
      })
    }
    unitCost = level.avg_cost
  } else {
    if (m.unitCost === undefined || !Number.isSafeInteger(m.unitCost) || m.unitCost < 0) {
      throw new AppError("VALIDATION", "A unit cost is required when stock increases")
    }
    unitCost = m.unitCost
    newAvg = weightedAverage(level.qty, level.avg_cost, m.qtyDelta, unitCost)
  }

  db.prepare("UPDATE stock_levels SET qty = qty + ?, avg_cost = ? WHERE variant_id = ? AND warehouse_id = ?").run(
    m.qtyDelta,
    newAvg,
    m.variantId,
    warehouseId,
  )
  db.prepare(
    `INSERT INTO stock_movements(ts, variant_id, warehouse_id, batch_id, qty_delta, unit_cost, type, source_type, source_id, note, user_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(m.ts, m.variantId, warehouseId, m.batchId ?? null, m.qtyDelta, unitCost, m.type, m.sourceType ?? null, m.sourceId ?? null, m.note ?? null, m.userId)
  return { unitCost }
}
