import { app, BrowserWindow, dialog, Menu, session, shell } from "electron"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { handle } from "./ipc"
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
import { FLAG_KEYS, type FlagKey } from "@shared/profiles"

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

function registerIpc(): void {
  const schemaVersion = () => (db.prepare("SELECT COALESCE(MAX(id),0) v FROM schema_migrations").get() as { v: number }).v
  handle("app:info", null, () => ({ version: app.getVersion(), dataDir, schemaVersion: schemaVersion(), packaged: app.isPackaged }))
  handle("config:get", null, () => getConfig(db))
  handle("config:setProfile", z.object({ profile: z.enum(["cloth", "cosmetics"]) }), (p) => setProfile(db, null, p.profile))
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
  const js = `(async () => ({
    info: await window.api.invoke('app:info'),
    config: await window.api.invoke('config:get'),
    health: await window.api.invoke('health:get'),
    bad: await window.api.invoke('config:setFlag', { flag: 'nope', enabled: true }),
    hasNodeInRenderer: typeof require !== 'undefined' || typeof process !== 'undefined',
    font: getComputedStyle(document.body).fontFamily,
    nav: [...document.querySelectorAll('nav .nav-item span')].map(s => s.textContent),
  }))()`
  const result = await w.webContents.executeJavaScript(js)
  const shot = process.env.ERP_SMOKE_SHOT
  if (shot) writeFileSync(shot, (await w.webContents.capturePage()).toPNG())
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
