import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { copyToSecondary, createBackup, listBackups, pruneBackups, restoreBackup, verifyBackup } from "../src/main/db/backup"
import { integrityCheck, openDatabase } from "../src/main/db/connection"
import { postSale } from "../src/main/services/sales"
import { postPurchase } from "../src/main/services/purchases"
import { count, setup, tempDir } from "./helpers"

describe("backup and restore", () => {
  it("creates a verified backup, and restore brings back the earlier state (with a safety copy)", async () => {
    const dir = tempDir()
    const live = join(dir, "erp.db")
    const c = await setup("cloth", live)
    postPurchase(c.db, c.owner, { supplierId: c.supplier, lines: [{ variantId: c.blue, qty: 10, rate: 100_000 }], payments: [] })
    postSale(c.db, c.owner, { partyId: c.party, lines: [{ variantId: c.blue, qty: 2 }], payments: [] })

    const bk = await createBackup(c.db, join(dir, "backups"), "manual")
    expect(verifyBackup(bk)).toMatchObject({ ok: true })
    expect(existsSync(bk + "-wal") || existsSync(bk + "-shm")).toBe(false) // single self-contained file
    expect(listBackups(join(dir, "backups")).length).toBe(1)

    postSale(c.db, c.owner, { partyId: c.party, lines: [{ variantId: c.blue, qty: 3 }], payments: [] })
    expect(count(c.db, "sales")).toBe(2)
    c.db.close()

    const safety = restoreBackup(bk, live, join(dir, "backups"))
    expect(safety && existsSync(safety)).toBe(true)

    const db2 = openDatabase(live)
    expect(count(db2, "sales")).toBe(1)
    expect(integrityCheck(db2).ok).toBe(true)
    db2.close()
    // the safety copy still holds the state from just before the restore
    const old = openDatabase(safety!, { readonly: true })
    expect(count(old, "sales")).toBe(2)
    old.close()
  })

  it("rejects a corrupted or foreign file and never overwrites the live database with it", async () => {
    const dir = tempDir()
    const live = join(dir, "erp.db")
    const c = await setup("cloth", live)
    const bk = await createBackup(c.db, join(dir, "b"), "manual")
    c.db.close()

    const bad = join(dir, "bad.db")
    const bytes = readFileSync(bk)
    writeFileSync(bad, Buffer.concat([bytes.subarray(0, 200), Buffer.alloc(bytes.length - 200, 7)]))
    expect(verifyBackup(bad).ok).toBe(false)
    const notDb = join(dir, "notes.db")
    writeFileSync(notDb, "hello")
    expect(verifyBackup(notDb).ok).toBe(false)

    const before = readFileSync(live)
    expect(() => restoreBackup(bad, live, join(dir, "b"))).toThrow(/not valid/)
    expect(readFileSync(live).equals(before)).toBe(true)
  })

  it("prunes old automatic backups but never pre-migrate / pre-restore ones; copies to a second location", async () => {
    const dir = tempDir()
    const c = await setup("cloth", join(dir, "erp.db"))
    const bdir = join(dir, "b")
    const base = Date.UTC(2026, 0, 1)
    for (let i = 0; i < 5; i++) await createBackup(c.db, bdir, "auto", new Date(base + i * 86_400_000))
    await createBackup(c.db, bdir, "pre-migrate", new Date(base - 86_400_000))
    const removed = pruneBackups(bdir, 2)
    expect(removed.length).toBe(3)
    const names = listBackups(bdir).map((b) => b.name)
    expect(names.filter((n) => n.endsWith("-auto.db")).length).toBe(2)
    expect(names.some((n) => n.endsWith("-pre-migrate.db"))).toBe(true)

    const copy = copyToSecondary(listBackups(bdir)[0]!.file, join(dir, "usb"))
    expect(verifyBackup(copy).ok).toBe(true)
    c.db.close()
  })
})
