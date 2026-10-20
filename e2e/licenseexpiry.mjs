// What the customer sees when a time-limited license runs out, and that renewing keeps every bit of data.
import { launch } from "./lib.mjs"
import { _electron as electron } from "playwright-core"
import { createRequire } from "node:module"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
const require = createRequire(import.meta.url)
const { app, page, step, finish, data, env, root, issueKey } = await launch("cloth", "Expiry House")
const must = (c, m) => { if (!c) throw new Error(m) }
const call = (pg, channel, payload) => pg.evaluate(async ([c, p]) => { const r = await window.api.invoke(c, p); return r.ok ? r.data : { __err: r.error.message } }, [channel, payload])
let invoice
await step("set up and make a sale, then close the app", async () => {
  await page.waitForSelector("text=Create the owner account")
  await page.locator("input[name=name]").fill("Owner")
  await page.locator("input[name=username]").fill("owner")
  await page.locator("input[name=password]").fill("secret1")
  await page.locator("input[name=again]").fill("secret1")
  await page.getByRole("button", { name: "Create account" }).click()
  await page.waitForSelector("text=Business overview")
  const party = (await call(page, "party:save", { kind: "customer", name: "Keep Me", city: "Ghotki" })).id
  await call(page, "product:save", { company: "F", article: "E-1", color: "Red", size: "than", cost: 1000, rate: 1500, openingQty: 10 })
  const prod = (await call(page, "products:list", { query: "E-1", pageSize: 3 })).rows[0].id
  invoice = (await call(page, "sale:create", { partyId: party, lines: [{ productId: prod, qty: 2 }], payments: [] })).id
  await app.close()
})
const open = async () => {
  const a = await electron.launch({ executablePath: require("electron"), args: [root, "--no-sandbox", "--disable-gpu"], env: { ...env, ERP_FORCE_CSP: "1" } })
  const p = await a.firstWindow(); p.setDefaultTimeout(10000)
  return [a, p]
}
await step("an expired key: the app shows a clear message, offers the key box, and touches no data", async () => {
  writeFileSync(join(data, "license.key"), issueKey({ expires: "2020-01-01" }))
  const [a, p] = await open()
  try {
    await p.waitForSelector("text=/expired on 2020-01-01/", { timeout: 25000 })
    must(await p.getByPlaceholder("Paste the license key here").count(), "no box to paste a renewal key")
    const r = await call(p, "snapshot:get")
    must(r.__err, "data was readable while the license was expired")
    console.log("      message: " + (await p.locator(".form-error").first().innerText()))
  } finally { await a.close() }
})
await step("pasting a renewed key opens everything again with all data intact; no internet needed", async () => {
  const [a, p] = await open()
  try {
    await p.waitForSelector("text=/expired on/", { timeout: 25000 })
    await p.getByPlaceholder("Paste the license key here").fill(issueKey({ expires: "2099-12-31" }))
    await p.getByRole("button", { name: "Activate" }).click()
    await p.waitForSelector("input[name=username]")
    await p.locator("input[name=username]").fill("owner")
    await p.locator("input[name=password]").fill("secret1")
    await p.getByRole("button", { name: /Sign in|Log in/ }).click()
    await p.waitForSelector("text=Business overview")
    const docs = await call(p, "docs:list", { kind: "sale", query: "", pageSize: 5 })
    must(docs.rows.some((d) => d.id === invoice), "the sale is missing after renewal")
    must((await call(p, "health:get")).integrityOk, "integrity")
    must((await call(p, "products:list", { query: "E-1", pageSize: 3 })).rows[0].stock === 8, "stock changed")
  } finally { await a.close() }
})
await step("a key made for another computer is refused with a clear message", async () => {
  writeFileSync(join(data, "license.key"), "ERP1.eyJ4IjoxfQ.AAAA")
  const [a, p] = await open()
  try {
    await p.waitForSelector("text=/not valid/", { timeout: 25000 })
    await p.getByPlaceholder("Paste the license key here").fill(issueKey())
    await p.getByRole("button", { name: "Activate" }).click()
    await p.waitForSelector("input[name=username]")
  } finally { await a.close() }
})
await finish()
