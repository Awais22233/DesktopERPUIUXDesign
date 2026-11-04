import { describe, expect, it } from "vitest"
import { openDatabase } from "../src/main/db/connection"
import { migrate } from "../src/main/db/migrate"
import { migrations } from "../src/main/db/migrations"

describe("migrations", () => {
  it("builds the full schema on a fresh database and is idempotent", async () => {
    const db = openDatabase(":memory:")
    const first = await migrate(db, migrations)
    expect(first.applied).toEqual(migrations.map((m) => m.id))
    const second = await migrate(db, migrations)
    expect(second.applied).toEqual([])
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name)
    for (const t of ["sales", "sale_lines", "ledger_entries", "stock_movements", "account_entries", "audit_log", "variants"]) expect(tables).toContain(t)
  })

  it("rolls back a failing migration and leaves earlier work intact", async () => {
    const db = openDatabase(":memory:")
    await migrate(db, migrations)
    const bad = [...migrations, { id: 99, name: "bad", sql: "CREATE TABLE ok_table(x INTEGER); CREATE TABLE ok_table(x INTEGER);" }]
    await expect(migrate(db, bad)).rejects.toThrow(/rolled back/)
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='ok_table'").get()).toBeUndefined()
    expect((db.prepare("SELECT MAX(id) AS v FROM schema_migrations").get() as { v: number }).v).toBe(migrations.at(-1)!.id)
  })

  it("detects a tampered migration and refuses a database from a newer version", async () => {
    const db = openDatabase(":memory:")
    await migrate(db, migrations)
    const tampered = migrations.map((m) => (m.id === 1 ? { ...m, sql: m.sql + "\n-- edited" } : m))
    await expect(migrate(db, tampered)).rejects.toThrow(/modified after it was applied/)
    await expect(migrate(db, migrations.slice(0, 1))).rejects.toThrow(/newer version/)
  })

  it("takes a backup hook call only when upgrading an existing database", async () => {
    const db = openDatabase(":memory:")
    let calls = 0
    await migrate(db, migrations.slice(0, 1), { beforeMigrate: () => void calls++ })
    expect(calls).toBe(0) // fresh install: nothing to protect
    await migrate(db, migrations, { beforeMigrate: () => void calls++ })
    expect(calls).toBe(1)
  })

  it("audit log is append-only", async () => {
    const db = openDatabase(":memory:")
    await migrate(db, migrations)
    db.prepare("INSERT INTO audit_log(action, entity) VALUES ('x','y')").run()
    expect(() => db.prepare("UPDATE audit_log SET action='z'").run()).toThrow(/append-only/)
    expect(() => db.prepare("DELETE FROM audit_log").run()).toThrow(/append-only/)
  })

  it("upgrades a database made by the first release without touching its data (adds the photo column)", async () => {
    const db = openDatabase(":memory:")
    await migrate(db, migrations.filter((m) => m.id <= 3))
    db.prepare("INSERT INTO companies(name) VALUES ('Old Co')").run()
    db.prepare("INSERT INTO items(company_id, name) VALUES (1, 'Old Article')").run()
    db.prepare("INSERT INTO variants(item_id, color, size_label, purchase_price, sale_price) VALUES (1, 'Red', '40 meter', 100, 150)").run()
    await migrate(db, migrations)
    const row = db.prepare("SELECT color, sale_price, image FROM variants WHERE id = 1").get() as { color: string; sale_price: number; image: string | null }
    expect(row).toEqual({ color: "Red", sale_price: 150, image: null })
    expect(db.pragma("foreign_key_check")).toEqual([])
    expect(db.pragma("integrity_check", { simple: true })).toBe("ok")
  })

  it("upgrading from schema 4 puts every colour already in use into the library once (letter case ignored)", async () => {
    const db = openDatabase(":memory:")
    await migrate(db, migrations.filter((m) => m.id <= 4))
    db.prepare("INSERT INTO companies(name) VALUES ('Old Co')").run()
    db.prepare("INSERT INTO items(company_id, name) VALUES (1, 'A'), (1, 'B')").run()
    const ins = db.prepare("INSERT INTO variants(item_id, color, size_label, purchase_price, sale_price) VALUES (?,?,?,100,150)")
    ins.run(1, "Navy Blue", "40 meter")
    ins.run(2, "navy blue", "40 meter")
    ins.run(1, " Black ", "20 meter")
    ins.run(2, null, "20 meter")
    ins.run(2, "  ", "10 meter")
    await migrate(db, migrations)
    const names = (db.prepare("SELECT name FROM colours ORDER BY name").all() as { name: string }[]).map((r) => r.name)
    expect(names).toEqual(["Black", "Navy Blue"])
    // products are untouched
    expect((db.prepare("SELECT COUNT(*) n FROM variants").get() as { n: number }).n).toBe(5)
    expect(db.pragma("integrity_check", { simple: true })).toBe("ok")
  })

  it("upgrading from schema 6 keeps every cash/bank entry, the balances and the bills, and the new kinds work", async () => {
    const db = openDatabase(":memory:")
    await migrate(db, migrations.filter((m) => m.id <= 6))
    db.prepare("INSERT INTO accounts(name, type) VALUES ('Cash in hand','cash'), ('Bank','bank')").run()
    db.prepare("INSERT INTO parties(name) VALUES ('Old Customer')").run()
    db.prepare("INSERT INTO sales(invoice_no, ts, party_id, subtotal, total, paid) VALUES ('INV-00001','2026-01-01T10:00:00Z',1,50000,50000,20000)").run()
    const kinds = ["opening", "sale_receipt", "customer_receipt", "supplier_payment", "purchase_payment", "expense", "transfer_in", "transfer_out", "void_reversal", "refund", "adjustment"]
    const ins = db.prepare("INSERT INTO account_entries(ts, account_id, amount, kind, source_type, source_id, description) VALUES ('2026-01-01T10:00:00Z', ?, ?, ?, 'sale', 1, 'old')")
    kinds.forEach((k, n) => ins.run(n % 2 === 0 ? 1 : 2, (n + 1) * (n % 3 === 0 ? -100 : 100), k))
    const before = db.prepare("SELECT account_id, balance FROM v_account_balance ORDER BY account_id").all()
    await migrate(db, migrations)
    expect((db.prepare("SELECT COUNT(*) n FROM account_entries").get() as { n: number }).n).toBe(kinds.length)
    expect(db.prepare("SELECT account_id, balance FROM v_account_balance ORDER BY account_id").all()).toEqual(before)
    expect((db.prepare("SELECT kind FROM account_entries ORDER BY id").all() as { kind: string }[]).map((r) => r.kind)).toEqual(kinds)
    // the old bill is untouched and has no salesman
    expect(db.prepare("SELECT invoice_no, total, booked_by, recovery_by FROM sales").get()).toEqual({ invoice_no: "INV-00001", total: 50000, booked_by: null, recovery_by: null })
    // the new entry kind is accepted, an unknown one still is not
    db.prepare("INSERT INTO account_entries(ts, account_id, amount, kind) VALUES ('2026-02-01T00:00:00Z', 1, 500, 'fund_in')").run()
    expect(() => db.prepare("INSERT INTO account_entries(ts, account_id, amount, kind) VALUES ('2026-02-01T00:00:00Z', 1, 500, 'made_up')").run()).toThrow()
    expect(db.pragma("foreign_key_check")).toEqual([])
    expect(db.pragma("integrity_check", { simple: true })).toBe("ok")
  })
})
