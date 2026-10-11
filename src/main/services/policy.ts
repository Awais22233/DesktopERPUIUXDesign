import type { DB } from "../db/connection"
import { AppError } from "@core/errors"
import { can, requirePermission, type Actor } from "@core/permissions"
import { getSetting } from "../db/util"
import { FLAG_KEYS, type FlagKey } from "@shared/profiles"

export function isFlagEnabled(db: DB, flag: FlagKey): boolean {
  const row = db.prepare("SELECT enabled FROM feature_flags WHERE key = ?").get(flag) as { enabled: number } | undefined
  return row?.enabled === 1
}

export function assertFlag(db: DB, flag: FlagKey): void {
  if (!isFlagEnabled(db, flag)) throw new AppError("FEATURE_DISABLED", `The "${flag}" feature is turned off`)
}

export function businessDate(iso: string, db: DB): string {
  const offset = Number(getSetting(db, "timezone_offset_minutes", "300"))
  return new Date(new Date(iso).getTime() + offset * 60_000).toISOString().slice(0, 10)
}

/** Resolves the transaction timestamp and enforces the backdating permission. */
export function resolveTimestamp(db: DB, actor: Actor, requested: string | undefined, permission: "sale.backdate" | "ledger.adjust"): string {
  const now = new Date().toISOString()
  if (!requested) return now
  const ts = new Date(requested)
  if (Number.isNaN(ts.getTime())) throw new AppError("VALIDATION", "Invalid date")
  const iso = ts.toISOString()
  if (businessDate(iso, db) < businessDate(now, db)) requirePermission(actor, permission)
  return iso
}

export { can, requirePermission }
