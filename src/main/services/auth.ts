import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto"
import type { DB } from "../db/connection"
import { AppError } from "@core/errors"
import { ALL_PERMISSIONS, PERMISSIONS, type Actor, type Permission } from "@core/permissions"
import { audit, tx } from "../db/util"

const N = 16384
const R = 8
const P = 1
const KEYLEN = 64

export function hashPassword(password: string): string {
  if (password.length < 6) throw new AppError("VALIDATION", "Password must be at least 6 characters")
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, KEYLEN, { N, r: R, p: P })
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$")
  if (parts.length !== 6 || parts[0] !== "scrypt") return false
  const [, n, r, p, salt, hash] = parts
  const expected = Buffer.from(hash!, "base64")
  const actual = scryptSync(password, Buffer.from(salt!, "base64"), expected.length, { N: Number(n), r: Number(r), p: Number(p) })
  return timingSafeEqual(actual, expected)
}

const ROLE_PERMISSIONS: Record<string, readonly Permission[]> = {
  "Owner / Admin": PERMISSIONS,
  Manager: PERMISSIONS.filter((p: Permission) => !["users.manage", "backup.restore", "settings.manage"].includes(p)),
  "Sales User": ["sale.create", "return.create", "party.manage", "report.view"],
  Accountant: ["payment.create", "expense.create", "ledger.adjust", "cash.close", "party.manage", "report.view", "report.export"],
  "Store Manager": ["purchase.create", "stock.adjust", "catalog.manage", "report.view"],
  "Recovery Staff": ["payment.create", "party.manage", "report.view"],
  Viewer: ["report.view"],
}

/** Idempotent: creates the system roles and (re)syncs their permission sets. */
export function seedRoles(db: DB): void {
  tx(db, () => {
    for (const [name, perms] of Object.entries(ROLE_PERMISSIONS)) {
      db.prepare("INSERT OR IGNORE INTO roles(name, is_system) VALUES (?,1)").run(name)
      const role = db.prepare("SELECT id FROM roles WHERE name = ?").get(name) as { id: number }
      db.prepare("DELETE FROM role_permissions WHERE role_id = ?").run(role.id)
      for (const p of perms) db.prepare("INSERT INTO role_permissions(role_id, permission) VALUES (?,?)").run(role.id, p)
    }
  })
}

export function createUser(db: DB, input: { username: string; displayName: string; password: string; role: string }): number {
  return tx(db, () => {
    const role = db.prepare("SELECT id FROM roles WHERE name = ?").get(input.role) as { id: number } | undefined
    if (!role) throw new AppError("NOT_FOUND", `Role "${input.role}" not found`)
    if (!input.username.trim()) throw new AppError("VALIDATION", "Username is required")
    const exists = db.prepare("SELECT 1 FROM users WHERE username = ?").get(input.username)
    if (exists) throw new AppError("VALIDATION", "That username is already taken")
    const id = Number(
      db.prepare("INSERT INTO users(username, display_name, password_hash, role_id) VALUES (?,?,?,?)").run(input.username.trim(), input.displayName, hashPassword(input.password), role.id).lastInsertRowid,
    )
    audit(db, null, "user.create", "user", id, { username: input.username, role: input.role })
    return id
  })
}

export function loadActor(db: DB, userId: number): Actor {
  const user = db.prepare("SELECT id, active, role_id FROM users WHERE id = ?").get(userId) as { id: number; active: number; role_id: number } | undefined
  if (!user || !user.active) throw new AppError("FORBIDDEN", "User is not active")
  const rows = db.prepare("SELECT permission FROM role_permissions WHERE role_id = ?").all(user.role_id) as { permission: Permission }[]
  return { userId: user.id, permissions: new Set(rows.map((r) => r.permission).filter((p) => ALL_PERMISSIONS.has(p))) }
}

export function authenticate(db: DB, username: string, password: string): { userId: number; displayName: string } | null {
  const u = db.prepare("SELECT id, display_name, password_hash, active FROM users WHERE username = ?").get(username) as
    | { id: number; display_name: string; password_hash: string; active: number }
    | undefined
  // Always run a hash comparison so timing does not reveal whether the user exists.
  const ok = verifyPassword(password, u?.password_hash ?? "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==")
  if (!u || !u.active || !ok) return null
  return { userId: u.id, displayName: u.display_name }
}
