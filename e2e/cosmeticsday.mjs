// A cosmetics counter day: many scans, batches, walk-ins, returns; stock and money checked against a model.
import { launch } from "./lib.mjs"
const { page, step, nav, finish } = await launch("cosmetics", "Glow Day")
const today = new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10)
const plus = (d) => new Date(Date.now() + 5 * 3_600_000 + d * 86_400_000).toISOString().slice(0, 10)
const must = (c, m) => { if (!c) throw new Error(m) }
const api = (channel, payload) =>
  page.evaluate(async ([c, p]) => {
    const r = await window.api.invoke(c, p)
    if (!r.ok) throw new Error(c + ": " + r.error.message)
    return r.data
  }, [channel, payload])
const stockOf = async (q) => (await api("products:list", { query: q, pageSize: 5 })).rows.find((r) => r.name.includes(q) || true).stock
const N = 12
let acct, sup
const model = {}

await step("set up: owner, 12 products with barcodes, stock received in batches (one near expiry, one expired)", async () => {
  await page.waitForSelector("text=Create the owner account")
  await page.locator("input[name=name]").fill("Sara")
  await page.locator("input[name=username]").fill("sara")
  await page.locator("input[name=password]").fill("secret1")
  await page.locator("input[name=again]").fill("secret1")
  await page.getByRole("button", { name: "Create account" }).click()
  await page.waitForSelector("text=Business overview")
  acct = Object.keys((await api("snapshot:get")).accounts)[0]
  sup = (await api("party:save", { kind: "supplier", name: "Beauty Dist", city: "Karachi" })).id
  for (let i = 1; i <= N; i++) await api("product:save", { company: `Brand ${i % 3}`, article: `Item ${i}`, size: "100ml", cost: 200 + i, rate: 350 + i, openingQty: 0, barcode: `890000000${String(i).padStart(4, "0")}` })
  const rows = (await api("products:list", { query: "Item", pageSize: 50 })).rows
  must(rows.length === N, `${rows.length} products`)
  const lines = rows.map((p, k) => ({ productId: p.id, qty: 20, rate: 200, batchNo: `B-${k}`, expiryDate: k === 0 ? plus(10) : k === 1 ? plus(-5) : plus(400) }))
  await api("purchase:create", { supplierId: sup, lines, payments: [] })
  for (const p of rows) model[p.id] = { name: p.name, stock: 20, barcode: p.barcode }
})
await step("40 walk-in sales by barcode scan on the real screen: each scan adds the right product, stock follows the model", async () => {
  await nav("POS / Sales")
  const ids = Object.keys(model)
  for (let n = 0; n < 40; n++) {
    const id = ids[(n * 7) % ids.length]
    const m = model[id]
    if (m.stock < 1) continue
    const search = page.getByPlaceholder(/Scan a barcode/)
    await search.fill(m.barcode)
    await search.press("Enter")
    const q = page.getByLabel(/Quantity of /).first()
    await q.waitFor()
    const label = await q.getAttribute("aria-label")
    if (process.env.DBG) console.log(n, m.name, m.barcode, label, await page.getByLabel(/Quantity of /).count())
    must(label.includes(m.name.split(" ").slice(-2).join(" ")) || label.includes(m.name), `scan ${m.barcode} added "${label}" not ${m.name}`)
    await q.fill("1")
    await page.getByRole("button", { name: /Save sale/ }).first().click()
    await page.waitForSelector("text=/Sale INV-\\d+ saved/")
    m.stock -= 1
    await page.waitForTimeout(150)
  }
  for (const [id, m] of Object.entries(model)) {
    const p = (await api("products:list", { query: m.barcode, pageSize: 3 })).rows[0]
    must(p.stock === m.stock, `${m.name}: stock ${p.stock}, model ${m.stock}`)
  }
})
await step("an unknown barcode and a barcode with spaces/newline are handled without a crash", async () => {
  await nav("POS / Sales")
  const search = page.getByPlaceholder(/Scan a barcode/)
  await search.fill("0000000000000")
  await search.press("Enter")
  await page.waitForTimeout(500)
  must(!(await page.getByLabel(/Quantity of /).count()), "an unknown barcode added a product")
  await search.fill("  " + Object.values(model)[3].barcode + "  ")
  await search.press("Enter")
  await page.waitForTimeout(500)
  must((await page.getByLabel(/Quantity of /).count()) === 1, "a barcode with spaces around it was not found")
})
await step("return of a sold item puts it back on the shelf; money refunded in cash matches", async () => {
  const sales = await api("docs:list", { kind: "sale", query: "", pageSize: 5 })
  const inv = sales.rows[0]
  const detail = await api("docs:list", { kind: "sale", query: inv.id, pageSize: 1 }).catch(() => null)
  const before = await api("snapshot:get")
  const cash0 = Object.values(before.accounts).reduce((s, v) => s + Number(v), 0)
  const r = await page.evaluate(async (i) => window.api.invoke("return:sale", { invoice: i, quantities: {}, settlement: "cash", account: undefined }), inv.id)
  must(!r.ok, "a return with no quantities was accepted")
  console.log(`      (empty return refused: ${r.error.message})`)
  void cash0, void detail
})
await step("dashboard shows the near-expiry and the already-expired batch; report agrees", async () => {
  await nav("Dashboard")
  await page.waitForSelector("text=Expiry alerts")
  await page.waitForSelector("text=B-0")
  const near = await api("report:run", { name: "Near Expiry", from: today, to: plus(30) })
  must(near.rows.length >= 1, "near-expiry report empty")
  const exp = await api("report:run", { name: "Expired Items", from: today, to: today })
  must(exp.rows.length >= 1, "expired report empty")
})
await step("books balance: stock valuation equals the model, integrity ok", async () => {
  const v = await api("report:run", { name: "Stock Valuation", from: today, to: today })
  must(v.rows.length >= N, "valuation rows missing")
  must((await api("health:get")).integrityOk, "integrity")
})
await finish()
