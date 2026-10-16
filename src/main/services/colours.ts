import type { DB } from "../db/connection"
import { AppError } from "@core/errors"
import { requirePermission, type Actor } from "@core/permissions"
import { audit, tx } from "../db/util"

export interface ColourRow {
  id: number
  name: string
  hex: string | null
  /** how many products use this colour */
  uses: number
}

export const cleanColourName = (s: string | null | undefined): string => (s ?? "").trim().replace(/\s+/g, " ")

/** The library spelling of a colour, adding it to the library when it is new. Returns null for a blank colour. */
export function ensureColour(db: DB, raw: string | null | undefined): string | null {
  const name = cleanColourName(raw)
  if (!name) return null
  if (name.length > 60) throw new AppError("VALIDATION", `Colour name is too long: ${name.slice(0, 20)}…`)
  const found = db.prepare("SELECT name FROM colours WHERE name = ?").get(name) as { name: string } | undefined
  if (found) return found.name
  db.prepare("INSERT INTO colours(name) VALUES (?)").run(name)
  return name
}

export function listColours(db: DB): ColourRow[] {
  return db
    .prepare(
      `SELECT c.id, c.name, c.hex, (SELECT COUNT(*) FROM variants v WHERE lower(trim(v.color)) = lower(c.name)) AS uses
       FROM colours c ORDER BY c.name COLLATE NOCASE`,
    )
    .all() as ColourRow[]
}

function hexOrNull(v: string | null | undefined): string | null {
  const h = (v ?? "").trim().toLowerCase()
  if (!h) return null
  if (!/^#[0-9a-f]{6}$/.test(h)) throw new AppError("VALIDATION", "The shade must look like #1f2f55")
  return h
}

/** Adds a colour, or (with id) renames it and/or changes its shade. Renaming also renames it on every product that uses it. */
export function saveColour(db: DB, actor: Actor, f: { id?: number; name: string; hex?: string | null }): number {
  requirePermission(actor, "catalog.manage")
  const name = cleanColourName(f.name)
  if (!name) throw new AppError("VALIDATION", "Colour name is required")
  if (name.length > 60) throw new AppError("VALIDATION", "Colour name is too long")
  const hex = hexOrNull(f.hex)
  return tx(db, () => {
    const clash = db.prepare("SELECT id FROM colours WHERE name = ?").get(name) as { id: number } | undefined
    if (!f.id) {
      if (clash) throw new AppError("VALIDATION", "That colour already exists")
      const id = Number(db.prepare("INSERT INTO colours(name, hex) VALUES (?,?)").run(name, hex).lastInsertRowid)
      audit(db, actor.userId, "colour.create", "colour", id, { name })
      return id
    }
    const cur = db.prepare("SELECT id, name FROM colours WHERE id = ?").get(f.id) as { id: number; name: string } | undefined
    if (!cur) throw new AppError("NOT_FOUND", "Colour not found")
    if (clash && clash.id !== cur.id) throw new AppError("VALIDATION", `"${name}" already exists. Use that colour instead of renaming this one.`)
    db.prepare("UPDATE colours SET name = ?, hex = ? WHERE id = ?").run(name, hex, cur.id)
    if (cur.name !== name) db.prepare("UPDATE variants SET color = ? WHERE lower(trim(color)) = lower(?)").run(name, cur.name)
    audit(db, actor.userId, "colour.update", "colour", cur.id, { from: cur.name, to: name })
    return cur.id
  })
}

/** Removes a colour from the library. Only colours no product uses can be removed. */
export function deleteColour(db: DB, actor: Actor, id: number): void {
  requirePermission(actor, "catalog.manage")
  tx(db, () => {
    const cur = db.prepare("SELECT name FROM colours WHERE id = ?").get(id) as { name: string } | undefined
    if (!cur) throw new AppError("NOT_FOUND", "Colour not found")
    const uses = (db.prepare("SELECT COUNT(*) AS n FROM variants WHERE lower(trim(color)) = lower(?)").get(cur.name) as { n: number }).n
    if (uses > 0) throw new AppError("INVALID_STATE", `${cur.name} is used by ${uses} product${uses === 1 ? "" : "s"}, so it cannot be removed`)
    db.prepare("DELETE FROM colours WHERE id = ?").run(id)
    audit(db, actor.userId, "colour.delete", "colour", id, { name: cur.name })
  })
}
