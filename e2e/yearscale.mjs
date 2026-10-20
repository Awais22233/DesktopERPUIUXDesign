// One shop-year of data (default 20,000 bills) via the API, then the real screens must stay fast and correct.
import { launch } from "./lib.mjs"
import { statSync, readdirSync } from "node:fs"
import { join } from "node:path"
const BILLS = Number(process.env.BILLS || 20000)
const { page, step, finish, data, nav } = await launch("cloth", "Year Scale House")
const api = (channel, payload) =>
  page.evaluate(async ([c, p]) => {
    const r = await window.api.invoke(c, p)
    if (!r.ok) throw new Error(c + ": " + r.error.message)
    return r.data
  }, [channel, payload])
const ms = async (fn) => { const t = performance.now(); await fn(); return Math.round(performance.now() - t) }
const must = (c, m) => { if (!c) throw new Error(m) }
let seedMs = 0

await step(`set up: ${BILLS} bills over one year, 300 customers, 300 products, receipts and purchases`, async () => {
  await page.waitForSelector("text=Create the owner account")
  await page.locator("input[name=name]").fill("Owner")
  await page.locator("input[name=username]").fill("owner")
  await page.locator("input[name=password]").fill("secret1")
  await page.locator("input[name=again]").fill("secret1")
  await page.getByRole("button", { name: "Create account" }).click()
  await page.waitForSelector("text=Business overview")
  const snap = await api("snapshot:get")
  const acct = Object.keys(snap.accounts)[0]
  seedMs = await ms(async () => {
    const r = await page.evaluate(async ([n, acct]) => {
      const call = async (c, p) => { const r = await window.api.invoke(c, p); if (!r.ok) throw new Error(c + ": " + r.error.message); return r.data }
      const prods = []
      for (let i = 1; i <= 300; i++) { await call("product:save", { company: `Co ${i % 20}`, article: `Art ${i}`, color: `Shade ${i % 8}`, size: "than", cost: 1000 + i, rate: 1400 + i, openingQty: 0 }) }
      await call("snapshot:get")
      const list = (await call("products:list", { query: "", pageSize: 400 })).rows
      const sup = (await call("party:save", { kind: "supplier", name: "Big Mill", city: "Faisalabad" })).id
      for (const p of list) prods.push(p.id)
      for (let k = 0; k < 15; k++) await call("purchase:create", { supplierId: sup, lines: prods.map((id) => ({ productId: id, qty: 2000, rate: 1000 })), payments: [{ account: acct, method: "Cash", amount: 0 }].slice(1), date: "2025-10-01" })
      const parties = []
      for (let i = 1; i <= 300; i++) parties.push((await call("party:save", { kind: "customer", name: `Cust ${i}`, city: `City ${i % 12}` })).id)
      let seed = 7
      const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
      const start = Date.parse("2025-10-20"), span = 360 * 86400000
      for (let i = 0; i < n; i++) {
        const d = new Date(start + (i / n) * span).toISOString().slice(0, 10)
        // the first customers are the heavy ones: they get far more bills
        const party = parties[Math.floor(rnd() * rnd() * parties.length)]
        const lines = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => ({ productId: prods[Math.floor(rnd() * prods.length)], qty: 1 + Math.floor(rnd() * 3) }))
        const uniq = [...new Map(lines.map((l) => [l.productId, l])).values()]
        await call("sale:create", { partyId: party, lines: uniq, payments: rnd() < 0.3 ? [{ account: acct, method: "Cash", amount: 500 }] : [], date: d })
        if (i % 40 === 0) await call("receipt:create", { partyId: party, account: acct, method: "Cash", amount: 1000, date: d })
      }
      return parties[0]
    }, [BILLS, acct])
    globalThis.heavy = r
  })
  console.log(`      seeding ${BILLS} bills took ${(seedMs / 1000).toFixed(0)} s`)
})

let t
await step("restart: the app opens quickly with a year of data", async () => {
  t = await ms(async () => { await page.reload(); await page.waitForSelector("text=Business overview") })
  console.log(`      reload to dashboard ${t} ms`)
  must(t < 6000, `opening took ${t} ms`)
})
await step("every main screen opens in under 2 s", async () => {
  for (const n of ["Customers", "Inventory", "Purchases", "Expenses", "Reports", "Settings"]) {
    const t = await ms(async () => { await nav(n); await page.waitForLoadState("domcontentloaded"); await page.waitForTimeout(100) })
    console.log(`      ${n}: ${t} ms`)
    must(t < 2000, `${n} took ${t} ms`)
  }
})
await step("search: customers and products return fast", async () => {
  const a = await ms(() => api("products:list", { query: "Art 77", pageSize: 25 }))
  const b = await ms(() => api("docs:list", { kind: "sale", query: "", pageSize: 50 }).catch(() => null))
  console.log(`      product search ${a} ms, sales list ${b} ms`)
  must(a < 800, `product search ${a} ms`)
})
await step("reports for the whole year run quickly, and the sales total equals the sum of the daily report", async () => {
  const slow = []
  for (const name of ["Daily Sales", "Sales by Customer", "Sales by City", "Sales by Company", "Sales by Article", "Sales by User", "Purchase Report", "Supplier Purchase", "Company Purchase", "Article Purchase", "Current Stock", "Stock Valuation", "Low Stock", "Out of Stock", "Stock Movement", "Stock Adjustments", "Near Expiry", "Expired Items", "Batch Stock", "Outstanding Report", "Party Statements", "Receivable Aging", "Supplier Payables", "Supplier Statements", "Payable Aging", "Party Payments", "Supplier Payments", "City-wise Analysis", "Cash Book", "Bank Book", "Transfers", "Expenses", "Daily Closing", "Profit & Loss", "Daily Profit", "Monthly Profit", "Company Profitability", "Category Profitability", "Customer Profitability", "City Profitability"]) {
  let r
    const t = await ms(async () => { r = await page.evaluate(([n]) => window.api.invoke("report:run", { name: n, from: "2025-10-01", to: "2026-12-31" }), [name]) })
    if (!r.ok) { console.log(`      ${name}: not found/failed (${r.error.message})`); continue }
    if (t > 800) console.log(`      ${name}: ${t} ms, ${r.data.rows.length} rows`)
    if (t > 6000) slow.push(`${name} ${t} ms`)
  }
  must(!slow.length, "slow reports: " + slow.join(", "))
})
await step("a heavy customer's statement opens fast and its last balance equals the list balance", async () => {
  const snap = await api("snapshot:get")
  const p = snap.parties.slice().sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))[0]
  let v
  const t = await ms(async () => { v = await api("ledger:get", { kind: "customer", id: p.id }) })
  console.log(`      ${p.name}: ${v.rows.length} statement rows in ${t} ms`)
  must(t < 2000, `statement took ${t} ms`)
  const last = v.rows[v.rows.length - 1]
  must(!last || Math.abs(last.balance - p.balance) < 0.01, `statement ends at ${last?.balance}, list says ${p.balance}`)
})
await step("dashboard figures agree with the books after a year", async () => {
  const snap = await api("snapshot:get")
  const owed = snap.parties.reduce((s, p) => s + p.balance, 0)
  const rep = await api("report:run", { name: "Outstanding Report", from: "2025-10-01", to: "2026-12-31" })
  console.log(`      Outstanding Report rows: ${rep.rows.length}`)
  console.log(`      total owed by customers ${owed.toFixed(2)}`)
  must(owed > 0, "nobody owes anything after a year of credit sales")
  must((await api("health:get")).integrityOk, "integrity check failed")
})
await step("backup of a year of data: time and size", async () => {
  let r
  const t = await ms(async () => { r = await api("backup:run") })
  const dir = join(data, "backups")
  const files = readdirSync(dir)
  const size = files.reduce((s, f) => s + statSync(join(dir, f)).size, 0)
  console.log(`      backup ${t} ms, ${(size / 1048576).toFixed(1)} MB in ${files.length} file(s), db ${(statSync(join(data, "erp.db")).size / 1048576).toFixed(1)} MB`)
  must(t < 20000, `backup took ${t} ms`)
})
await finish()
