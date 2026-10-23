import { existsSync, readdirSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { BackupSummary, RestoreCandidate } from "@shared/ipc"
import { openDatabase, type DB } from "./connection"
import { listBackups, verifyBackup } from "./backup"

const BACKUP_FILE = /^backup-\d{8}-\d{6}-[a-z0-9_-]+\.db$/

export interface Counts {
  sales: number
  purchases: number
  customers: number
  products: number
  receivable: number
  latestEntry: string | null
}

/** The headline numbers of a database, used to show what a backup contains. */
export function countsOf(db: DB): Counts {
  const n = (sql: string) => (db.prepare(sql).get() as { v: number }).v
  return {
    sales: n("SELECT COUNT(*) v FROM sales"),
    purchases: n("SELECT COUNT(*) v FROM purchases"),
    customers: n("SELECT COUNT(*) v FROM parties WHERE is_walk_in = 0"),
    products: n("SELECT COUNT(*) v FROM variants"),
    receivable: n("SELECT COALESCE(SUM(debit) - SUM(credit), 0) v FROM ledger_entries WHERE party_kind = 'customer'") / 100,
    latestEntry: (db.prepare("SELECT MAX(ts) v FROM ledger_entries").get() as { v: string | null }).v,
  }
}

function setting(db: DB, key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined
  return row?.value ?? null
}

/** Opens a backup read-only and reports what is inside it. */
export function summarizeBackup(file: string, name: string, where: string, createdAt: string): BackupSummary {
  const check = verifyBackup(file)
  const base = { name, where, createdAt, ok: check.ok, problems: check.problems }
  if (!check.ok) return { ...base, sales: 0, purchases: 0, customers: 0, products: 0, receivable: 0, latestEntry: null }
  const db = openDatabase(file, { readonly: true })
  try {
    return { ...base, ...countsOf(db) }
  } catch (err) {
    return { ...base, ok: false, problems: [(err as Error).message], sales: 0, purchases: 0, customers: 0, products: 0, receivable: 0, latestEntry: null }
  } finally {
    db.close()
  }
}

export function summarizeLive(db: DB): BackupSummary {
  return { name: "Your records now", where: "This computer", createdAt: new Date().toISOString(), ok: true, problems: [], ...countsOf(db) }
}

/** Backups found in one folder, each checked: can this fresh installation use it? */
export function restoreCandidates(folder: string, opts: { maxSchema: number; licenseProfile?: string }): RestoreCandidate[] {
  return listBackups(folder)
    .map((b): RestoreCandidate => {
      const check = verifyBackup(b.file)
      const base = { name: b.name, file: b.file, modified: b.modified, size: b.size, business: null as string | null, sales: 0, customers: 0 }
      if (!check.ok) return { ...base, ok: false, reason: "This file is damaged or is not a business backup" }
      if (check.schemaVersion > opts.maxSchema) return { ...base, ok: false, reason: "Made by a newer version of the program. Install the latest version first" }
      const db = openDatabase(b.file, { readonly: true })
      try {
        const profile = setting(db, "profile") ?? "cloth"
        const c = countsOf(db)
        const out = { ...base, business: setting(db, "business.name"), sales: c.sales, customers: c.customers }
        if (opts.licenseProfile && profile !== opts.licenseProfile) return { ...out, ok: false, reason: `This backup belongs to a "${profile}" business, but this license is for "${opts.licenseProfile}"` }
        return { ...out, ok: true, reason: null }
      } catch (err) {
        return { ...base, ok: false, reason: (err as Error).message }
      } finally {
        db.close()
      }
    })
}

function hasBackups(dir: string): boolean {
  try {
    return readdirSync(dir).some((n) => BACKUP_FILE.test(n))
  } catch {
    return false
  }
}

/**
 * Looks in the usual places for a folder that holds backups: Google Drive / OneDrive folders, Documents,
 * Desktop, and the top two levels of every other drive (a USB stick). Bounded, so it never hangs.
 */
export function suggestFolders(extraRoots: string[] = []): string[] {
  const home = homedir()
  const roots = [join(home, "Google Drive"), join(home, "My Drive"), join(home, "OneDrive"), join(home, "Documents"), join(home, "Desktop"), join(home, "Downloads"), ...extraRoots]
  if (process.platform === "win32") for (let c = 67; c <= 90; c++) roots.push(`${String.fromCharCode(c)}:\\`, `${String.fromCharCode(c)}:\\My Drive`)
  else roots.push("/media", "/mnt", "/run/media")
  const found: string[] = []
  let budget = 400 // directory reads
  const visit = (dir: string, depth: number) => {
    if (budget-- <= 0 || found.length >= 8 || !existsSync(dir)) return
    if (hasBackups(dir)) {
      if (!found.includes(dir)) found.push(dir)
      return
    }
    if (depth <= 0) return
    let names: string[] = []
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    for (const n of names) {
      if (n.startsWith(".") || n === "node_modules" || /^\$|^System Volume|^Windows$|^Program Files/i.test(n)) continue
      const p = join(dir, n)
      try {
        if (statSync(p).isDirectory()) visit(p, depth - 1)
      } catch {
        /* unreadable: skip */
      }
    }
  }
  for (const r of roots) visit(r, 2)
  return found
}
