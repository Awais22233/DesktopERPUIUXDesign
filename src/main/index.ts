import { app, BrowserWindow, dialog, Menu, session, shell } from "electron"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { handle, setLicenseGuard } from "./ipc"
import { initLogger, log } from "./logger"
import { BackupManager } from "./backupManager"
import { integrityCheck, openDatabase, type DB } from "./db/connection"
import { listBackups, restoreBackup, verifyBackup } from "./db/backup"
import { migrate } from "./db/migrate"
import { migrations } from "./db/migrations"
import { createBackup } from "./db/backup"
import { seedRoles } from "./services/auth"
import { ensureConfig, getConfig, setFlag, setProfile } from "./services/config"
import { ensureWalkInParty } from "./services/masterData"
import { FLAG_KEYS, profiles, type FlagKey } from "@shared/profiles"
import { businessSchema, ensureBusinessName, getBusiness, setBusiness } from "./services/business"
import { evaluateLicense, normalizeKey, readLastSeen, readStoredKey, storeKey, touchLastSeen } from "./license/license"
import { getMachineId } from "./license/machine"
import { PUBLIC_KEY_PEM } from "./license/publicKey"
import type { LicenseStatus } from "@shared/ipc"

const here = dirname(fileURLToPath(import.meta.url))
const SMOKE = process.env.ERP_SMOKE === "1"

const dataDir = process.env.ERP_DATA_DIR ?? join(app.getPath("userData"), "data")
const dbFile = join(dataDir, "erp.db")
const backupsDir = join(dataDir, "backups")
mkdirSync(dataDir, { recursive: true })
initLogger(join(dataDir, "logs"))

let db: DB
let backups: BackupManager
let win: BrowserWindow | null = null
let quitting = false

// Only one copy of the application may use the database at a time.
if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit()
}
app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

process.on("uncaughtException", (err) => log("error", "uncaughtException", err))
process.on("unhandledRejection", (err) => log("error", "unhandledRejection", err))

function fatal(title: string, detail: string): never {
  log("error", `${title}: ${detail}`)
  dialog.showErrorBox(title, detail)
  app.exit(1)
  throw new Error(title)
}

/** Opens the database; if it is damaged, offers to restore the newest valid backup. */
async function openSafely(): Promise<DB> {
  let handle: DB | null = null
  let problems: string[] = []
  try {
    handle = openDatabase(dbFile)
    const report = integrityCheck(handle)
    if (report.ok) return handle
    problems = report.problems
  } catch (err) {
    // Only genuine corruption may lead to the restore prompt. Anything else (a missing native
    // module, permissions, a locked file) must NOT trigger a restore, or good data could be replaced.
    const code = (err as { code?: string }).code
    if (code !== "SQLITE_CORRUPT" && code !== "SQLITE_NOTADB") {
      fatal("The application could not open its data file", `${(err as Error).message}\n\nYour data was not changed.`)
    }
    problems = [(err as Error).message]
  }
  handle?.close()
  log("error", "Database integrity problem", problems)

  const candidate = listBackups(backupsDir).find((b) => verifyBackup(b.file).ok)
  if (!candidate) fatal("The business data file is damaged", `No valid backup was found in:\n${backupsDir}\n\nDetails: ${problems.join("; ")}`)
  const choice = dialog.showMessageBoxSync({
    type: "error",
    title: "The business data file is damaged",
    message: "The data file did not pass its safety check.",
    detail: `The newest valid backup is from ${new Date(candidate.modified).toLocaleString()}.\nRestore it? The damaged file is kept as a safety copy.`,
    buttons: ["Restore backup", "Exit"],
    defaultId: 0,
    cancelId: 1,
  })
  if (choice !== 0) {
    app.exit(1)
    throw new Error("User declined restore")
  }
  restoreBackup(candidate.file, dbFile, backupsDir)
  log("warn", `Restored database from ${candidate.file}`)
  return openDatabase(dbFile)
}

async function startDatabase(): Promise<void> {
  db = await openSafely()
  try {
    await migrate(db, migrations, {
      // A safety backup is always taken before upgrading an existing database.
      beforeMigrate: async () => void (await createBackup(db, backupsDir, "pre-migrate")),
    })
  } catch (err) {
    fatal("Could not update the data file", `${(err as Error).message}\n\nYour data was not changed.`)
  }
  seedRoles(db)
  ensureConfig(db, "cloth")
  ensureWalkInParty(db)
  backups = new BackupManager(db, backupsDir)
  await backups.runIfDue()
  setInterval(() => void backups.runIfDue(), 3600 * 1000).unref()
}

let machineId: string | null = null
let licenseCache: { at: number; status: LicenseStatus } | null = null

/** Development only: `pnpm dev` can skip activation. A packaged build ignores this completely. */
const devBypass = () => !app.isPackaged && process.env.ERP_DEV_LICENSE_BYPASS === "1"

function computeLicense(keyText: string | null): LicenseStatus {
  machineId ??= getMachineId()
  if (devBypass()) return { state: "valid", machineId, message: "Development mode", client: "Development", profile: getConfig(db).profile }
  const now = new Date()
  const status = evaluateLicense(keyText, { publicKey: PUBLIC_KEY_PEM, machineId, now, lastSeen: readLastSeen(dataDir) })
  if (status.state !== "valid") return status

  // The license decides the business type. A copy of the data from another kind of business is refused.
  const cfg = getConfig(db)
  if (cfg.profile !== status.profile) {
    try {
      setProfile(db, null, status.profile!)
    } catch {
      return {
        ...status,
        state: "wrong_profile",
        message: `This license is for "${profiles[status.profile!].name}", but the data on this computer belongs to "${profiles[cfg.profile].name}".`,
      }
    }
  }
  touchLastSeen(dataDir, now)
  ensureBusinessName(db, status.client ?? "My Business")
  return status
}

function currentLicense(force = false): LicenseStatus {
  if (!force && licenseCache && Date.now() - licenseCache.at < 60_000) return licenseCache.status
  const status = computeLicense(readStoredKey(dataDir))
  licenseCache = { at: Date.now(), status }
  return status
}

function registerIpc(): void {
  setLicenseGuard(() => currentLicense().state === "valid")
  const schemaVersion = () => (db.prepare("SELECT COALESCE(MAX(id),0) v FROM schema_migrations").get() as { v: number }).v
  handle("app:info", null, () => ({ version: app.getVersion(), dataDir, schemaVersion: schemaVersion(), packaged: app.isPackaged }))
  handle("config:get", null, () => getConfig(db))
  handle("license:status", null, () => currentLicense())
  handle("license:activate", z.object({ key: z.string().min(1, "Enter your license key").max(2000) }), (p) => {
    const status = computeLicense(normalizeKey(p.key))
    if (status.state === "valid") {
      storeKey(dataDir, p.key)
      licenseCache = { at: Date.now(), status }
      log("info", `Activated for "${status.client}" (${status.licenseId})`)
      win?.setTitle(getBusiness(db).name || "Wholesale ERP")
    } else log("warn", `Activation refused: ${status.state}`)
    return status
  })
  handle("business:get", null, () => getBusiness(db))
  handle("business:set", businessSchema, (b) => {
    const saved = setBusiness(db, null, b)
    win?.setTitle(saved.name)
    return saved
  })
  handle("config:setFlag", z.object({ flag: z.enum(FLAG_KEYS as [FlagKey, ...FlagKey[]]), enabled: z.boolean() }), (p) => setFlag(db, null, p.flag, p.enabled))
  handle("backup:run", null, async () => ({ name: (await backups.run("manual")).split(/[\\/]/).pop()! }))
  handle("backup:list", null, () => backups.list())
  handle("health:get", null, () => {
    const r = integrityCheck(db)
    return { integrityOk: r.ok, lastBackupAt: backups.lastBackupAt(), problems: r.problems }
  })
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: "#f4f6fa",
    title: "Wholesale ERP",
    webPreferences: {
      preload: join(here, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      // No developer tools in the shipped application (they would expose the UI to tampering).
      devTools: !app.isPackaged,
    },
  })
  win.once("ready-to-show", () => win?.show())
  // No navigation away from the app and no pop-up windows.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: "deny" }
  })
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("file://") && !url.startsWith(process.env.ELECTRON_RENDERER_URL ?? "file://")) e.preventDefault()
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(here, "../renderer/index.html"))
}

async function smoke(): Promise<void> {
  const w = win!
  await new Promise<void>((r) => w.webContents.once("did-finish-load", () => r()))
  await new Promise((r) => setTimeout(r, 1200))
  const key = JSON.stringify(process.env.ERP_SMOKE_LICENSE ?? "")
  const js = `(async () => {
    const api = window.api
    const before = { status: await api.invoke('license:status'), config: await api.invoke('config:get'), business: await api.invoke('business:get') }
    const bad = await api.invoke('license:activate', { key: 'ERP1.bad.key' })
    const good = ${key} ? await api.invoke('license:activate', { key: ${key} }) : null
    const after = good ? { config: await api.invoke('config:get'), business: await api.invoke('business:get'),
      saved: await api.invoke('business:set', { name: 'Faraz Cloth House', tagline: 'Wholesale cloth', owner: 'Faraz', phone: '0300', email: '', address: 'Market', city: 'Ghotki', logo: '', invoiceFooter: 'Thanks' }),
      badLogo: await api.invoke('business:set', { name: 'X', tagline: '', owner: '', phone: '', email: '', address: '', city: '', logo: 'javascript:alert(1)', invoiceFooter: '' }),
      setProfileChannel: await api.invoke('config:setProfile', { profile: 'cosmetics' }).catch((e) => String(e.message)) } : null
    return { before, bad, good, after, hasNodeInRenderer: typeof require !== 'undefined' || typeof process !== 'undefined', title: document.title,
      nav: [...document.querySelectorAll('nav .nav-item span')].length, activationShown: !!document.querySelector('.activation-card'),
      brand: document.querySelector('.brand-lockup strong, .sidebar-brand strong')?.textContent }
  })()`
  const result = await w.webContents.executeJavaScript(js)
  const shot = process.env.ERP_SMOKE_SHOT
  if (shot) writeFileSync(shot, (await w.webContents.capturePage()).toPNG())
  if (process.env.ERP_SMOKE_LICENSE && shot) {
    // After activation, reload the way a restart would and capture the real application.
    w.webContents.reload()
    await new Promise<void>((r) => w.webContents.once("did-finish-load", () => r()))
    await new Promise((r) => setTimeout(r, 1500))
    writeFileSync(shot.replace(".png", "-after.png"), (await w.webContents.capturePage()).toPNG())
  }
  console.log("SMOKE_RESULT " + JSON.stringify(result))
  await backups.run("close")
  db.close()
  app.exit(0)
}

app.whenReady().then(async () => {
  if (app.isPackaged) {
    Menu.setApplicationMenu(null)
    session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
      cb({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'"],
        },
      })
    })
  }
  await startDatabase()
  registerIpc()
  createWindow()
  log("info", `Started v${app.getVersion()} (schema ${migrations.at(-1)!.id}), data in ${dataDir}`)
  if (SMOKE) await smoke()
})

// Final automatic backup when the user closes the application.
app.on("before-quit", (event) => {
  if (quitting || !db || SMOKE) return
  quitting = true
  event.preventDefault()
  const done = () => {
    try {
      db.close()
    } catch {
      /* already closed */
    }
    app.exit(0)
  }
  const timeout = setTimeout(done, 15_000)
  backups
    .run("close")
    .catch((err) => log("error", "Backup on close failed", err))
    .finally(() => {
      clearTimeout(timeout)
      done()
    })
})

app.on("window-all-closed", () => app.quit())
void existsSync
