import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs"
import { join } from "node:path"
import { integrityCheck, openDatabase, type DB } from "./connection"

const PATTERN = /^backup-\d{8}-\d{6}-[a-z0-9_-]+\.db$/

export interface VerifyResult {
  ok: boolean
  problems: string[]
  schemaVersion: number
}

export function verifyBackup(file: string): VerifyResult {
  if (!existsSync(file)) return { ok: false, problems: ["File not found"], schemaVersion: 0 }
  let db: DB | undefined
  try {
    db = openDatabase(file, { readonly: true })
    const report = integrityCheck(db)
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get()
    if (!table) return { ok: false, problems: [...report.problems, "Not a business database"], schemaVersion: 0 }
    const v = db.prepare("SELECT COALESCE(MAX(id),0) AS v FROM schema_migrations").get() as { v: number }
    return { ok: report.ok, problems: report.problems, schemaVersion: v.v }
  } catch (err) {
    return { ok: false, problems: [(err as Error).message], schemaVersion: 0 }
  } finally {
    db?.close()
  }
}

function stamp(d: Date): string {
  const p = (n: number, l = 2) => String(n).padStart(l, "0")
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
}

/** Consistent online backup using SQLite's backup API, verified before it is reported as successful. */
export async function createBackup(db: DB, dir: string, reason: string, now = new Date()): Promise<string> {
  mkdirSync(dir, { recursive: true })
  const safeReason = reason.toLowerCase().replace(/[^a-z0-9_-]/g, "-")
  const dest = join(dir, `backup-${stamp(now)}-${safeReason}.db`)
  await db.backup(dest)
  // A backup must be ONE self-contained file: switch the copy out of WAL mode so no -wal/-shm
  // sidecars exist (otherwise copying just the .db to a USB drive could silently lose data).
  const copy = openDatabase(dest)
  try {
    copy.pragma("journal_mode = DELETE")
  } finally {
    copy.close()
  }
  const check = verifyBackup(dest)
  if (!check.ok) {
    rmSync(dest, { force: true })
    throw new Error(`Backup verification failed: ${check.problems.join("; ")}`)
  }
  return dest
}

export interface BackupInfo {
  file: string
  name: string
  size: number
  modified: string
}

export function listBackups(dir: string): BackupInfo[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((n) => PATTERN.test(n))
    .map((name) => {
      const file = join(dir, name)
      const st = statSync(file)
      return { file, name, size: st.size, modified: st.mtime.toISOString() }
    })
    .sort((a, b) => b.name.localeCompare(a.name))
}

/** Keeps the newest `keep` automatic backups. Pre-migrate and pre-restore backups are never pruned. */
export function pruneBackups(dir: string, keep: number): string[] {
  const removable = listBackups(dir).filter((b) => !/-(pre-migrate|pre-restore)\.db$/.test(b.name))
  const removed: string[] = []
  for (const b of removable.slice(keep)) {
    rmSync(b.file, { force: true })
    removed.push(b.file)
  }
  return removed
}

export function copyToSecondary(file: string, secondaryDir: string): string {
  mkdirSync(secondaryDir, { recursive: true })
  const dest = join(secondaryDir, file.split(/[\\/]/).pop()!)
  copyFileSync(file, dest)
  return dest
}

/**
 * Replaces the live database with a verified backup. The caller must have closed the live
 * database first. A safety copy of the current file is kept so restore itself is reversible.
 */
export function restoreBackup(backupFile: string, liveFile: string, safetyDir: string, now = new Date()): string | null {
  const check = verifyBackup(backupFile)
  if (!check.ok) throw new Error(`Backup is not valid: ${check.problems.join("; ")}`)
  mkdirSync(safetyDir, { recursive: true })
  let safety: string | null = null
  if (existsSync(liveFile)) {
    safety = join(safetyDir, `backup-${stamp(now)}-pre-restore.db`)
    copyFileSync(liveFile, safety)
  }
  copyFileSync(backupFile, liveFile)
  rmSync(`${liveFile}-wal`, { force: true })
  rmSync(`${liveFile}-shm`, { force: true })
  return safety
}
