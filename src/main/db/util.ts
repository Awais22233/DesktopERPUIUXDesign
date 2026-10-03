import type { DB } from "./connection"
import { AppError } from "@core/errors"

export function nowIso(): string {
  return new Date().toISOString()
}

/** Numbers are drawn inside the caller's transaction so a rollback never burns a number. */
export function nextDocNo(db: DB, kind: string): string {
  const row = db.prepare("SELECT prefix, next_number, padding FROM document_sequences WHERE kind = ?").get(kind) as
    | { prefix: string; next_number: number; padding: number }
    | undefined
  if (!row) throw new AppError("INTERNAL", `Unknown document sequence: ${kind}`)
  db.prepare("UPDATE document_sequences SET next_number = next_number + 1 WHERE kind = ?").run(kind)
  return row.prefix + String(row.next_number).padStart(row.padding, "0")
}

export function audit(
  db: DB,
  userId: number | null,
  action: string,
  entity: string,
  entityId: number | string | null,
  detail?: unknown,
): void {
  db.prepare("INSERT INTO audit_log(user_id, action, entity, entity_id, detail) VALUES (?,?,?,?,?)").run(
    userId,
    action,
    entity,
    entityId === null ? null : String(entityId),
    detail === undefined ? null : JSON.stringify(detail),
  )
}

export function getSetting(db: DB, key: string, fallback: string): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined
  return row?.value ?? fallback
}

export function setSetting(db: DB, key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings(key, value) VALUES (?,?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  ).run(key, value)
}

/** Runs fn in a single transaction (IMMEDIATE so writers queue instead of deadlocking). */
export function tx<T>(db: DB, fn: () => T): T {
  return db.transaction(fn).immediate()
}
