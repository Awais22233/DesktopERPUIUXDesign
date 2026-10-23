import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
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

/**
 * Copies one backup to an outside folder (USB drive, second disk, Google Drive folder).
 * The copy is written under a temporary name, checked, and only then given its real name, so an unplugged
 * drive or a power cut can never leave a half-written file that looks like a good backup.
 */
export function copyToSecondary(file: string, secondaryDir: string): string {
  mkdirSync(secondaryDir, { recursive: true })
  const name = file.split(/[\\/]/).pop()!
  const dest = join(secondaryDir, name)
  const part = `${dest}.part`
  try {
    copyFileSync(file, part)
    if (statSync(part).size !== statSync(file).size) throw new Error("The copy is incomplete (the drive may be full or was removed)")
    const check = verifyBackup(part)
    if (!check.ok) throw new Error(`The copy did not pass the safety check: ${check.problems.join("; ")}`)
    renameSync(part, dest)
  } catch (err) {
    rmSync(part, { force: true })
    throw err
  }
  return dest
}

const dayKey = (name: string) => name.slice(7, 15) // backup-YYYYMMDD-...
function weekKey(name: string): string {
  const y = +name.slice(7, 11), m = +name.slice(11, 13), d = +name.slice(13, 15)
  const t = Date.UTC(y, m - 1, d)
  const monday = new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * 86_400_000)
  return monday.toISOString().slice(0, 10)
}
const monthKey = (name: string) => name.slice(7, 13)

export interface Retention {
  days: number
  weeks: number
  months: number
}
export const DEFAULT_RETENTION: Retention = { days: 14, weeks: 8, months: 12 }

/**
 * Grandfather-father-son: which backups to keep. The newest backup of each of the last `days` days,
 * of each of the last `weeks` weeks, and of each of the last `months` months. Everything else may go.
 * One bad day (a mistake, a virus) can therefore never replace every good copy.
 */
export function selectKeep(names: string[], r: Retention = DEFAULT_RETENTION): Set<string> {
  const newestFirst = [...names].sort((a, b) => b.localeCompare(a))
  const keep = new Set<string>()
  const tier = (key: (n: string) => string, count: number) => {
    const seen = new Set<string>()
    for (const n of newestFirst) {
      const k = key(n)
      if (seen.has(k)) continue
      if (seen.size >= count) break
      seen.add(k)
      keep.add(n)
    }
  }
  tier(dayKey, r.days)
  tier(weekKey, r.weeks)
  tier(monthKey, r.months)
  if (newestFirst[0]) keep.add(newestFirst[0])
  return keep
}

/** Applies `selectKeep` to a folder. Returns the files removed. Never touches pre-migrate / pre-restore safety copies. */
export function pruneRotation(dir: string, r: Retention = DEFAULT_RETENTION): string[] {
  const all = listBackups(dir).filter((b) => !/-(pre-migrate|pre-restore)\.db$/.test(b.name))
  const keep = selectKeep(all.map((b) => b.name), r)
  const removed: string[] = []
  for (const b of all) {
    if (keep.has(b.name)) continue
    rmSync(b.file, { force: true })
    removed.push(b.file)
  }
  return removed
}

/** Removes leftovers of interrupted copies. */
export function cleanPartials(dir: string): void {
  if (!existsSync(dir)) return
  for (const n of readdirSync(dir)) if (/^backup-.*\.db\.part$/.test(n)) rmSync(join(dir, n), { force: true })
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

/** "Test" button: can we really write to this folder and read it back? Leaves nothing behind. */
export function testFolderWritable(dir: string): { ok: boolean; message: string } {
  if (!dir) return { ok: false, message: "No folder has been chosen" }
  if (!existsSync(dir)) return { ok: false, message: "The folder or drive is not connected right now" }
  const probe = join(dir, `.erp-write-test-${process.pid}`)
  try {
    const token = `ok-${Date.now()}`
    writeFileSync(probe, token)
    if (readFileSync(probe, "utf8") !== token) return { ok: false, message: "The folder did not return what was written to it" }
    return { ok: true, message: "Working. Backups can be copied here." }
  } catch (err) {
    const code = (err as { code?: string }).code
    return { ok: false, message: code === "EACCES" || code === "EPERM" || code === "EROFS" ? "This folder is read-only or not allowed" : `Cannot write to this folder: ${(err as Error).message}` }
  } finally {
    rmSync(probe, { force: true })
  }
}
