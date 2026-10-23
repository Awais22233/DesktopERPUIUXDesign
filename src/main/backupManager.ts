import { existsSync } from "node:fs"
import { join } from "node:path"
import { mirrorImages } from "./services/images"
import { cleanPartials, copyToSecondary, createBackup, listBackups, pruneBackups, pruneRotation } from "./db/backup"
import type { DB } from "./db/connection"
import { getSetting, setSetting } from "./db/util"
import { log } from "./logger"
import type { BackupStatus, TargetStatus } from "@shared/ipc"

const KEEP = 30
const slotKey = (slot: 1 | 2) => (slot === 1 ? "backup.secondary_dir" : "backup.secondary_dir2")
const DAY_MS = 24 * 3600 * 1000

export class BackupManager {
  private running: Promise<string> | null = null
  constructor(
    private db: DB,
    private dir: string,
    private imagesDir?: string,
  ) {}

  lastBackupAt(): string | null {
    return getSetting(this.db, "backup.last_at", "") || null
  }

  /** The outside folders chosen in Settings (USB drive, second disk, Google Drive folder), by slot. */
  targets(): { slot: 1 | 2; dir: string }[] {
    return ([1, 2] as const).map((slot) => ({ slot, dir: getSetting(this.db, slotKey(slot), "") })).filter((t) => t.dir)
  }

  /** What the screens and the warning need to know about the outside copies. */
  status(): BackupStatus {
    const targets: TargetStatus[] = this.targets().map(({ slot, dir }) => {
      const available = existsSync(dir)
      const files = available ? listBackups(dir) : []
      return {
        slot,
        dir,
        available,
        lastOkAt: getSetting(this.db, `backup.copy${slot}.ok_at`, "") || null,
        error: getSetting(this.db, `backup.copy${slot}.error`, "") || null,
        files: files.length,
        bytes: files.reduce((n, f) => n + f.size, 0),
      }
    })
    const oks = targets.map((t) => t.lastOkAt).filter((x): x is string => !!x).sort()
    const oldest = listBackups(this.dir).at(-1)
    return {
      targets,
      lastExternalOkAt: oks.at(-1) ?? null,
      firstBackupAt: oldest?.modified ?? null,
      lastTestAt: getSetting(this.db, "backup.last_test_at", "") || null,
    }
  }

  /** True when at least one chosen folder can be written to right now. */
  anyTargetAvailable(): boolean {
    return this.targets().some((t) => existsSync(t.dir))
  }

  private copyOut(file: string): void {
    for (const { slot, dir } of this.targets()) {
      const okKey = `backup.copy${slot}.ok_at`
      const errKey = `backup.copy${slot}.error`
      try {
        if (!existsSync(dir)) throw new Error("The folder or drive is not connected")
        cleanPartials(dir)
        copyToSecondary(file, dir)
        if (this.imagesDir) mirrorImages(this.imagesDir, join(dir, "images"))
        // old copies are thinned only after the new one is safely there
        pruneRotation(dir)
        setSetting(this.db, okKey, new Date().toISOString())
        setSetting(this.db, errKey, "")
      } catch (err) {
        const message = (err as Error).message
        setSetting(this.db, errKey, message)
        log("warn", `Copy to backup folder ${dir} failed: ${message}`)
      }
    }
  }

  /** Runs one backup at a time. Safe to call from a timer, on close, or from the UI. */
  run(reason: string): Promise<string> {
    if (this.running) return this.running
    this.running = (async () => {
      const file = await createBackup(this.db, this.dir, reason)
      setSetting(this.db, "backup.last_at", new Date().toISOString())
      pruneBackups(this.dir, KEEP)
      this.copyOut(file)
      log("info", `Backup created (${reason}): ${file}`)
      return file
    })().finally(() => {
      this.running = null
    })
    return this.running
  }

  /** Daily automatic backup: runs if the last one is older than 20 hours. */
  async runIfDue(): Promise<void> {
    const last = this.lastBackupAt()
    if (!last || Date.now() - new Date(last).getTime() > DAY_MS * (20 / 24)) {
      try {
        await this.run("auto")
      } catch (err) {
        log("error", "Automatic backup failed", err)
      }
    }
  }

  list() {
    return listBackups(this.dir).map((b) => ({ name: b.name, size: b.size, modified: b.modified }))
  }
}
