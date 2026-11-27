import { describe, expect, it } from "vitest"
import { openDatabase } from "../src/main/db/connection"
import { migrate } from "../src/main/db/migrate"
import { migrations } from "../src/main/db/migrations"
import { createUser, loadActor } from "../src/main/services/auth"
import { buildSnapshot } from "../src/main/services/snapshot"
import { recordExpense } from "../src/main/services/payments"
import { Session } from "../src/main/session"
import { setup } from "./helpers"

describe("seeing Expenses and Cash & Bank", () => {
  it("only roles that work with money start with the two view permissions", async () => {
    const c = await setup()
    const has = (role: string, p: string) => loadActor(c.db, createUser(c.db, { username: role.replace(/\W/g, "") + Math.random(), displayName: role, password: "abcdef", role })).permissions.has(p as never)
    for (const p of ["expense.view", "cashbank.view"]) {
      expect(has("Owner / Admin", p)).toBe(true)
      expect(has("Manager", p)).toBe(true)
      expect(has("Accountant", p)).toBe(true)
      expect(has("Sales User", p)).toBe(false)
      expect(has("Viewer", p)).toBe(false)
    }
  })

  it("a person without the permission gets no expense or cash/bank history in the data they are sent", async () => {
    const c = await setup()
    recordExpense(c.db, c.owner, { categoryId: c.rent, amount: 15000, accountId: c.cash })
    const all = buildSnapshot(c.db, { expenses: true, cashbank: true })
    const none = buildSnapshot(c.db, { expenses: false, cashbank: false })
    expect(all.expenses.length).toBeGreaterThan(0)
    expect(all.entries.length).toBeGreaterThan(0)
    expect(none.expenses).toEqual([])
    expect(none.entries).toEqual([])
    expect(none.accounts.length).toBe(all.accounts.length) // names stay: they are needed to take payments
  })

  it("upgrading keeps the pages for roles that already handled expenses and cash, and hides them from the rest", async () => {
    const db = openDatabase(":memory:")
    await migrate(db, migrations.filter((m) => m.id <= 8))
    db.prepare("INSERT INTO roles(name) VALUES ('Cashier'), ('Clerk')").run()
    const give = db.prepare("INSERT INTO role_permissions(role_id, permission) SELECT id, ? FROM roles WHERE name = ?")
    give.run("expense.create", "Cashier")
    give.run("ledger.adjust", "Cashier")
    give.run("sale.create", "Clerk")
    await migrate(db, migrations)
    const perms = (role: string) => (db.prepare("SELECT permission p FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.name = ? ORDER BY p").all(role) as { p: string }[]).map((x) => x.p)
    expect(perms("Cashier")).toEqual(["cashbank.view", "expense.create", "expense.view", "ledger.adjust"])
    expect(perms("Clerk")).toEqual(["sale.create"])
  })
})

describe("asking for the password again", () => {
  it("accepts the right password, refuses a wrong one, and pauses after too many wrong tries", async () => {
    const c = await setup()
    const s = new Session()
    s.login(c.db, "owner", "secret1")
    expect(() => s.confirmPassword(c.db, "secret1")).not.toThrow()
    const t = 1_000_000
    for (let i = 0; i < 5; i++) expect(() => s.confirmPassword(c.db, "bad", t)).toThrow(/not correct/)
    expect(() => s.confirmPassword(c.db, "secret1", t + 1000)).toThrow(/Too many attempts/)
    expect(() => s.confirmPassword(c.db, "secret1", t + 61_000)).not.toThrow()
  })
  it("needs somebody signed in", async () => {
    const c = await setup()
    expect(() => new Session().confirmPassword(c.db, "secret1")).toThrow()
  })
})
