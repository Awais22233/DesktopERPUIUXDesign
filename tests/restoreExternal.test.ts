import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { BackupManager } from "../src/main/backupManager"
import { createBackup } from "../src/main/db/backup"
import { restoreCandidates, summarizeBackup, suggestFolders } from "../src/main/db/backupInfo"
import { openDatabase } from "../src/main/db/connection"
import { migrate } from "../src/main/db/migrate"
import { migrations } from "../src/main/db/migrations"
import { createCommands, type Ctx } from "../src/main/commands"
import { seedRoles } from "../src/main/services/auth"
import { ensureConfig } from "../src/main/services/config"
import { seedDefaults } from "../src/main/services/defaults"
import { ensureWalkInParty } from "../src/main/services/masterData"
import { Session } from "../src/main/session"
import { setup, tempDir } from "./helpers"

const MAX = migrations.at(-1)!.id

describe("backups found on a new computer", () => {
  it("a good backup is usable; a profile mismatch, a newer format and a damaged file are refused with a reason", async () => {
    const c = await setup("cloth")
    const dir = tempDir()
    const folder = join(dir, "usb")
    const good = await createBackup(c.db, folder, "manual")
    const name = good.split(/[\\/]/).pop()!
    const ok = restoreCandidates(folder, { maxSchema: MAX, licenseProfile: "cloth" })
    expect(ok).toHaveLength(1)
    expect(ok[0]).toMatchObject({ name, ok: true, reason: null })

    const wrongProfile = restoreCandidates(folder, { maxSchema: MAX, licenseProfile: "cosmetics" })
    expect(wrongProfile[0]).toMatchObject({ ok: false })
    expect(wrongProfile[0]!.reason).toMatch(/cloth.*cosmetics/)

    const tooNew = restoreCandidates(folder, { maxSchema: MAX - 1, licenseProfile: "cloth" })
    expect(tooNew[0]!.reason).toMatch(/newer version/)

    writeFileSync(join(folder, "backup-20250101-000000-manual.db"), "garbage")
    const mixed = restoreCandidates(folder, { maxSchema: MAX })
    expect(mixed.find((x) => x.name.includes("20250101"))).toMatchObject({ ok: false })
    expect(mixed.find((x) => x.name === name)!.ok).toBe(true)
  })
  it("summarises a backup with its real counts and tells a damaged one apart", async () => {
    const c = await setup("cloth")
    const dir = tempDir()
    const f = await createBackup(c.db, join(dir, "b"), "manual")
    const s = summarizeBackup(f, "x", "here", new Date().toISOString())
    expect(s).toMatchObject({ ok: true, sales: 0, customers: 1 }) // the helper's one customer
    const bad = join(dir, "b", "backup-20250101-000000-manual.db")
    writeFileSync(bad, "nope")
    expect(summarizeBackup(bad, "bad", "here", "").ok).toBe(false)
  })
  it("suggestFolders finds a folder that holds backups, and never throws on missing places", async () => {
    const c = await setup("cloth")
    const root = join(tempDir(), "Google Drive")
    await createBackup(c.db, join(root, "ERP-Backup"), "manual")
    const found = suggestFolders([root])
    expect(found).toContain(join(root, "ERP-Backup"))
    expect(() => suggestFolders(["/definitely/not/here"])).not.toThrow()
  })
})

async function commands(opts: { withOwner: boolean; backups?: BackupManager; backupsDir?: string; pick?: string | null }) {
  const db = openDatabase(":memory:")
  await migrate(db, migrations)
  seedRoles(db)
  ensureConfig(db, "cloth")
  ensureWalkInParty(db)
  seedDefaults(db)
  const session = new Session()
  const restored: string[] = []
  const ctx: Ctx = {
    db: () => db,
    session,
    backups: () => opts.backups ?? new BackupManager(db, opts.backupsDir ?? join(tempDir(), "local")),
    restore: async () => {},
    chooseFolder: async () => opts.pick ?? null,
    backupsDir: opts.backupsDir ?? "/local",
    restoreInfo: () => ({ maxSchema: MAX, licenseProfile: "cloth" }),
    restoreExternal: async (folder, name) => void restored.push(`${folder}|${name}`),
  }
  const c = createCommands(ctx)
  if (opts.withOwner) c["auth:setup"]({ name: "Owner", username: "owner", password: "secret1" })
  return { c, db, restored }
}

describe("restore from an outside folder is only for a fresh installation", () => {
  it("works before anyone exists, refused once a business has users", async () => {
    const fresh = await commands({ withOwner: false, pick: "/some/usb" })
    expect(await fresh.c["restore:scan"]({ folder: tempDir() })).toMatchObject({ found: [] })
    await expect(fresh.c["restore:chooseFolder"](undefined)).resolves.toEqual({ folder: "/some/usb" })
    await fresh.c["restore:start"]({ folder: "/some/usb", name: "backup-20260101-000000-manual.db" })
    expect(fresh.restored).toHaveLength(1)

    const used = await commands({ withOwner: true })
    expect(() => used.c["restore:scan"](undefined)).toThrow(/new installation/)
    await expect(used.c["restore:start"]({ folder: "/x", name: "backup-20260101-000000-manual.db" })).rejects.toThrow(/new installation/)
    expect(used.restored).toHaveLength(0)
  })
})

describe("choosing the extra copy folders", () => {
  it("refuses the program's own backup folder, the other slot's folder and a folder it cannot write; saves a good one", async () => {
    const dir = tempDir()
    const local = join(dir, "local")
    const usb = join(dir, "usb")
    const usb2 = join(dir, "usb2")
    mkdirSync(local, { recursive: true })
    mkdirSync(usb, { recursive: true })
    mkdirSync(usb2, { recursive: true })

    let t = await commands({ withOwner: true, backupsDir: local, pick: local })
    await expect(t.c["backup:chooseFolder"]({ slot: 1 })).resolves.toMatchObject({ folder: null, error: expect.stringMatching(/different drive/) })

    t = await commands({ withOwner: true, backupsDir: local, pick: usb })
    await expect(t.c["backup:chooseFolder"]({ slot: 1 })).resolves.toEqual({ folder: usb })
    await expect(t.c["backup:chooseFolder"]({ slot: 2 })).resolves.toMatchObject({ folder: null, error: expect.stringMatching(/already used/) })

    const t2 = await commands({ withOwner: true, backupsDir: local, pick: join(dir, "missing") })
    await expect(t2.c["backup:chooseFolder"]({ slot: 1 })).resolves.toMatchObject({ folder: null, error: expect.stringMatching(/not connected/) })

    // test + clear
    expect(await t.c["backup:testFolder"]({ slot: 1 })).toMatchObject({ ok: true })
    await t.c["backup:clearFolder"]({ slot: 1 })
    expect(await t.c["backup:testFolder"]({ slot: 1 })).toMatchObject({ ok: false })
    void usb2
  })
  it("a limited user cannot change, test or check backup folders", async () => {
    const t = await commands({ withOwner: true })
    const role = (t.db.prepare("SELECT name FROM roles WHERE name != 'Owner / Admin' LIMIT 1").get() as { name: string }).name
    t.db.prepare("DELETE FROM role_permissions WHERE role_id = (SELECT id FROM roles WHERE name = ?)").run(role)
    t.c["user:create"]({ name: "Clerk", username: "clerk", password: "secret1", role })
    t.c["auth:logout"]?.(undefined)
    t.c["auth:login"]({ username: "clerk", password: "secret1" })
    await expect(t.c["backup:chooseFolder"]({ slot: 1 })).rejects.toThrow()
    expect(() => t.c["backup:testFolder"]({ slot: 1 })).toThrow()
    expect(() => t.c["backup:clearFolder"]({ slot: 1 })).toThrow()
    expect(() => t.c["backup:check"](undefined)).toThrow()
  })
})
