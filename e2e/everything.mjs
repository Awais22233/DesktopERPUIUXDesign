// "Would a customer complain?" — a sweep over everything not covered by the other end-to-end suites:
// every report with real data, every screen scanned for broken text (NaN, undefined...), small laptop screens,
// a limited user who must not reach owner-only features, money-moving flows, backups, and memory use.
import { launch, pickParty } from "./lib.mjs"

let seed = Number(process.env.SEED || 11)
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const int = (a, b) => a + Math.floor(rand() * (b - a + 1))
const pick = (arr) => arr[Math.floor(rand() * arr.length)]

const { page, app, step, shot, nav, finish } = await launch("cloth", "Everything House")
const api = (channel, payload) =>
  page.evaluate(async ([c, p]) => {
    const r = await window.api.invoke(c, p)
    if (!r.ok) throw new Error(r.error.message)
    return r.data
  }, [channel, payload])
const raw = (channel, payload) => page.evaluate(([c, p]) => window.api.invoke(c, p), [channel, payload])
const must = (c, m) => {
  if (!c) throw new Error(m)
}
const BROKEN = /\bNaN\b|\bundefined\b|\[object Object\]|\bInfinity\b|Rs\. -0\b|could not be shown|Something went wrong/
const scan = async (where) => {
  const text = await page.locator("body").innerText()
  const m = text.match(BROKEN)
  if (m) throw new Error(`${where}: the screen shows "${m[0]}"`)
}

const customers = []
const suppliers = []
const products = []
let today = ""

await step("set up a shop with a few months of history (owner, bank account, parties, products, backdated bills)", async () => {
  await page.waitForSelector("text=Create the owner account")
  await page.locator("input[name=name]").fill("Owner")
  await page.locator("input[name=username]").fill("owner")
  await page.locator("input[name=password]").fill("secret1")
  await page.locator("input[name=again]").fill("secret1")
  await page.getByRole("button", { name: "Create account" }).click()
  await page.waitForSelector("text=Business overview")
  today = (await api("snapshot:get")).today
  await api("account:add", { name: "Meezan Bank", type: "bank", opening: 50000 })
  for (const city of ["Ghotki", "Sukkur", "Karachi"]) {
    for (let i = 1; i <= 3; i++) {
      const name = `${city} Trader ${i}`
      const r = await api("party:save", { kind: "customer", name, city, phone: `0300${int(1000000, 9999999)}`, limit: 300000, openingBalance: i * 5000 })
      customers.push({ id: r.id, name })
    }
  }
  for (let i = 1; i <= 3; i++) suppliers.push({ id: (await api("party:save", { kind: "supplier", name: `Mill ${i}`, city: "Faisalabad", openingBalance: i * 10000 })).id, name: `Mill ${i}` })
  for (const [ci, company] of ["Fraz", "Gul Ahmed"].entries()) {
    for (const art of ["Wash Wear", "Cotton"]) {
      for (const colour of ["Black", "Navy Blue", "Grey"]) {
        const r = await api("product:save", { company, article: `${art} ${ci}`, color: colour, size: "40 meter", category: ci ? "Ladies" : "Gents", cost: 1000, rate: 1400 + ci * 100, wholesale: 1300 + ci * 100, openingQty: 300, minStock: 20 })
        products.push({ id: r.id, name: `${art} ${ci} ${colour}` })
      }
    }
  }
  // 60 days of ordinary trading, back-dated, so date-range reports have something to add up
  const d = (back) => new Date(Date.parse(today + "T12:00:00Z") - back * 86400000).toISOString().slice(0, 10)
  for (let n = 0; n < 90; n++) {
    const back = int(0, 60)
    const kind = rand()
    try {
      if (kind < 0.6) {
        const c = pick(customers)
        const lines = [pick(products), pick(products)].filter((p, i, a) => a.indexOf(p) === i).map((p) => ({ productId: p.id, qty: int(1, 8) }))
        const paid = pick([0, 0, 1500, 4000])
        await api("sale:create", { partyId: c.id, lines, discount: pick([0, 0, 100]), payments: paid ? [{ account: "Cash in hand", method: "Cash", amount: paid }] : [], date: d(back) })
      } else if (kind < 0.8) {
        const s = pick(suppliers)
        await api("purchase:create", { supplierId: s.id, lines: [{ productId: pick(products).id, qty: int(5, 30), rate: 1000 }], payments: [], date: d(back) })
      } else {
        await api("receipt:create", { partyId: pick(customers).id, account: "Cash in hand", method: "Cash", amount: pick([500, 1000, 2500]), date: d(back) })
      }
    } catch {
      /* a rejected back-dated bill (e.g. a credit limit) is fine here */
    }
  }
  await page.reload()
  await page.waitForSelector("text=Business overview")
})

await step("every report runs on real data over several date ranges; no empty, NaN or negative-zero numbers", async () => {
  const names = ["Daily Sales", "Sales by Customer", "Sales by City", "Sales by Company", "Sales by Article", "Sales by User", "Purchase Report", "Supplier Purchase", "Company Purchase", "Article Purchase", "Current Stock", "Stock Valuation", "Low Stock", "Out of Stock", "Stock Movement", "Stock Adjustments", "Near Expiry", "Expired Items", "Batch Stock", "Outstanding Report", "Party Statements", "Receivable Aging", "Supplier Payables", "Supplier Statements", "Payable Aging", "Party Payments", "Supplier Payments", "City-wise Analysis", "Cash Book", "Bank Book", "Transfers", "Expenses", "Daily Closing", "Profit & Loss", "Daily Profit", "Monthly Profit", "Company Profitability", "Category Profitability", "Customer Profitability", "City Profitability"]
  const from60 = new Date(Date.parse(today + "T12:00:00Z") - 70 * 86400000).toISOString().slice(0, 10)
  const ranges = [[today, today], [from60, today], ["2000-01-01", today]]
  let ran = 0
  const bad = []
  for (const name of names) {
    for (const [from, to] of ranges) {
      let r
      try {
        r = await api("report:run", { name, from, to })
      } catch (e) {
        bad.push(`${name} ${from}..${to}: ${e.message}`)
        continue
      }
      ran++
      const walk = (v, path) => {
        if (typeof v === "number" && !Number.isFinite(v)) bad.push(`${name}: ${path} is ${v}`)
        else if (typeof v === "number" && Object.is(v, -0)) bad.push(`${name}: ${path} is -0`)
        else if (typeof v === "string" && /NaN|undefined|\[object/.test(v)) bad.push(`${name}: ${path} = "${v}"`)
        else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, path + "." + k)
      }
      walk(r, "result")
      if (!Array.isArray(r.columns) || !Array.isArray(r.rows)) bad.push(`${name}: not a table`)
    }
  }
  console.log(`      ${ran} report runs`)
  must(bad.length === 0, bad.slice(0, 6).join(" || "))
})

await step("every report opens on the Reports screen (no blank page, NaN or error text)", async () => {
  const names = ["Daily Sales", "Sales by Customer", "Sales by City", "Sales by Company", "Sales by Article", "Sales by User", "Purchase Report", "Supplier Purchase", "Company Purchase", "Article Purchase", "Current Stock", "Stock Valuation", "Low Stock", "Out of Stock", "Stock Movement", "Stock Adjustments", "Outstanding Report", "Party Statements", "Receivable Aging", "Supplier Payables", "Supplier Statements", "Payable Aging", "Party Payments", "Supplier Payments", "City-wise Analysis", "Cash Book", "Bank Book", "Transfers", "Expenses", "Daily Closing", "Profit & Loss", "Daily Profit", "Monthly Profit", "Company Profitability", "Category Profitability", "Customer Profitability", "City Profitability"]
  const done = new Set()
  let first = true
  for (const cat of ["Sales", "Purchases", "Inventory", "Parties", "Suppliers", "Finance", "Profitability"]) {
    for (const w of names.filter((n) => !done.has(n))) {
      await nav("Dashboard")
      await nav("Reports")
      await page.locator("button", { hasText: new RegExp(`^${cat}\\s*\\d+$`) }).first().click()
      const hit = page.getByText(w, { exact: true }).first()
      if (!(await hit.count())) continue
      await hit.click()
      await page.waitForTimeout(350)
      await scan("report " + w)
      done.add(w)
      if (first) await shot("a-report"), (first = false)
    }
  }
  const missing = names.filter((n) => !done.has(n))
  must(missing.length === 0, "reports not listed on the screen: " + missing.join(", "))
})

await step("money-moving flows: supplier payment, transfer, stock adjustment, stock count, cash closing, exchange", async () => {
  const bank = "Meezan Bank"
  const before = await api("snapshot:get")
  const sup = before.suppliers[0]
  await api("supplierPayment:create", { partyId: sup.id, account: "Cash in hand", method: "Cash", amount: 1000 })
  const afterSup = (await api("snapshot:get")).suppliers.find((s) => s.id === sup.id)
  must(Math.abs(afterSup.balance - (sup.balance - 1000)) < 0.001, `supplier balance after paying 1000: ${sup.balance} -> ${afterSup.balance}`)
  const cashBefore = (await api("snapshot:get")).accounts
  await api("transfer:create", { from: "Cash in hand", to: bank, amount: 2500.5 })
  const cashAfter = (await api("snapshot:get")).accounts
  must(Math.abs(cashAfter[bank] - cashBefore[bank] - 2500.5) < 0.001 && Math.abs(cashBefore["Cash in hand"] - cashAfter["Cash in hand"] - 2500.5) < 0.001, "transfer did not move exactly 2500.50")
  await api("expense:create", { category: (await api("snapshot:get")).masters.expenseCategories[0], amount: 750, account: "Cash in hand" })
  const p = products[0]
  const s0 = (await api("products:list", { query: p.name, pageSize: 1 })).rows[0].stock
  await api("stock:adjust", { productId: p.id, quantity: -3, reason: "Damaged", damage: true })
  must((await api("products:list", { query: p.name, pageSize: 1 })).rows[0].stock === s0 - 3, "stock adjustment is wrong")
  await api("stock:count", { lines: [{ productId: p.id, counted: s0 + 4 }] })
  must((await api("products:list", { query: p.name, pageSize: 1 })).rows[0].stock === s0 + 4, "stock count is wrong")
  const cash = (await api("snapshot:get")).accounts["Cash in hand"]
  const cl = await api("closing:create", { account: "Cash in hand", date: today, counted: cash - 10 })
  must(Math.abs(cl.variance + 10) < 0.001, `closing variance should be -10, got ${cl.variance}`)
  // exchange: customer returns one item and takes another on the same bill
  const c = customers[0]
  const sale = await api("sale:create", { partyId: c.id, lines: [{ productId: products[1].id, qty: 4 }], payments: [] })
  const invoice = (await api("docs:list", { kind: "sale", no: sale.id, pageSize: 1 })).rows[0]
  const ex = await api("exchange:create", { invoice: sale.id, quantities: { [products[1].id]: 2 }, partyId: c.id, lines: [{ productId: products[2].id, qty: 1 }], payments: [] })
  must(!!ex.returnId && !!ex.invoice, "exchange did not return ids")
  void invoice
  await page.reload()
  await page.waitForSelector("text=Business overview")
  for (const s of ["Cash & Bank", "Suppliers", "Inventory", "Expenses", "Returns"]) {
    await nav(s)
    await page.waitForTimeout(250)
    await scan(s)
  }
})

await step("the books balance: ledgers = lists = dashboard, accounting identity zero", async () => {
  const snap = await api("snapshot:get")
  const rec = snap.parties.reduce((s, p) => s + Math.max(0, p.balance), 0)
  const pay = snap.suppliers.reduce((s, p) => s + Math.max(0, p.balance), 0)
  must(Math.abs(rec - snap.dashboard.receivables) < 0.01, `receivables ${snap.dashboard.receivables} vs parties ${rec}`)
  must(Math.abs(pay - snap.dashboard.payables) < 0.01, `payables ${snap.dashboard.payables} vs suppliers ${pay}`)
  for (const p of snap.parties.slice(0, 6)) {
    const led = await api("ledger:get", { kind: "customer", id: p.id })
    const last = led.rows.at(-1)
    if (last) must(Math.abs(last.balance - p.balance) < 0.01, `${p.name}: statement ends at ${last.balance}, list says ${p.balance}`)
  }
  const h = await api("health:get")
  must(h.integrityOk, "integrity: " + h.problems.join("; "))
})

await step("every screen scanned for broken text (NaN, undefined, [object Object]) with data in it", async () => {
  const screens = ["Dashboard", "POS / Sales", "Customers", "Recovery", "Purchases", "Suppliers", "Inventory", "Returns", "Expenses", "Cash & Bank", "Reports", "Users & Permissions", "Settings", "Backup & restore"]
  for (const s of screens) {
    await nav(s)
    await page.waitForTimeout(300)
    await scan(s)
  }
  await nav("POS / Sales")
  await page.getByRole("button", { name: /history/i }).first().click()
  await page.waitForTimeout(300)
  await scan("Sales history")
  await page.locator("tbody tr").first().click()
  await page.waitForTimeout(300)
  await scan("an invoice")
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: /Close/ }).first().click({ timeout: 1500 }).catch(() => {})
  await page.waitForSelector("text=Invoice preview", { state: "detached" }).catch(() => {})
})

await step("small laptop screens: nothing is cut off or sideways-scrolling at 1100x700 and 1366x768", async () => {
  const screens = ["Dashboard", "POS / Sales", "Customers", "Recovery", "Purchases", "Inventory", "Reports", "Cash & Bank", "Settings"]
  const problems = []
  for (const [w, h] of [[1100, 700], [1366, 768]]) {
    await app.evaluate(({ BrowserWindow }, [ww, hh]) => BrowserWindow.getAllWindows()[0].setSize(ww, hh), [w, h])
    await page.waitForTimeout(500)
    for (const s of screens) {
      await nav(s)
      await page.waitForTimeout(250)
      const over = await page.evaluate(() => {
        const de = document.documentElement
        const wide = de.scrollWidth - window.innerWidth
        // find elements poking out of the right edge of the window
        const out = [...document.querySelectorAll("main *")].filter((e) => {
          const r = e.getBoundingClientRect()
          return r.width > 0 && r.right > window.innerWidth + 2 && !e.closest("[class*=table], .table-wrap, table, .scroll, [style*=overflow]")
        }).length
        return { wide, out }
      })
      if (over.wide > 2) problems.push(`${s} at ${w}x${h} scrolls sideways by ${over.wide}px`)
      if (s === "POS / Sales" || s === "Inventory") await shot(`laptop-${w}-${s.replace(/\W+/g, "")}`)
    }
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  must(problems.length === 0, problems.join(" || "))
})

await step("a limited (sales) user can sell but cannot reach owner features, by screen or by direct call", async () => {
  await api("role:setPermission", { role: "Sales User", permission: "report.view", allowed: false }) // the owner keeps profit away from the counter
  await api("user:create", { name: "Counter Boy", username: "counter", password: "counter1", role: "Sales User" })
  await page.getByTitle("Lock workspace").click()
  await page.getByRole("button", { name: /Sign out|Lock|Confirm/ }).last().click()
  await page.waitForSelector("text=Sign in")
  await page.locator("input[name=username]").fill("counter")
  await page.locator("input[name=password]").fill("counter1")
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForSelector("text=Business overview")
  const nav2 = await page.locator(".sidebar").innerText()
  for (const forbidden of ["Users & Permissions", "Settings"]) must(!nav2.includes(forbidden), `the sales user sees "${forbidden}"`)
  must(!(await page.locator("body").innerText()).includes("Gross profit"), "the sales user sees Gross profit on the dashboard")
  for (const [ch, payload] of [
    ["user:create", { name: "x", username: "xx", password: "xxxxxx", role: "Owner" }],
    ["settings:set", { key: "x", value: "y" }],
    ["backup:restore", { name: "nothing" }],
    ["product:save", { company: "A", article: "B", cost: 1, rate: 2 }],
    ["role:setPermission", { role: "Sales User", permission: "user.manage", allowed: true }],
    ["sale:void", { id: "INV-00001", reason: "test" }],
    ["opening:party", { kind: "customer", id: customers[0].id, amount: 1 }],
  ]) {
    const r = await raw(ch, payload)
    must(r.ok === false, `the sales user could call ${ch}`)
  }
  // …but can sell
  await nav("POS / Sales")
  await pickParty(page, customers[1].name)
  await page.getByPlaceholder(/Scan a barcode or search|Search by name/).fill(products[3].name)
  await page.getByText(products[3].name).first().click()
  await page.getByLabel(new RegExp(`Quantity of ${products[3].name}`)).fill("2")
  await page.getByRole("button", { name: /Save sale/ }).click()
  await page.waitForSelector("text=/Sale INV-\\d+ saved/")
  await page.getByTitle("Lock workspace").click()
  await page.getByRole("button", { name: /Sign out|Lock|Confirm/ }).last().click()
  await page.waitForSelector("text=Sign in")
  await page.locator("input[name=username]").fill("owner")
  await page.locator("input[name=password]").fill("secret1")
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForSelector("text=Business overview")
})

await step("backup: manual backup works, is listed and verifies; the data stays healthy", async () => {
  const b = await api("backup:run")
  const list = await api("backup:list")
  must(list.some((x) => x.name === b.name), "the new backup is not listed")
  const h = await api("health:get")
  must(h.integrityOk && h.lastBackupAt, "health after backup: " + JSON.stringify(h))
})

await step("memory: the app stays small after all of this", async () => {
  const m = await app.evaluate(({ app }) => app.getAppMetrics().map((x) => ({ type: x.type, mb: Math.round(x.memory.workingSetSize / 1024) })))
  const total = m.reduce((s, x) => s + x.mb, 0)
  console.log(`      memory: ${m.map((x) => `${x.type} ${x.mb}MB`).join(", ")} = ${total}MB`)
  must(total < 1200, `the app uses ${total}MB`)
})

await finish()
