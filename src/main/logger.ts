import { appendFileSync, mkdirSync, renameSync, statSync, existsSync } from "node:fs"
import { join } from "node:path"

let file: string | null = null

export function initLogger(dir: string): void {
  mkdirSync(dir, { recursive: true })
  file = join(dir, "app.log")
  // Simple rotation so the log can never grow without bound.
  if (existsSync(file) && statSync(file).size > 2_000_000) renameSync(file, join(dir, "app.previous.log"))
}

export function log(level: "info" | "warn" | "error", message: string, extra?: unknown): void {
  const line = `${new Date().toISOString()} [${level}] ${message}${extra ? " " + (extra instanceof Error ? extra.stack ?? extra.message : JSON.stringify(extra)) : ""}\n`
  if (file) {
    try {
      appendFileSync(file, line)
    } catch {
      /* logging must never crash the app */
    }
  }
  if (level !== "info") console.error(line.trimEnd())
}
