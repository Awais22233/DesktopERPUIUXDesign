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
})
