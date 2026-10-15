import { randomBytes } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { DB } from "../db/connection"
import { AppError } from "@core/errors"
import { requirePermission, type Actor } from "@core/permissions"
import { audit } from "../db/util"

/** The renderer shrinks every photo to two JPEGs; the main process re-checks them because it never trusts the window. */
const LIMITS = {
  thumb: { maxSide: 320, maxBytes: 150_000 },
  full: { maxSide: 1280, maxBytes: 700_000 },
} as const

export const IMAGE_FILE = /^\d+-[0-9a-f]{8}-[tf]\.jpg$/

/** Reads width/height from a JPEG's start-of-frame marker. Returns null if the bytes are not a well-formed JPEG. */
export function jpegSize(b: Buffer): { width: number; height: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return null
  if (b[b.length - 2] !== 0xff || b[b.length - 1] !== 0xd9) return null
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null
    const marker = b[i + 1]!
    if (marker === 0xff) {
      i++
      continue
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2
      continue
    }
    const len = b.readUInt16BE(i + 2)
    if (len < 2) return null
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) {
      const height = b.readUInt16BE(i + 5)
      const width = b.readUInt16BE(i + 7)
      return width > 0 && height > 0 ? { width, height } : null
    }
    i += 2 + len
  }
  return null
}

function decode(data: string, kind: keyof typeof LIMITS): Buffer {
  const raw = data.replace(/^data:image\/jpeg;base64,/, "")
  if (!/^[A-Za-z0-9+/=]+$/.test(raw)) throw new AppError("VALIDATION", "That is not a valid photo")
  const buf = Buffer.from(raw, "base64")
  const lim = LIMITS[kind]
  if (buf.length > lim.maxBytes) throw new AppError("VALIDATION", "That photo is too large")
  const size = jpegSize(buf)
  if (!size) throw new AppError("VALIDATION", "That is not a valid photo")
  if (size.width > lim.maxSide || size.height > lim.maxSide) throw new AppError("VALIDATION", "That photo is too large")
  return buf
}

function writeAtomic(file: string, data: Buffer): void {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, data)
  renameSync(tmp, file)
}

function dropFiles(dir: string, base: string | null | undefined): void {
  if (!base) return
  for (const s of ["t", "f"]) {
    rmSync(join(dir, `${base}-${s}.jpg`), { force: true })
    rmSync(join(dir, `${base}-${s}.jpg.tmp`), { force: true })
  }
}

export function saveProductImage(db: DB, actor: Actor, dir: string, variantId: number, thumbB64: string, fullB64: string): string {
  requirePermission(actor, "catalog.manage")
  const row = db.prepare("SELECT image FROM variants WHERE id = ?").get(variantId) as { image: string | null } | undefined
  if (!row) throw new AppError("NOT_FOUND", "Product not found")
  const thumb = decode(thumbB64, "thumb")
  const full = decode(fullB64, "full")
  mkdirSync(dir, { recursive: true })
  const base = `${variantId}-${randomBytes(4).toString("hex")}`
  try {
    writeAtomic(join(dir, `${base}-t.jpg`), thumb)
    writeAtomic(join(dir, `${base}-f.jpg`), full)
    db.prepare("UPDATE variants SET image = ? WHERE id = ?").run(base, variantId)
  } catch (err) {
    dropFiles(dir, base)
    throw err
  }
  audit(db, actor.userId, "product.image", "variant", variantId, { set: true })
  // The replaced photo is kept for a while (see sweepImages): if the data file is ever restored from an
  // older backup, the older photo is still there for it.
  return base
}

export function removeProductImage(db: DB, actor: Actor, dir: string, variantId: number): void {
  requirePermission(actor, "catalog.manage")
  const row = db.prepare("SELECT image FROM variants WHERE id = ?").get(variantId) as { image: string | null } | undefined
  if (!row) throw new AppError("NOT_FOUND", "Product not found")
  db.prepare("UPDATE variants SET image = NULL WHERE id = ?").run(variantId)
  audit(db, actor.userId, "product.image", "variant", variantId, { set: false })
}

/** Serves a stored photo to the window. Only generated file names are accepted, so no path can escape the folder. */
export function readImage(dir: string, name: string): Buffer | null {
  if (!IMAGE_FILE.test(name)) return null
  const file = join(dir, name)
  return existsSync(file) ? readFileSync(file) : null
}

/**
 * Copies photos that are not yet (completely) in the backup folder. Each file is copied under a temporary
 * name and renamed, and a file of the wrong size is copied again, so a copy cut short by a power cut or
 * a removed USB drive is repaired next time instead of staying broken.
 */
export function mirrorImages(dir: string, target: string): number {
  if (!existsSync(dir)) return 0
  mkdirSync(target, { recursive: true })
  let n = 0
  for (const name of readdirSync(dir)) {
    if (!IMAGE_FILE.test(name)) continue
    const from = join(dir, name)
    const to = join(target, name)
    if (existsSync(to) && statSync(to).size === statSync(from).size) continue
    const tmp = `${to}.tmp`
    copyFileSync(from, tmp)
    renameSync(tmp, to)
    n++
  }
  return n
}

/**
 * Housekeeping at start-up: removes leftover temporary files, and photo files that no product refers to
 * any more and that are older than `keepDays` (replaced or removed photos are kept for a while on purpose).
 */
export function sweepImages(db: DB, dir: string, keepDays = 30, now = Date.now()): number {
  if (!existsSync(dir)) return 0
  const used = new Set((db.prepare("SELECT image FROM variants WHERE image IS NOT NULL").all() as { image: string }[]).map((r) => r.image))
  let removed = 0
  for (const name of readdirSync(dir)) {
    const file = join(dir, name)
    const age = now - statSync(file).mtimeMs
    if (name.endsWith(".tmp")) {
      if (age > 24 * 3600 * 1000) {
        rmSync(file, { force: true })
        removed++
      }
      continue
    }
    const m = /^(\d+-[0-9a-f]{8})-[tf]\.jpg$/.exec(name)
    if (m && !used.has(m[1]!) && age > keepDays * 24 * 3600 * 1000) {
      rmSync(file, { force: true })
      removed++
    }
  }
  return removed
}
