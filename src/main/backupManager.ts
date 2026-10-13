import { existsSync } from "node:fs"
import { join } from "node:path"
import { mirrorImages } from "./services/images"
import { createBackup, copyToSecondary, listBackups, pruneBackups } from "./db/backup"
import type { DB } from "./db/connection"
import { getSetting, setSetting } from "./db/util"
import { log } from "./logger"

const KEEP = 30
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

  /** Runs one backup at a time. Safe to call from a timer, on close, or from the UI. */
  run(reason: string): Promise<string> {
    if (this.running) return this.running
    this.running = (async () => {
      const file = await createBackup(this.db, this.dir, reason)
      setSetting(this.db, "backup.last_at", new Date().toISOString())
      pruneBackups(this.dir, KEEP)
      const secondary = getSetting(this.db, "backup.secondary_dir", "")
      if (secondary) {
        try {
          if (existsSync(secondary)) {
            copyToSecondary(file, secondary)
            if (this.imagesDir) mirrorImages(this.imagesDir, join(secondary, "images"))
          }
          else log("warn", `Secondary backup folder is not available: ${secondary}`)
        } catch (err) {
          log("warn", "Copy to secondary backup location failed", err)
        }
      }
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
