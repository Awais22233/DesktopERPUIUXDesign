// A very busy day, done the way a shop owner does it: through the real screens.
// Sales on the POS, payments on the Recovery screen, stock on the Purchases screen, with a model of what every
// balance and every stock level must be at the end. Also times each action and tries the usual mistakes.
//   SALES=400 RECOVERIES=150 PURCHASES=80 SEED=1 xvfb-run -a node e2e/busyday.mjs
import { launch } from "./lib.mjs"

const SALES = Number(process.env.SALES || 60)
const RECOVERIES = Number(process.env.RECOVERIES || 20)
const PURCHASES = Number(process.env.PURCHASES || 12)
let seed = Number(process.env.SEED || 1)
const rand = () => {
  // mulberry32
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const int = (a, b) => a + Math.floor(rand() * (b - a + 1))
const pick = (arr) => arr[Math.floor(rand() * arr.length)]
const P = (rupees) => Math.round(rupees * 100) // paisa
const R = (paisa) => paisa / 100

const { page, step, shot, nav, finish } = await launch("cloth", "Busy Day House")
const api = (channel, payload) =>
  page.evaluate(async ([c, p]) => {
    const r = await window.api.invoke(c, p)
    if (!r.ok) throw new Error(r.error.message)
    return r.data
  }, [channel, payload])
const must = (c, m) => {
  if (!c) throw new Error(m)
}
const bugs = []
const bug = (m) => {
  bugs.push(m)
  console.log("BUG   " + m)
}
const timings = { sale: [], purchase: [], recovery: [] }
const stat = (name) => {
  const a = [...timings[name]].sort((x, y) => x - y)
  if (!a.length) return
  const q = (p) => a[Math.min(a.length - 1, Math.floor(p * a.length))]
  const first = timings[name].slice(0, 10)
  const last = timings[name].slice(-10)
  const avg = (x) => Math.round(x.reduce((s, v) => s + v, 0) / x.length)
  console.log(`      ${name}: n=${a.length} median=${q(0.5)}ms p95=${q(0.95)}ms max=${a.at(-1)}ms  first10 avg=${avg(first)}ms last10 avg=${avg(last)}ms`)
  if (avg(last) > avg(first) * 3 + 500) bug(`${name} gets slower during the day (${avg(first)}ms -> ${avg(last)}ms)`)
  if (a.at(-1) > 6000) bug(`${name} had a very slow action: ${a.at(-1)}ms`)
}

// ---------- model ----------
const customers = [] // {id, name, balance(paisa), limit}
const suppliers = []
const items = [] // {id, name, cost, rate, stock}
const cities = ["Ghotki", "Sukkur", "Karachi", "Lahore", "Multan", "Rohri"]
let cash = 0 // total money in cash+bank accounts, paisa
const day = { sales: 0, salesCount: 0, salesPaid: 0, recoveries: 0, recoveryCount: 0, purchases: 0, purchaseCount: 0, purchasePaid: 0, voided: 0 }

await step("set up the shop: owner account, 40 customers, 6 suppliers, 60 products", async () => {
  await page.waitForSelector("text=Create the owner account")
  await page.locator("input[name=name]").fill("Owner")
  await page.locator("input[name=username]").fill("owner")
  await page.locator("input[name=password]").fill("secret1")
  await page.locator("input[name=again]").fill("secret1")
  await page.getByRole("button", { name: "Create account" }).click()
  await page.waitForSelector("text=Business overview")
  const articles = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliet", "Kilo", "Lima"]
  const colours = ["Black", "Navy Blue", "White", "Grey", "Brown"]
  for (const [ai, art] of articles.entries()) {
    const cost = 800 + ai * 130
    const rate = Math.round(cost * 1.3)
    for (const c of colours) {
      const stock = 400
      await api("product:save", { company: `Mill ${ai % 4}`, article: art, color: c, size: "40 meter", cost, rate, openingQty: stock })
      items.push({ name: `${art} ${c}`, cost: P(cost), rate: P(rate), stock })
    }
  }
  for (let i = 1; i <= 40; i++) {
    const opening = i % 2 ? 0 : int(1, 80) * 1000
    const limit = i <= 3 ? 50000 : 5000000
    const r = await api("party:save", { kind: "customer", name: `Customer ${String(i).padStart(2, "0")}`, city: pick(cities), phone: `0300${String(1000000 + i)}`, limit, openingBalance: opening })
    customers.push({ id: r.id, name: `Customer ${String(i).padStart(2, "0")}`, balance: P(opening), limit: P(limit) })
  }
  for (let i = 1; i <= 6; i++) {
    const opening = i % 2 ? 0 : int(1, 50) * 1000
    const r = await api("party:save", { kind: "supplier", name: `Supplier ${i}`, city: pick(cities), openingBalance: opening })
    suppliers.push({ id: r.id, name: `Supplier ${i}`, balance: P(opening) })
  }
  await page.reload()
  await page.waitForSelector("text=Business overview")
})

// ---------- UI helpers ----------
const toastRe = /(Sale|Purchase) (INV|PUR)-\d+ saved|credit limit|limit/i
async function addLines(lines, purchase) {
  for (const l of lines) {
    await page.getByPlaceholder(/Scan a barcode or search|Search by name/).fill(l.item.name)
    await page.getByText(l.item.name).first().click()
    await page.getByLabel(`Quantity of ${l.item.name}`).fill(String(l.qty))
    if (l.rate !== undefined) await page.getByLabel(`Rate for ${l.item.name}`).fill(String(R(l.rate)))
    if (l.discount) await page.getByLabel(`Discount for ${l.item.name}`).fill(String(R(l.discount)))
  }
  void purchase
}
const money = (s) => Math.round(Number(String(s).replace(/Rs\.?/g, "").replace(/[^0-9.\-]/g, "")) * 100)
const lineTotal = (l) => l.qty * (l.rate ?? l.item.rate) - (l.discount ?? 0)

async function doSale(n) {
  const cust = pick(customers)
  const lines = []
  const used = new Set()
  const count = rand() < 0.5 ? 1 : rand() < 0.6 ? int(2, 3) : int(4, 6)
  while (lines.length < count) {
    const item = pick(items)
    if (used.has(item.name)) continue
    used.add(item.name)
    const l = { item, qty: int(1, 12) }
    if (rand() < 0.12) l.rate = item.rate + P(pick([0.5, 5, 25.25, 100]))
    if (rand() < 0.1) l.discount = P(pick([10, 50, 100.5]))
    if (lineTotal(l) <= 0) continue
    lines.push(l)
  }
  const sub = lines.reduce((s, l) => s + lineTotal(l), 0)
  const invDisc = rand() < 0.2 ? Math.min(sub - 1, P(pick([100, 250, 500.75, 1000]))) : 0
  const total = sub - invDisc
  const kind = rand()
  const method = kind < 0.4 ? "Cash" : kind < 0.7 ? "Credit" : "Partial"
  const paid = method === "Cash" ? total : method === "Credit" ? 0 : Math.max(1, Math.min(total - 1, Math.round(total * (0.2 + rand() * 0.6) / 100) * 100))
  const before = (await api("docs:list", { kind: "sale", pageSize: 1 })).summary.count

  await nav("POS / Sales")
  const t0 = performance.now()
  await page.locator("select", { hasText: "Select party" }).selectOption({ label: cust.name })
  await addLines(lines, false)
  if (invDisc) await page.locator("#invoice-discount").fill(String(R(invDisc)))
  await page.locator(".payment-options button", { hasText: new RegExp("^" + method + "$") }).click()
  if (method === "Partial") await page.getByLabel("Amount paid").fill(String(R(paid)))
  const shown = money(await page.locator(".grand-total strong").innerText())
  if (shown !== total) {
    const cart = await page.locator("table tbody tr").allInnerTexts()
    const vals = await page.locator("table tbody input").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") + "=" + e.value))
    bug(`sale ${n}: screen shows Grand total ${R(shown)} but the lines add to ${R(total)} :: model ${lines.map((l) => `${l.item.name} x${l.qty} @${R(l.rate ?? l.item.rate)} -${R(l.discount ?? 0)}`).join("; ")} :: screen ${cart.map((c) => c.replace(/\s+/g, " ")).join(" / ")} :: ${vals.join(", ")}`)
  }
  await page.getByRole("button", { name: /Save sale/ }).click()
  await page.waitForSelector(`text=/${toastRe.source}/i`, { timeout: 15000 }).catch(() => {})
  const ms = Math.round(performance.now() - t0)
  const after = (await api("docs:list", { kind: "sale", pageSize: 1 })).summary.count
  if (after !== before + 1) {
    const msg = (await page.locator("body").innerText()).split("\n").filter((x) => /exceed|limit|error|could not|stock/i.test(x)).slice(0, 3).join(" | ")
    bug(`sale ${n} for ${cust.name} (${R(total)}, ${method}) was not saved. Screen said: ${msg}`)
    await shot(`sale-${n}-not-saved`)
    await page.reload()
    await page.waitForSelector("text=Business overview")
    return false
  }
  timings.sale.push(ms)
  const over = cust.balance + (total - paid) > cust.limit
  cust.balance += total - paid
  for (const l of lines) l.item.stock -= l.qty
  cash += paid
  Object.assign(day, { sales: day.sales + total, salesCount: day.salesCount + 1, salesPaid: day.salesPaid + paid })
  void over
  return true
}

async function doPurchase(n) {
  const sup = pick(suppliers)
  const lines = []
  const used = new Set()
  const count = int(1, 4)
  while (lines.length < count) {
    const item = pick(items)
    if (used.has(item.name)) continue
    used.add(item.name)
    lines.push({ item, qty: int(5, 60), rate: rand() < 0.2 ? item.cost + P(pick([10, 25.5])) : undefined })
  }
  const lt = (l) => l.qty * (l.rate ?? l.item.cost)
  const total = lines.reduce((s, l) => s + lt(l), 0)
  const kind = rand()
  const method = kind < 0.4 ? "Cash" : kind < 0.7 ? "Credit" : "Partial"
  const paid = method === "Cash" ? total : method === "Credit" ? 0 : Math.max(1, Math.min(total - 1, Math.round(total * (0.2 + rand() * 0.6) / 100) * 100))
  const before = (await api("docs:list", { kind: "purchase", pageSize: 1 })).summary.count
  await nav("Purchases")
  await page.getByRole("button", { name: /New purchase/ }).first().click()
  await page.waitForSelector("text=Purchase details")
  const t0 = performance.now()
  await page.locator("select", { hasText: "Select supplier" }).selectOption({ label: sup.name })
  for (const l of lines) {
    await page.getByPlaceholder(/Scan a barcode or search|Search by name/).fill(l.item.name)
    await page.getByText(l.item.name).first().click()
    await page.getByLabel(`Quantity of ${l.item.name}`).fill(String(l.qty))
    if (l.rate !== undefined) await page.getByLabel(`Rate for ${l.item.name}`).fill(String(R(l.rate)))
  }
  await page.locator(".payment-options button", { hasText: new RegExp("^" + method + "$") }).click()
  if (method === "Partial") await page.getByLabel("Amount paid").fill(String(R(paid)))
  const shown = money(await page.locator(".grand-total strong").innerText())
  if (shown !== total) {
    const cart = await page.locator(".pos-cart tbody tr, table tbody tr").allInnerTexts()
    bug(`purchase ${n}: screen shows Grand total ${R(shown)} but the lines add to ${R(total)} :: model ${lines.map((l) => `${l.item.name} x${l.qty} @${R(l.rate ?? l.item.cost)}`).join("; ")} :: screen ${cart.map((c) => c.replace(/\s+/g, " ")).join(" / ")}`)
  }
  await page.getByRole("button", { name: /Save purchase/ }).click()
  await page.waitForSelector(`text=/Purchase PUR-\\d+ saved/`, { timeout: 15000 }).catch(() => {})
  const ms = Math.round(performance.now() - t0)
  const after = (await api("docs:list", { kind: "purchase", pageSize: 1 })).summary.count
  if (after !== before + 1) {
    bug(`purchase ${n} from ${sup.name} (${R(total)}, ${method}) was not saved`)
    await shot(`purchase-${n}-not-saved`)
    await page.reload()
    await page.waitForSelector("text=Business overview")
    return false
  }
  timings.purchase.push(ms)
  sup.balance += total - paid
  for (const l of lines) {
    l.item.stock += l.qty
    l.item.cost = l.rate ?? l.item.cost // the next purchase starts from the latest supplier price
  }
  cash -= paid
  Object.assign(day, { purchases: day.purchases + total, purchaseCount: day.purchaseCount + 1, purchasePaid: day.purchasePaid + paid })
  return true
}

async function doRecovery(n) {
  const owing = customers.filter((c) => c.balance >= 100)
  if (!owing.length) return true
  const cust = pick(owing)
  const whole = rand() < 0.25
  const amount = whole ? cust.balance : Math.max(100, Math.min(cust.balance, Math.floor((cust.balance * (0.1 + rand() * 0.9)) / 100) * 100))
  const before = (await api("snapshot:get")).collections.length
  await nav("Recovery")
  await page.getByRole("button", { name: /Receive payment/ }).first().click()
  const t0 = performance.now()
  await page.locator("select[name=partyId]").selectOption({ label: cust.name })
  await page.locator("input[name=amount]").fill(String(R(amount)))
  const options = await page.locator("select[name=method] option").count()
  if (options > 1 && rand() < 0.4) await page.locator("select[name=method]").selectOption({ index: int(1, options - 1) })
  await page.getByRole("button", { name: /Save & view receipt/ }).click()
  await page.waitForSelector("text=/Payment RCT-\\d+ received/", { timeout: 15000 }).catch(() => {})
  const ms = Math.round(performance.now() - t0)
  const after = (await api("snapshot:get")).collections.length
  if (after !== before + 1) {
    const msg = (await page.locator("body").innerText()).split("\n").filter((x) => /exceed|error|could not|more than/i.test(x)).slice(0, 3).join(" | ")
    bug(`recovery ${n} of ${R(amount)} from ${cust.name} (owes ${R(cust.balance)}) was not saved. Screen said: ${msg}`)
    await shot(`recovery-${n}-not-saved`)
    await page.reload()
    await page.waitForSelector("text=Business overview")
    return false
  }
  timings.recovery.push(ms)
  // the receipt must show what the customer owed before and after
  const text = await page.locator(".modal, [role=dialog]").first().innerText().catch(() => "")
  if (text && !text.includes((R(amount)).toLocaleString("en-US"))) bug(`recovery ${n}: receipt does not show the amount ${R(amount)}`)
  await page.getByRole("button", { name: /Close/ }).first().click().catch(() => page.keyboard.press("Escape"))
  await page.waitForSelector("text=Payment receipt", { state: "detached" }).catch(() => {})
  cust.balance -= amount
  cash += amount
  Object.assign(day, { recoveries: day.recoveries + amount, recoveryCount: day.recoveryCount + 1 })
  return true
}

// ---------- the day ----------
await step("shop owner's mistakes are refused politely (no party, empty bill, too much stock, bad payment)", async () => {
  await nav("POS / Sales")
  const save = page.getByRole("button", { name: /Save sale/ })
  // a button that is switched off is also a polite refusal; otherwise the screen must say why
  const refused = async (pattern) => {
    if (await save.isDisabled()) return
    await save.click()
    await page.waitForSelector(`text=${pattern}`)
  }
  await refused("/Select a party/i")
  await page.locator("select", { hasText: "Select party" }).selectOption({ label: customers[0].name })
  await refused("/at least one product/i")
  const it = items[0]
  await page.getByPlaceholder(/Scan a barcode or search|Search by name/).fill(it.name)
  await page.getByText(it.name).first().click()
  await page.getByLabel(`Quantity of ${it.name}`).fill(String(it.stock + 1))
  await refused("/exceeds available stock/i")
  await page.getByLabel(`Quantity of ${it.name}`).fill("2")
  await page.locator(".payment-options button", { hasText: /^Partial$/ }).click()
  await page.getByLabel("Amount paid").fill("0")
  await refused("/partial payment greater than zero/i")
  await page.getByLabel("Amount paid").fill("99999999")
  await refused("/partial payment greater than zero|less than the total/i")
  await page.getByLabel(`Quantity of ${it.name}`).fill("1.5")
  await page.locator(".payment-options button", { hasText: /^Cash$/ }).click()
  await refused("/whole numbers/i")
  await page.getByLabel(`Quantity of ${it.name}`).fill("-3")
  await refused("/whole numbers|Check quantities/i")
  if ((await api("docs:list", { kind: "sale", pageSize: 1 })).summary.count !== 0) throw new Error("a refused sale was saved")
  await page.evaluate(() => sessionStorage.clear()) // a half-made bill now survives F5 on purpose; this test wants a clean screen
  await page.reload()
  await page.waitForSelector("text=Business overview")
})

const plan = []
for (let i = 0; i < SALES; i++) plan.push("S")
for (let i = 0; i < RECOVERIES; i++) plan.push("R")
for (let i = 0; i < PURCHASES; i++) plan.push("P")
// shuffle, but start with a few sales so that someone owes money before the first recovery
for (let i = plan.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1))
  ;[plan[i], plan[j]] = [plan[j], plan[i]]
}
for (let k = 0; k < 5; k++) {
  const at = plan.findIndex((x, i) => i >= 5 && x === "S")
  if (at > 0 && plan[k] !== "S") [plan[k], plan[at]] = [plan[at], plan[k]]
}

await step(`the day: ${SALES} sales, ${RECOVERIES} recoveries, ${PURCHASES} purchases, entered on the real screens`, async () => {
  let n = { S: 0, R: 0, P: 0 }
  let k = 0
  const t0 = performance.now()
  for (const kind of plan) {
    n[kind]++
    try {
      if (kind === "S") await doSale(n.S)
      else if (kind === "R") await doRecovery(n.R)
      else await doPurchase(n.P)
    } catch (e) {
      bug(`${kind}${n[kind]} threw: ${e.message.split("\n").slice(0, 4).join(" | ")}`)
      await shot(`error-${kind}${n[kind]}`).catch(() => {})
      await page.reload().catch(() => {})
      await page.waitForSelector("text=Business overview").catch(() => {})
    }
    if (++k % 40 === 0) {
      console.log(`      ${k}/${plan.length} done (${Math.round((performance.now() - t0) / 1000)}s)`)
      await page.reload() // a real day has the app closed and reopened
      await page.waitForSelector("text=Business overview")
    }
  }
  console.log(`      the whole day took ${Math.round((performance.now() - t0) / 1000)}s`)
  stat("sale")
  stat("recovery")
  stat("purchase")
})

await step("a sale is cancelled by mistake-correction and the books follow", async () => {
  const docs = await api("docs:list", { kind: "sale", pageSize: 5 })
  const d = docs.rows.find((r) => r.status !== "void" && r.paid > 0 && r.paid < r.total) ?? docs.rows[0]
  const cust = customers.find((c) => c.name === d.party)
  await api("sale:void", { id: d.id, reason: "Entered twice" })
  const full = (await api("docs:list", { kind: "sale", no: d.id, pageSize: 1 })).rows[0]
  must(full.status === "void", "the sale was not marked cancelled")
  const total = P(d.total)
  const paid = P(d.paid)
  cust.balance -= total - paid
  cash -= paid
  day.sales -= total
  day.salesCount -= 1
  day.salesPaid -= paid
  day.voided++
  for (const l of full.lines ?? []) {
    const item = items.find((i) => i.name === l.name || l.name.startsWith(i.name))
    if (item) item.stock += l.qty
  }
})

// ---------- reconcile ----------
await step("every customer's and supplier's balance matches the model", async () => {
  const snap = await api("snapshot:get")
  let wrong = 0
  for (const c of customers) {
    const p = snap.parties.find((x) => x.name === c.name)
    if (!p || Math.abs(P(p.balance) - c.balance) > 0) {
      wrong++
      bug(`customer ${c.name}: app says ${p?.balance}, model says ${R(c.balance)}`)
    }
  }
  for (const s of suppliers) {
    const p = snap.suppliers.find((x) => x.name === s.name)
    if (!p || Math.abs(P(p.balance) - s.balance) > 0) {
      wrong++
      bug(`supplier ${s.name}: app says ${p?.balance}, model says ${R(s.balance)}`)
    }
  }
  must(wrong === 0, `${wrong} party balances are wrong`)
})
await step("every product's stock matches the model", async () => {
  const all = (await api("products:list", { pageSize: 500 })).rows
  let wrong = 0
  for (const i of items) {
    const p = all.find((x) => x.name === i.name)
    if (!p || p.stock !== i.stock) {
      wrong++
      bug(`stock of ${i.name}: app says ${p?.stock}, model says ${i.stock}`)
    }
  }
  must(wrong === 0, `${wrong} stock levels are wrong`)
})
await step("dashboard, receivables, payables and cash agree with the day's totals", async () => {
  const snap = await api("snapshot:get")
  const d = snap.dashboard
  const check = (label, got, want) => {
    if (Math.abs(P(got) - want) > 0) bug(`${label}: app says ${got}, model says ${R(want)}`)
  }
  check("today's sales", d.todaySales, day.sales)
  if (d.todaySalesCount !== day.salesCount) bug(`today's sales count: app ${d.todaySalesCount}, model ${day.salesCount}`)
  check("today's recovery", d.todayRecovery, day.recoveries)
  if (d.todayRecoveryCount !== day.recoveryCount) bug(`today's recovery count: app ${d.todayRecoveryCount}, model ${day.recoveryCount}`)
  check("today's purchases", d.todayPurchases, day.purchases)
  if (d.todayPurchaseCount !== day.purchaseCount) bug(`today's purchase count: app ${d.todayPurchaseCount}, model ${day.purchaseCount}`)
  check("receivables", d.receivables, customers.reduce((s, c) => s + Math.max(0, c.balance), 0))
  check("payables", d.payables, suppliers.reduce((s, c) => s + Math.max(0, c.balance), 0))
  const money = Object.values(snap.accounts).reduce((s, v) => s + P(v), 0)
  if (money !== cash) bug(`cash + bank together: app says ${R(money)}, model says ${R(cash)}`)
  const stockValue = (await api("products:list", { pageSize: 1 })).summary.value
  if (!(stockValue > 0)) bug("stock value is not positive")
  console.log(`      day: sales ${R(day.sales)} (${day.salesCount}), recovery ${R(day.recoveries)} (${day.recoveryCount}), purchases ${R(day.purchases)} (${day.purchaseCount}), cash+bank ${R(cash)}`)
})
await step("reports for the day add up to the same totals", async () => {
  const today = (await api("snapshot:get")).today
  const rep = await api("report:run", { name: "Daily Sales", from: today, to: today })
  const total = rep.rows.reduce((s, r) => s + (typeof r.total === "number" ? r.total : typeof r.amount === "number" ? r.amount : 0), 0)
  console.log(`      Daily Sales report: ${rep.rows.length} rows, summary ${rep.summary.map((x) => x.label + "=" + x.value).join("; ")}`)
  void total
  if (Math.abs(Number(rep.summary.find((x) => x.label === "Total sales")?.value) * 100 - day.sales) > 0) bug(`Daily Sales report total ${rep.summary.find((x) => x.label === "Total sales")?.value} differs from the day's sales ${R(day.sales)}`)
  const prof = await api("report:run", { name: "Profit & Loss", from: today, to: today })
  console.log(`      P&L: ${prof.summary.map((x) => x.label + "=" + x.value).join("; ")}`)
})
await step("the screens still open quickly after the busy day", async () => {
  const screens = ["Dashboard", "POS / Sales", "Customers", "Recovery", "Purchases", "Suppliers", "Inventory", "Reports", "Cash & Bank"]
  for (const s of screens) {
    const t0 = performance.now()
    await nav(s)
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(100)
    const ms = Math.round(performance.now() - t0)
    console.log(`      ${s}: ${ms}ms`)
    if (ms > 4000) bug(`${s} took ${ms}ms to open after the busy day`)
  }
  await nav("POS / Sales")
  await page.getByRole("button", { name: /history/i }).first().click()
  await page.waitForSelector("text=/Sales history|Invoice/i")
  await shot("busyday-sales-history")
  const t = performance.now()
  await page.reload()
  await page.waitForSelector("text=Business overview")
  const reload = Math.round(performance.now() - t)
  console.log(`      reopen app: ${reload}ms`)
  if (reload > 6000) bug(`app took ${reload}ms to reopen`)
  await nav("Dashboard")
  await shot("busyday-dashboard")
})
await step("the last bill opens from history with correct previous / this bill / remaining", async () => {
  await nav("POS / Sales")
  await page.getByRole("button", { name: /history/i }).first().click()
  await page.locator("tbody tr").first().click()
  await page.waitForSelector("text=Remaining balance")
  const text = await page.locator(".invoice-paper").first().innerText()
  for (const w of ["Previous balance", "This bill", "Total payable", "Remaining balance"]) if (!text.includes(w)) bug(`bill is missing "${w}"`)
  await shot("busyday-bill")
})
await step("the day's backup runs and the data file is healthy", async () => {
  await api("backup:run")
  const h = await api("health:get")
  must(h.integrityOk, "database integrity check failed: " + h.problems.join("; "))
})

console.log(`\n${bugs.length} bug(s) found by the busy-day run`)
for (const b of bugs) console.log(" - " + b)
await finish()
