import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { BackupManager } from "../src/main/backupManager"
import { copyToSecondary, createBackup, listBackups, pruneRotation, selectKeep } from "../src/main/db/backup"
import { setSetting } from "../src/main/db/util"
import { setup, tempDir } from "./helpers"

const name = (day: string, time = "180000", reason = "auto") => `backup-${day}-${time}-${reason}.db`

describe("backup rotation (grandfather-father-son)", () => {
  it("keeps the newest of each recent day, week and month, and drops the rest", () => {
    // 500 days of two backups each day, ending 2026-10-23
    const names: string[] = []
    for (let i = 0; i < 500; i++) {
      const d = new Date(Date.UTC(2026, 9, 23) - i * 86_400_000)
      const day = d.toISOString().slice(0, 10).replace(/-/g, "")
      names.push(name(day, "090000"), name(day, "210000", "close"))
    }
    const keep = selectKeep(names)
    // the last 14 days: exactly one (the newest) per day
    for (let i = 0; i < 14; i++) {
      const d = new Date(Date.UTC(2026, 9, 23) - i * 86_400_000).toISOString().slice(0, 10).replace(/-/g, "")
      expect(keep.has(name(d, "210000", "close"))).toBe(true)
      expect(keep.has(name(d, "090000"))).toBe(false)
    }
    expect(keep.size).toBeGreaterThan(14)
    expect(keep.size).toBeLessThan(14 + 8 + 12 + 1)
    // something about a month old is still there (weekly tier), and something very old is gone
    expect([...keep].some((n) => n.startsWith("backup-202609"))).toBe(true)
    expect([...keep].some((n) => n.startsWith("backup-202512"))).toBe(true) // within the last 12 months
    expect([...keep].some((n) => n.startsWith("backup-202508"))).toBe(false) // older than a year
  })
  it("never deletes the newest backup, and keeps everything when there are few", () => {
    const few = [name("20261020"), name("20261021"), name("20261022")]
    expect(selectKeep(few).size).toBe(3)
    expect(selectKeep([name("20200101")]).has(name("20200101"))).toBe(true)
    expect(selectKeep([]).size).toBe(0)
  })
  it("pruneRotation removes files from a folder but leaves safety copies and other files alone", () => {
    const dir = tempDir()
    mkdirSync(dir, { recursive: true })
    for (let i = 1; i <= 60; i++) writeFileSync(join(dir, name(`2026${i <= 30 ? "09" : "10"}${String(((i - 1) % 30) + 1).padStart(2, "0")}`)), "x")
    writeFileSync(join(dir, name("20260101", "100000", "pre-migrate")), "x")
    writeFileSync(join(dir, "notes.txt"), "x")
    const removed = pruneRotation(dir)
    expect(removed.length).toBeGreaterThan(0)
    expect(existsSync(join(dir, name("20260101", "100000", "pre-migrate")))).toBe(true)
    expect(existsSync(join(dir, "notes.txt"))).toBe(true)
  })
})

describe("copy to an outside folder", () => {
  it("is verified and leaves no partial file; a damaged source is refused", async () => {
    const c = await setup()
    const dir = tempDir()
    const good = await createBackup(c.db, join(dir, "local"), "manual")
    const out = join(dir, "usb")
    const dest = copyToSecondary(good, out)
    expect(existsSync(dest)).toBe(true)
    expect(readdirSync(out).some((n) => n.endsWith(".part"))).toBe(false)

    const bad = join(dir, "local", name("20260101", "000000", "manual"))
    writeFileSync(bad, "this is not a database")
    expect(() => copyToSecondary(bad, join(dir, "usb2"))).toThrow()
    expect(existsSync(join(dir, "usb2")) ? readdirSync(join(dir, "usb2")) : []).toEqual([])
  })
})

describe("backup manager with two outside folders", () => {
  it("copies to the connected one, records the failure of the missing one, and reports status", async () => {
    const c = await setup()
    const dir = tempDir()
    const usb = join(dir, "usb")
    const drive = join(dir, "not-plugged-in")
    mkdirSync(usb, { recursive: true })
    setSetting(c.db, "backup.secondary_dir", usb)
    setSetting(c.db, "backup.secondary_dir2", drive)
    const m = new BackupManager(c.db, join(dir, "local"))
    await m.run("manual")
    expect(listBackups(usb).length).toBe(1)
    const st = m.status()
    expect(st.targets).toHaveLength(2)
    const [one, two] = st.targets
    expect(one).toMatchObject({ slot: 1, available: true, error: null, files: 1 })
    expect(one!.lastOkAt).toBeTruthy()
    expect(two).toMatchObject({ slot: 2, available: false, lastOkAt: null })
    expect(two!.error).toMatch(/not connected/)
    expect(st.lastExternalOkAt).toBe(one!.lastOkAt)

    // the second drive appears later: the next backup lands there and the error clears
    mkdirSync(drive, { recursive: true })
    await new Promise((r) => setTimeout(r, 1100)) // backup names carry seconds
    await m.run("manual")
    const st2 = m.status()
    expect(st2.targets[1]).toMatchObject({ available: true, error: null, files: 1 })
    // two backups on the same day: only the newest of the day is kept outside
    expect(listBackups(usb).length).toBe(1)
    expect(listBackups(usb)[0]!.name).toBe(listBackups(join(dir, "local"))[0]!.name)
    expect(m.anyTargetAvailable()).toBe(true)
  })
  it("with no outside folder chosen there is nothing to report and nothing fails", async () => {
    const c = await setup()
    const m = new BackupManager(c.db, join(tempDir(), "local"))
    await m.run("manual")
    expect(m.status().targets).toEqual([])
    expect(m.anyTargetAvailable()).toBe(false)
  })
})
