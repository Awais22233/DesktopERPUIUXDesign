import { createHash } from "node:crypto"
import type { DB } from "./connection"
import type { Migration } from "./migrations"

const checksum = (sql: string) => createHash("sha256").update(sql).digest("hex")

export interface MigrateOptions {
  /** Called once, before any pending migration runs, only when the database already holds data. */
  beforeMigrate?: (pending: Migration[]) => Promise<void> | void
}

export interface MigrateResult {
  applied: number[]
  version: number
}

export async function migrate(db: DB, list: Migration[], options: MigrateOptions = {}): Promise<MigrateResult> {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  ) STRICT`)

  const applied = db.prepare("SELECT id, name, checksum FROM schema_migrations ORDER BY id").all() as {
    id: number
    name: string
    checksum: string
  }[]

  const known = new Map(list.map((m) => [m.id, m]))
  for (const row of applied) {
    const m = known.get(row.id)
    if (!m) {
      throw new Error(
        `This database was created by a newer version of the application (migration ${row.id} "${row.name}" is unknown). Please install the latest version.`,
      )
    }
    if (checksum(m.sql) !== row.checksum) {
      throw new Error(`Migration ${row.id} "${row.name}" was modified after it was applied. Refusing to continue.`)
    }
  }

  const done = new Set(applied.map((r) => r.id))
  const pending = list.filter((m) => !done.has(m.id)).sort((a, b) => a.id - b.id)
  if (pending.length === 0) return { applied: [], version: applied.at(-1)?.id ?? 0 }

  if (applied.length > 0) await options.beforeMigrate?.(pending)

  const ran: number[] = []
  for (const m of pending) {
    // DDL is transactional in SQLite: a failing migration leaves the database untouched.
    db.exec("BEGIN IMMEDIATE")
    try {
      db.exec(m.sql)
      db.prepare("INSERT INTO schema_migrations(id, name, checksum) VALUES (?,?,?)").run(m.id, m.name, checksum(m.sql))
      db.exec("COMMIT")
      ran.push(m.id)
    } catch (err) {
      db.exec("ROLLBACK")
      throw new Error(`Migration ${m.id} "${m.name}" failed and was rolled back: ${(err as Error).message}`)
    }
  }
  return { applied: ran, version: ran.at(-1)! }
}
