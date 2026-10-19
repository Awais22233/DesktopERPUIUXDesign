import { describe, expect, it } from "vitest"
import { authenticate, createUser, hashPassword, loadActor, seedRoles, verifyPassword } from "../src/main/services/auth"
import { setup } from "./helpers"

describe("authentication", () => {
  it("hashes passwords with a per-user salt and verifies them", () => {
    const a = hashPassword("secret1")
    const b = hashPassword("secret1")
    expect(a).not.toBe(b)
    expect(a).not.toContain("secret1")
    expect(verifyPassword("secret1", a)).toBe(true)
    expect(verifyPassword("wrong", a)).toBe(false)
  })
  it("authenticates only active users with the right password; roles map to permissions", async () => {
    const c = await setup()
    expect(authenticate(c.db, "owner", "secret1")).not.toBeNull()
    expect(authenticate(c.db, "owner", "nope")).toBeNull()
    expect(authenticate(c.db, "ghost", "secret1")).toBeNull()
    const id = createUser(c.db, { username: "sam", displayName: "Sam", password: "abcdef", role: "Sales User" })
    const actor = loadActor(c.db, id)
    expect(actor.permissions.has("sale.create")).toBe(true)
    expect(actor.permissions.has("sale.void")).toBe(false)
    c.db.prepare("UPDATE users SET active = 0 WHERE id = ?").run(id)
    expect(authenticate(c.db, "sam", "abcdef")).toBeNull()
    expect(() => loadActor(c.db, id)).toThrow()
  })
})

describe("role permissions survive a restart", () => {
  it("changes made by the owner are not reset when the application starts again", async () => {
    const { db } = await setup()
    const role = (db.prepare("SELECT id FROM roles WHERE name = 'Sales User'").get() as { id: number }).id
    const has = (p: string) => !!db.prepare("SELECT 1 FROM role_permissions WHERE role_id = ? AND permission = ?").get(role, p)
    expect(has("report.view")).toBe(true)
    db.prepare("DELETE FROM role_permissions WHERE role_id = ? AND permission = 'report.view'").run(role)
    db.prepare("INSERT INTO role_permissions(role_id, permission) VALUES (?, 'payment.create')").run(role)
    seedRoles(db) // what happens at every start
    seedRoles(db)
    expect(has("report.view")).toBe(false)
    expect(has("payment.create")).toBe(true)
    // the owner role is always complete, even if someone tampered with it
    const owner = (db.prepare("SELECT id FROM roles WHERE name = 'Owner / Admin'").get() as { id: number }).id
    db.prepare("DELETE FROM role_permissions WHERE role_id = ?").run(owner)
    seedRoles(db)
    expect((db.prepare("SELECT COUNT(*) n FROM role_permissions WHERE role_id = ?").get(owner) as { n: number }).n).toBeGreaterThan(15)
  })
})
