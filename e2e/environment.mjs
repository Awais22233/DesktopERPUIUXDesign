// A customer's real PC: odd folder names, a second click on the icon, and a power cut in the middle of work.
import { launch } from "./lib.mjs"
import { _electron as electron } from "playwright-core"
import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import { existsSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
const require = createRequire(import.meta.url)
const { app, page, step, finish, data, env, root } = await launch("cloth", "Environment House", { dataName: "Shop Data ڈیٹا (کراچی)" })
const must = (c, m) => { if (!c) throw new Error(m) }
const call = (pg, channel, payload) =>
  pg.evaluate(async ([c, p]) => {
    const r = await window.api.invoke(c, p)
    if (!r.ok) throw new Error(c + ": " + r.error.message)
    return r.data
  }, [channel, payload])
let acct, party, prod

await step("a data folder with spaces and Urdu letters works: set up, sell, back up", async () => {
  await page.waitForSelector("text=Create the owner account")
  await page.locator("input[name=name]").fill("Owner")
  await page.locator("input[name=username]").fill("owner")
  await page.locator("input[name=password]").fill("secret1")
  await page.locator("input[name=again]").fill("secret1")
  await page.getByRole("button", { name: "Create account" }).click()
  await page.waitForSelector("text=Business overview")
  must(data.includes("ڈیٹا"), "test folder name wrong")
  const snap = await call(page, "snapshot:get")
  acct = Object.keys(snap.accounts)[0]
  party = (await call(page, "party:save", { kind: "customer", name: "Zain Cloth", city: "Karachi" })).id
  await call(page, "product:save", { company: "Fraz", article: "Pwr-1", color: "Black", size: "than", cost: 1000, rate: 1500, openingQty: 100 })
  prod = (await call(page, "products:list", { query: "Pwr-1", pageSize: 5 })).rows[0].id
  const s = await call(page, "sale:create", { partyId: party, lines: [{ productId: prod, qty: 3 }], payments: [] })
  must(s.id, "sale not saved")
  await call(page, "backup:run")
  must(existsSync(join(data, "erp.db")), "database not in the Urdu/space folder")
  must(readdirSync(join(data, "backups")).length >= 1, "no backup file in the Urdu/space folder")
})

await step("clicking the icon a second time does not open a second copy (it exits quickly, the first stays up)", async () => {
  const child = spawn(require("electron"), [root, "--no-sandbox", "--disable-gpu"], { env: { ...env, ERP_FORCE_CSP: "1" }, stdio: "ignore" })
  const code = await new Promise((res) => {
    const t = setTimeout(() => { child.kill("SIGKILL"); res("still running") }, 15000)
    child.on("exit", (c) => { clearTimeout(t); res(c) })
  })
  must(code !== "still running", "a second copy stayed open")
  must(await page.evaluate(() => document.body.innerText.includes("Business overview")), "the first copy was disturbed")
})

await step("power cut: kill the app by force right after a sale; on restart nothing is lost and the file is healthy", async () => {
  const before = await call(page, "sale:create", { partyId: party, lines: [{ productId: prod, qty: 2 }], payments: [] })
  const pid = app.process().pid
  process.kill(pid, "SIGKILL")
  await new Promise((r) => setTimeout(r, 1500))
  const app2 = await electron.launch({ executablePath: require("electron"), args: [root, "--no-sandbox", "--disable-gpu"], env: { ...env, ERP_FORCE_CSP: "1" } })
  const p2 = await app2.firstWindow()
  p2.setDefaultTimeout(10000)
  try {
    await p2.waitForSelector("text=Sign in", { timeout: 25000 }).catch(() => p2.waitForSelector("input[name=username]"))
    await p2.locator("input[name=username]").fill("owner")
    await p2.locator("input[name=password]").fill("secret1")
    await p2.getByRole("button", { name: /Sign in|Log in/ }).click()
    await p2.waitForSelector("text=Business overview")
    must((await call(p2, "health:get")).integrityOk, "database damaged after a power cut")
    const docs = await call(p2, "docs:list", { kind: "sale", query: "", pageSize: 20 })
    must(docs.rows.some((d) => d.id === before.id), `the sale ${before.id} saved just before the cut is missing`)
    const stock = (await call(p2, "products:list", { query: "Pwr-1", pageSize: 5 })).rows[0].stock
    must(stock === 95, `stock after 2 sales of 3 and 2 from 100 should be 95, is ${stock}`)
    const led = await call(p2, "ledger:get", { kind: "customer", id: party })
    must(led.rows.at(-1).balance === 7500, `customer owes ${led.rows.at(-1).balance}, should be 7500`)
  } finally {
    await app2.close().catch(() => {})
  }
})
await finish()
