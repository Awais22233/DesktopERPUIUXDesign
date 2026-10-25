import type { DB } from "../db/connection"
import { AppError } from "@core/errors"
import { requirePermission, type Actor } from "@core/permissions"
import { audit, tx } from "../db/util"

export type StaffRole = "salesman" | "recovery" | "both"
export interface StaffForm {
  id?: number
  name: string
  phone?: string
  role: StaffRole
  active?: boolean
}

const clean = (s: string | undefined, max: number) => (s ?? "").trim().replace(/\s+/g, " ").slice(0, max)

export function saveStaff(db: DB, actor: Actor, f: StaffForm): number {
  requirePermission(actor, "settings.manage")
  const name = clean(f.name, 60)
  if (!name) throw new AppError("VALIDATION", "Enter the name")
  if (!["salesman", "recovery", "both"].includes(f.role)) throw new AppError("VALIDATION", "Choose salesman, recovery or both")
  const phone = clean(f.phone, 30) || null
  return tx(db, () => {
    const clash = db.prepare("SELECT id FROM staff WHERE name = ? COLLATE NOCASE AND id != ?").get(name, f.id ?? 0)
    if (clash) throw new AppError("VALIDATION", `${name} is already in the list`)
    if (f.id) {
      if (!db.prepare("SELECT 1 FROM staff WHERE id = ?").get(f.id)) throw new AppError("NOT_FOUND", "Person not found")
      db.prepare("UPDATE staff SET name = ?, phone = ?, role = ?, active = ? WHERE id = ?").run(name, phone, f.role, f.active === false ? 0 : 1, f.id)
      audit(db, actor.userId, "staff.update", "staff", f.id, { name, role: f.role })
      return f.id
    }
    const id = Number(db.prepare("INSERT INTO staff(name, phone, role) VALUES (?,?,?)").run(name, phone, f.role).lastInsertRowid)
    audit(db, actor.userId, "staff.create", "staff", id, { name, role: f.role })
    return id
  })
}

export function listStaff(db: DB): { id: number; name: string; phone: string; role: StaffRole; active: boolean }[] {
  return (db.prepare("SELECT id, name, phone, role, active FROM staff ORDER BY name").all() as { id: number; name: string; phone: string | null; role: StaffRole; active: number }[]).map((x) => ({
    id: x.id,
    name: x.name,
    phone: x.phone ?? "",
    role: x.role,
    active: x.active === 1,
  }))
}

/** Name and phone of an active person who may do the given job, for printing on a bill. */
export function staffForBill(db: DB, id: number | undefined, job: "salesman" | "recovery"): { name: string; phone: string | null } | null {
  if (id === undefined) return null
  const s = db.prepare("SELECT name, phone, role, active FROM staff WHERE id = ?").get(id) as { name: string; phone: string | null; role: StaffRole; active: number } | undefined
  if (!s) throw new AppError("NOT_FOUND", "Salesman / recovery person not found")
  if (!s.active) throw new AppError("INVALID_STATE", `${s.name} is switched off`)
  if (s.role !== "both" && s.role !== job) throw new AppError("VALIDATION", `${s.name} is not a ${job === "salesman" ? "salesman" : "recovery person"}`)
  return { name: s.name, phone: s.phone }
}
