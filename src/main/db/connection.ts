import Database from "better-sqlite3"

export type DB = Database.Database

/**
 * Opens the business database with settings chosen for safety over speed:
 * WAL + synchronous=FULL means a committed transaction survives sudden power loss.
 */
export function openDatabase(file: string, options: { readonly?: boolean } = {}): DB {
  const db = new Database(file, { readonly: options.readonly ?? false, fileMustExist: options.readonly ?? false })
  if (!options.readonly) {
    db.pragma("journal_mode = WAL")
    db.pragma("synchronous = FULL")
  }
  db.pragma("foreign_keys = ON")
  db.pragma("busy_timeout = 5000")
  return db
}

export interface IntegrityReport {
  ok: boolean
  problems: string[]
}

export function integrityCheck(db: DB): IntegrityReport {
  const problems: string[] = []
  const rows = db.pragma("integrity_check") as { integrity_check: string }[]
  for (const r of rows) if (r.integrity_check !== "ok") problems.push(r.integrity_check)
  const fk = db.pragma("foreign_key_check") as unknown[]
  if (fk.length > 0) problems.push(`${fk.length} foreign key violation(s)`)
  return { ok: problems.length === 0, problems }
}
