import type { DB } from "./db/connection"
import { AppError } from "@core/errors"
import type { Actor } from "@core/permissions"
import { audit } from "./db/util"
import { authenticate, createUser, hashPassword, loadActor, verifyPassword } from "./services/auth"
import type { SessionUser } from "@shared/models"

const MAX_FAILS = 5
const LOCK_MS = 60_000

/** The signed-in user for this window. Permissions are re-read on every call so a role change applies at once. */
export class Session {
  private userId: number | null = null
  private fails = new Map<string, { n: number; until: number }>()

  get loggedIn(): boolean {
    return this.userId !== null
  }

  private describe(db: DB, id: number): SessionUser {
    const u = db.prepare("SELECT u.id, u.username, u.display_name, ro.name AS role FROM users u JOIN roles ro ON ro.id = u.role_id WHERE u.id = ?").get(id) as { id: number; username: string; display_name: string; role: string }
    const actor = loadActor(db, id)
    return { id: u.id, name: u.display_name, username: u.username, role: u.role, permissions: [...actor.permissions] }
  }

  current(db: DB): SessionUser | null {
    if (this.userId === null) return null
    try {
      return this.describe(db, this.userId)
    } catch {
      this.userId = null // the account was deactivated while signed in
      return null
    }
  }

  actor(db: DB): Actor {
    if (this.userId === null) throw new AppError("FORBIDDEN", "Please sign in")
    try {
      return loadActor(db, this.userId)
    } catch {
      this.userId = null
      throw new AppError("FORBIDDEN", "Please sign in")
    }
  }

  needsSetup(db: DB): boolean {
    return (db.prepare("SELECT COUNT(*) c FROM users").get() as { c: number }).c === 0
  }

  setup(db: DB, input: { name: string; username: string; password: string }): SessionUser {
    if (!this.needsSetup(db)) throw new AppError("INVALID_STATE", "The owner account already exists")
    const id = createUser(db, { username: input.username, displayName: input.name.trim() || input.username, password: input.password, role: "Owner / Admin" })
    this.userId = id
    db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(new Date().toISOString(), id)
    audit(db, id, "auth.login", "user", id)
    return this.describe(db, id)
  }

  login(db: DB, username: string, password: string, now = Date.now()): SessionUser {
    const key = username.trim().toLowerCase()
    const f = this.fails.get(key)
    if (f && f.until > now) throw new AppError("FORBIDDEN", `Too many attempts. Try again in ${Math.ceil((f.until - now) / 1000)} seconds.`)
    const hit = authenticate(db, username.trim(), password)
    if (!hit) {
      const n = (f && f.until <= now && f.n >= MAX_FAILS ? 0 : (f?.n ?? 0)) + 1
      this.fails.set(key, { n, until: n >= MAX_FAILS ? now + LOCK_MS : 0 })
      throw new AppError("FORBIDDEN", "The username or password is not correct")
    }
    this.fails.delete(key)
    this.userId = hit.userId
    db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(new Date().toISOString(), hit.userId)
    audit(db, hit.userId, "auth.login", "user", hit.userId)
    return this.describe(db, hit.userId)
  }

  logout(db: DB): void {
    if (this.userId !== null) audit(db, this.userId, "auth.logout", "user", this.userId)
    this.userId = null
  }

  changePassword(db: DB, current: string, next: string): void {
    const actor = this.actor(db)
    const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(actor.userId) as { password_hash: string }
    if (!verifyPassword(current, row.password_hash)) throw new AppError("FORBIDDEN", "The current password is not correct")
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(next), actor.userId)
    audit(db, actor.userId, "auth.password", "user", actor.userId)
  }
}
