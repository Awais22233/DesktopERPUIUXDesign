// Outside backup copies (USB / Drive folder) and bringing the whole business back on a brand-new computer.
process.env.ERP_NO_RELAUNCH = "1" // a restore ends the program; this test starts the next copy itself
import { launch } from "./lib.mjs"
import { _electron as electron } from "playwright-core"
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, writeFileSync as writeFile } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
const require = createRequire(import.meta.url)
const { app, page, step, nav, finish, data, env, root, work } = await launch("cloth", "Restore House", { dataName: "Old Laptop" })
const must = (c, m) => { if (!c) throw new Error(m) }
const call = (pg, channel, payload) => pg.evaluate(async ([c, p]) => { const r = await window.api.invoke(c, p); if (!r.ok) throw new Error(c + ": " + r.error.message); return r.data }, [channel, payload])
const usb = join(work, "USB Drive ڈرائیو")
let model = {}

await step("old laptop: a business with sales, a recovery and an expense", async () => {
  await page.waitForSelector("text=Create the owner account")
  await page.locator("input[name=name]").fill("Owner")
  await page.locator("input[name=username]").fill("owner")
  await page.locator("input[name=password]").fill("secret1")
  await page.locator("input[name=again]").fill("secret1")
  await page.getByRole("button", { name: "Create account" }).click()
  await page.waitForSelector("text=Business overview")
  const snap = await call(page, "snapshot:get")
  const acct = Object.keys(snap.accounts)[0]
  const parties = []
  for (const n of ["Ali Traders", "Bilal Cloth", "Chaudhry Store"]) parties.push((await call(page, "party:save", { kind: "customer", name: n, city: "Ghotki" })).id)
  await call(page, "product:save", { company: "Fraz", article: "R-1", color: "Navy", size: "than", cost: 1000, rate: 1500, openingQty: 80 })
  const prod = (await call(page, "products:list", { query: "R-1", pageSize: 3 })).rows[0].id
  for (let i = 0; i < 5; i++) await call(page, "sale:create", { partyId: parties[i % 3], lines: [{ productId: prod, qty: 2 + i }], payments: i % 2 ? [{ account: acct, method: "Cash", amount: 1000 }] : [] })
  await call(page, "receipt:create", { partyId: parties[0], account: acct, method: "Cash", amount: 2500 })
  await call(page, "expense:create", { category: Object.values(snap.masters?.expenseCategories ?? ["Rent"])[0] ?? "Rent", amount: 700, account: acct })
  const after = await call(page, "snapshot:get")
  model = { owed: after.parties.map((p) => [p.name, p.balance]).sort(), stock: (await call(page, "products:list", { query: "R-1", pageSize: 3 })).rows[0].stock, sales: (await call(page, "docs:list", { kind: "sale", query: "", pageSize: 1 })).summary.count }
  must(model.sales === 5, "model sales")
})

await step("dashboard warns when a backup drive was chosen but no extra copy has ever been made", async () => {
  await call(page, "settings:set", { key: "backup.secondary_dir", value: join(work, "drive that is not plugged in") })
  await page.reload()
  await page.waitForSelector("text=/No extra backup copy has been made yet/")
  await page.getByRole("button", { name: "Open Backup & restore" }).click()
  await page.waitForSelector("text=/Copy 1: .*not plugged in/")
  await page.waitForSelector("text=/Not connected right now/")
})
await step("the Backup screen shows the chosen drive, copies to it, and Test works", async () => {
  mkdirSync(usb, { recursive: true })
  await call(page, "settings:set", { key: "backup.secondary_dir", value: usb })
  await page.reload()
  await page.waitForSelector("text=Business overview")
  await nav("Backup & restore")
  await page.waitForSelector("text=/Copy 1: .*USB Drive/")
  await page.getByRole("button", { name: "Backup now" }).click()
  await page.waitForSelector("text=/Backup created/")
  must(readdirSync(usb).filter((n) => n.endsWith(".db")).length === 1, "no backup file on the drive")
  must(!readdirSync(usb).some((n) => n.endsWith(".part")), "a half-written file was left")
  await page.waitForSelector("text=/Connected · last copy/")
  await page.locator('[data-slot="1"]').getByRole("button", { name: "Test" }).click()
  await page.waitForSelector("text=/Working. Backups can be copied here/")
})

await step("an unplugged drive is reported, and the next backup after plugging in clears it", async () => {
  renameSync(usb, usb + ".unplugged")
  await call(page, "backup:run")
  let st = await call(page, "backup:status")
  must(st.targets[0].available === false && /not connected/i.test(st.targets[0].error), `status while unplugged: ${JSON.stringify(st.targets[0])}`)
  renameSync(usb + ".unplugged", usb)
  await new Promise((r) => setTimeout(r, 1100))
  await call(page, "backup:run")
  st = await call(page, "backup:status")
  must(st.targets[0].available && !st.targets[0].error, `status after plugging in: ${JSON.stringify(st.targets[0])}`)
  must(readdirSync(usb).filter((n) => n.endsWith(".db")).length === 1, "same-day copies should be thinned to the newest")
})

await step("'Check my backups now' opens the backups and shows the same numbers as the live records", async () => {
  await page.reload()
  await page.waitForSelector("text=Business overview")
  await nav("Backup & restore")
  await page.getByRole("button", { name: "Check my backups now" }).click()
  await page.waitForSelector("text=Opens correctly")
  const c = await call(page, "backup:check")
  must(c.backups.length === 2 && c.backups.every((b) => b.ok), `backups checked: ${JSON.stringify(c.backups.map((b) => [b.where, b.ok]))}`)
  for (const b of c.backups) must(b.sales === model.sales && b.customers === 3, `backup ${b.where}: ${b.sales} sales ${b.customers} customers`)
  must(Math.abs(c.backups[0].receivable - c.current.receivable) < 0.01, "receivable differs between backup and live")
})

await step("close the old laptop (with two product photos on disk)", async () => {
  mkdirSync(join(data, "images"), { recursive: true })
  for (const n of ["7-deadbeef-t.jpg", "7-deadbeef-f.jpg"]) writeFile(join(data, "images", n), Buffer.from("fake photo bytes " + n))
  await call(page, "backup:run")
  must(existsSync(join(usb, "images", "7-deadbeef-f.jpg")), "photos were not copied next to the backup")
  await app.close()
})

let newPage, newApp
const newData = join(work, "New Laptop")
const launchNew = async () => {
  const a = await electron.launch({ executablePath: require("electron"), args: [root, "--no-sandbox", "--disable-gpu"], env: { ...env, ERP_DATA_DIR: newData, ERP_FORCE_CSP: "1", ERP_NO_RELAUNCH: "1" } })
  const p = await a.firstWindow(); p.setDefaultTimeout(12000)
  return [a, p]
}
await step("new laptop: the backup is found in the USB folder and restored from the first screen", async () => {
  mkdirSync(newData, { recursive: true })
  copyFileSync(join(data, "license.key"), join(newData, "license.key")) // the new computer's own key
  ;[newApp, newPage] = await launchNew()
  await newPage.waitForSelector("text=Create the owner account", { timeout: 25000 })
  await newApp.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, usb)
  await newPage.getByRole("button", { name: /I already have data/ }).click()
  await newPage.getByRole("button", { name: "Choose a folder…" }).click()
  await newPage.waitForSelector("text=/5 sales, 3 customers/")
  await newPage.getByRole("button", { name: "Restore this backup" }).click()
  await newApp.waitForEvent("close", { timeout: 30000 }).catch(() => {})
})
await step("new laptop, second start: the owner signs in with the old password and every figure matches", async () => {
  const [a, p] = await launchNew()
  try {
    await p.waitForSelector("input[name=username]", { timeout: 25000 })
    await p.locator("input[name=username]").fill("owner")
    await p.locator("input[name=password]").fill("secret1")
    await p.getByRole("button", { name: /Sign in|Log in/ }).click()
    await p.waitForSelector("text=Business overview")
    const after = await call(p, "snapshot:get")
    const owed = after.parties.map((x) => [x.name, x.balance]).sort()
    must(JSON.stringify(owed) === JSON.stringify(model.owed), `balances differ: ${JSON.stringify(owed)} vs ${JSON.stringify(model.owed)}`)
    must((await call(p, "products:list", { query: "R-1", pageSize: 3 })).rows[0].stock === model.stock, "stock differs")
    must((await call(p, "docs:list", { kind: "sale", query: "", pageSize: 1 })).summary.count === model.sales, "sales count differs")
    must((await call(p, "health:get")).integrityOk, "integrity")
    must(existsSync(join(newData, "images", "7-deadbeef-t.jpg")) && existsSync(join(newData, "images", "7-deadbeef-f.jpg")), "the photos did not come back")
    // once the business exists, the first-run restore must be impossible (it would replace live data)
    const r = await p.evaluate(async () => window.api.invoke("restore:scan", { folder: "/" }))
    must(!r.ok, "restore:scan worked on a business that already has users")
  } finally {
    await a.close()
  }
})
await step("a damaged backup is listed but cannot be chosen", async () => {
  const { writeFileSync } = await import("node:fs")
  const bad = join(work, "bad-usb")
  mkdirSync(bad, { recursive: true })
  writeFileSync(join(bad, "backup-20261023-100000-manual.db"), "not a database")
  mkdirSync(join(work, "New Laptop 2"), { recursive: true })
  copyFileSync(join(data, "license.key"), join(work, "New Laptop 2", "license.key"))
  const a = await electron.launch({ executablePath: require("electron"), args: [root, "--no-sandbox", "--disable-gpu"], env: { ...env, ERP_DATA_DIR: join(work, "New Laptop 2"), ERP_FORCE_CSP: "1" } })
  const p = await a.firstWindow(); p.setDefaultTimeout(12000)
  try {
    await p.waitForSelector("text=Create the owner account", { timeout: 25000 })
    await a.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, bad)
    await p.getByRole("button", { name: /I already have data/ }).click()
    await p.getByRole("button", { name: "Choose a folder…" }).click()
    await p.waitForSelector("text=/damaged or is not a business backup/")
    must(await p.getByRole("button", { name: "Restore this backup" }).isDisabled(), "a damaged backup can be restored")
  } finally {
    await a.close()
  }
})
await finish()
