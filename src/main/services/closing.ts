import type { DB } from "../db/connection"
import { AppError } from "@core/errors"
import { requirePermission, type Actor } from "@core/permissions"
import { audit, getSetting, tx } from "../db/util"
import { postMovement } from "./stock"

/** Start of a business day (local midnight) as a UTC instant, using the configured timezone offset. */
export function dayRange(db: DB, businessDate: string): { from: string; to: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) throw new AppError("VALIDATION", "Invalid date")
  const offset = Number(getSetting(db, "timezone_offset_minutes", "300"))
  const start = new Date(`${businessDate}T00:00:00Z`).getTime() - offset * 60_000
  return { from: new Date(start).toISOString(), to: new Date(start + 86_400_000).toISOString() }
}

export function postCashClosing(db: DB, actor: Actor, input: { accountId: number; businessDate: string; counted: number; notes?: string }) {
  requirePermission(actor, "cash.close")
  return tx(db, () => {
    if (!Number.isSafeInteger(input.counted) || input.counted < 0) throw new AppError("VALIDATION", "Enter the counted amount")
    if (!db.prepare("SELECT 1 FROM accounts WHERE id = ?").get(input.accountId)) throw new AppError("NOT_FOUND", "Account not found")
    if (db.prepare("SELECT 1 FROM cash_closings WHERE business_date = ? AND account_id = ?").get(input.businessDate, input.accountId)) {
      throw new AppError("INVALID_STATE", "This account is already closed for that day")
    }
    const { to } = dayRange(db, input.businessDate)
    const expected = (db.prepare("SELECT COALESCE(SUM(amount),0) AS b FROM account_entries WHERE account_id = ? AND ts < ?").get(input.accountId, to) as { b: number }).b
    const variance = input.counted - expected
    const id = Number(
      db
        .prepare("INSERT INTO cash_closings(ts, business_date, account_id, expected, counted, variance, notes, user_id) VALUES (?,?,?,?,?,?,?,?)")
        .run(new Date().toISOString(), input.businessDate, input.accountId, expected, input.counted, variance, input.notes ?? null, actor.userId).lastInsertRowid,
    )
    audit(db, actor.userId, "cash.close", "cash_closing", id, { date: input.businessDate, expected, counted: input.counted, variance })
    return { id, expected, counted: input.counted, variance }
  })
}

/** Physical count: records what was counted and posts an audited adjustment for every difference. */
export function postStockCount(db: DB, actor: Actor, input: { lines: { variantId: number; countedQty: number }[]; note?: string }) {
  requirePermission(actor, "stock.adjust")
  if (input.lines.length === 0) throw new AppError("VALIDATION", "Enter at least one counted item")
  return tx(db, () => {
    const ts = new Date().toISOString()
    const countId = Number(db.prepare("INSERT INTO stock_counts(ts, note, user_id) VALUES (?,?,?)").run(ts, input.note ?? null, actor.userId).lastInsertRowid)
    let adjusted = 0
    for (const l of input.lines) {
      if (!Number.isInteger(l.countedQty) || l.countedQty < 0) throw new AppError("VALIDATION", "Counted quantity must be a whole number, zero or more")
      const level = db.prepare("SELECT qty, avg_cost FROM stock_levels WHERE variant_id = ?").get(l.variantId) as { qty: number; avg_cost: number } | undefined
      const system = level?.qty ?? 0
      db.prepare("INSERT INTO stock_count_lines(count_id, variant_id, system_qty, counted_qty) VALUES (?,?,?,?)").run(countId, l.variantId, system, l.countedQty)
      const diff = l.countedQty - system
      if (diff !== 0) {
        postMovement(db, {
          variantId: l.variantId,
          qtyDelta: diff,
          unitCost: diff > 0 ? (level?.avg_cost ?? 0) : undefined,
          type: diff > 0 ? "adjustment_in" : "adjustment_out",
          sourceType: "stock_count",
          sourceId: countId,
          note: input.note ? `Stock count: ${input.note}` : "Stock count",
          userId: actor.userId,
          ts,
        })
        adjusted++
      }
    }
    audit(db, actor.userId, "stock.count", "stock_count", countId, { lines: input.lines.length, adjusted })
    return { countId, adjusted }
  })
}
