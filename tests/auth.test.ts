import { describe, expect, it } from "vitest"
import { authenticate, createUser, hashPassword, loadActor, verifyPassword } from "../src/main/services/auth"
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
