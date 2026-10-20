// Daily use by a real person, including the clumsy things real people do: double clicks, odd numbers, odd names,
// leaving a half-made bill, pressing F5, and doing returns / cancellations / limits / closing on the real screens.
import { launch } from "./lib.mjs"
import { readFileSync } from "node:fs"

const { page, app, step, shot, nav, finish } = await launch("cloth", "Daily Use House")
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
const wait = (ms) => page.waitForTimeout(ms)
const notes = []
const note = (m) => {
  notes.push(m)
  console.log("NOTE  " + m)
}
const counts = async () => {
  const s = await api("snapshot:get")
  return {
    sales: (await api("docs:list", { kind: "sale", pageSize: 1 })).summary.count,
    purchases: (await api("docs:list", { kind: "purchase", pageSize: 1 })).summary.count,
    parties: s.parties.length,
    suppliers: s.suppliers.length,
    products: (await api("products:list", { pageSize: 1 })).total,
    receipts: s.collections.length,
    expenses: s.expenses.length,
    returns: s.returns.length,
    snap: s,
  }
}
const stockOf = async (name) => (await api("products:list", { query: name, pageSize: 5 })).rows.find((r) => r.name === name)?.stock
const balanceOf = async (name) => (await api("snapshot:get")).parties.find((p) => p.name === name)?.balance
const pos = async () => {
  await nav("POS / Sales")
  await page.waitForSelector("text=Select products")
}
const pickProduct = async (name) => {
  await page.getByPlaceholder(/Scan a barcode or search|Search by name/).fill(name)
  await page.getByText(name).first().click()
}
const save = () => page.getByRole("button", { name: /Save sale/ })

const P = ["Alpha Black", "Alpha White", "Bravo Black", "Bravo White", "Charlie Black", "Delta Black"]
const C = ["Ali Traders", "Bilal Cloth House", "Chaudhry Sons"]

await step("set up: owner, 3 customers, 1 supplier, 6 products with 50 thans each", async () => {
  await page.waitForSelector("text=Create the owner account")
  await page.locator("input[name=name]").fill("Owner")
  await page.locator("input[name=username]").fill("owner")
  await page.locator("input[name=password]").fill("secret1")
  await page.locator("input[name=again]").fill("secret1")
  await page.getByRole("button", { name: "Create account" }).click()
  await page.waitForSelector("text=Business overview")
  await api("account:add", { name: "Meezan Bank", type: "bank", opening: 0 })
  for (const c of C) await api("party:save", { kind: "customer", name: c, city: "Ghotki", limit: 100000, openingBalance: 10000 })
  await api("party:save", { kind: "supplier", name: "ABC Mills", city: "Faisalabad" })
  for (const p of P) {
    const [art, col] = p.split(" ")
    await api("product:save", { company: "Faraz Co", article: art, color: col, size: "40 meter", cost: 1000, rate: 1500, openingQty: 50, minStock: 5 })
  }
  await page.reload()
  await page.waitForSelector("text=Business overview")
})

// ---------------------------------------------------------------- double clicks and key repeats
await step("double-clicking Save sale (and pressing F8 twice) makes ONE bill, not two", async () => {
  await pos()
  const before = (await counts()).sales
  await page.locator("select", { hasText: "Select party" }).selectOption({ label: C[0] })
  await pickProduct("Alpha Black")
  await page.getByLabel(/Quantity of Alpha Black/).fill("2")
  await page.getByRole("button", { name: "Credit", exact: true }).first().click()
  await save().dblclick()
  await wait(1500)
  let c = await counts()
  if (c.sales !== before + 1) throw new Error(`double click made ${c.sales - before} bills`)
  must((await stockOf("Alpha Black")) === 48, `stock after one sale of 2: ${await stockOf("Alpha Black")}`)
  await pickProduct("Alpha Black")
  await page.getByLabel(/Quantity of Alpha Black/).fill("1")
  await page.keyboard.press("F8")
  await page.keyboard.press("F8")
  await wait(1500)
  c = await counts()
  if (c.sales !== before + 2) throw new Error(`F8 twice made ${c.sales - before - 1} bills`)
  must((await stockOf("Alpha Black")) === 47, "stock after F8 twice is wrong")
})
await step("double-clicking Save on a purchase, a recovery, a new customer, a new product and an expense makes one each", async () => {
  const b = await counts()
  // purchase
  await nav("Purchases")
  await page.getByRole("button", { name: /New purchase/ }).first().click()
  await page.waitForSelector("text=Purchase details")
  await page.locator("select", { hasText: "Select supplier" }).selectOption({ label: "ABC Mills" })
  await pickProduct("Alpha White")
  await page.getByLabel(/Quantity of Alpha White/).fill("5")
  await page.getByRole("button", { name: /Save purchase/ }).dblclick()
  await wait(1200)
  // recovery
  await nav("Recovery")
  await page.getByRole("button", { name: /Receive payment/ }).first().click()
  await page.locator("select[name=partyId]").selectOption({ label: C[1] })
  await page.locator("input[name=amount]").fill("1000")
  await page.getByRole("button", { name: /Save & view receipt/ }).dblclick()
  await wait(1200)
  await page.getByRole("button", { name: /Close/ }).first().click().catch(() => page.keyboard.press("Escape"))
  // customer
  await nav("Customers")
  await page.getByRole("button", { name: /Add party/ }).first().click()
  await page.locator("input[name=name]").fill("Double Click Traders")
  await page.locator("input[name=city]").fill("Sukkur")
  await page.getByRole("button", { name: "Add party" }).last().dblclick()
  await wait(1200)
  // product
  await nav("Inventory")
  await page.getByRole("button", { name: "Add product" }).first().click()
  await page.locator("input[name=company]").fill("Faraz Co")
  await page.locator("input[name=article]").fill("Echo")
  await page.locator("input[name=color]").fill("Red")
  await page.locator("input[name=size]").fill("40 meter")
  await page.locator("input[name=cost]").fill("900")
  await page.locator("input[name=rate]").fill("1300")
  await page.getByRole("button", { name: "Add product" }).last().dblclick()
  await wait(1200)
  // expense
  await nav("Expenses")
  await page.getByRole("button", { name: /Add expense|New expense/ }).first().click()
  await page.locator("input[name=amount]").fill("777")
  await page.getByRole("button", { name: "Save", exact: true }).dblclick()
  await wait(1200)
  const a = await counts()
  const diff = { purchases: a.purchases - b.purchases, receipts: a.receipts - b.receipts, parties: a.parties - b.parties, products: a.products - b.products, expenses: a.expenses - b.expenses }
  for (const [k, v] of Object.entries(diff)) if (v !== 1) throw new Error(`double click on ${k} made ${v}`)
})

// ---------------------------------------------------------------- strange numbers on the sales screen
await step("odd quantities, rates, discounts and payments are refused with a clear message and nothing is saved", async () => {
  await pos()
  const b = await counts()
  await page.locator("select", { hasText: "Select party" }).selectOption({ label: C[0] })
  await pickProduct("Bravo Black")
  const q = page.getByLabel(/Quantity of Bravo Black/)
  const rate = page.getByLabel(/Rate for Bravo Black/)
  const disc = page.getByLabel(/Discount for Bravo Black/)
  const tryBad = async (label, setup, pattern) => {
    await setup()
    if (await save().isDisabled()) return
    await save().click()
    const ok = await page.waitForSelector(`text=${pattern}`, { timeout: 2500 }).then(() => true, () => false)
    if (!ok) throw new Error(`${label}: no clear message (screen: ${(await page.locator(".form-error, .error, [role=alert]").allInnerTexts()).join("|").slice(0, 120)})`)
  }
  await tryBad("quantity 0", () => q.fill("0"), "/whole numbers|Check quantities/i")
  await tryBad("quantity -2", () => q.fill("-2"), "/whole numbers|Check quantities/i")
  await tryBad("quantity 2.5", () => q.fill("2.5"), "/whole numbers|Check quantities/i")
  await tryBad("quantity 51", () => q.fill("51"), "/exceeds available stock/i")
  await tryBad("quantity 1e12", () => q.fill("1e12"), "/exceeds available stock|Check quantities/i")
  await q.fill("2")
  await tryBad("negative rate", () => rate.fill("-5"), "/Check quantities, rates/i")
  await rate.fill("1500")
  await tryBad("discount more than the line", () => disc.fill("999999"), "/Check quantities, rates|discount/i")
  await disc.fill("0")
  await tryBad("rate with 3 decimals", () => rate.fill("1500.005"), "/2 decimal/i")
  await rate.fill("1500")
  await page.locator("#invoice-discount").fill("999999")
  await tryBad("invoice discount over subtotal", async () => {}, "/discount must be between/i")
  await page.locator("#invoice-discount").fill("0")
  await page.getByRole("button", { name: "Partial", exact: true }).first().click()
  await page.getByLabel("Amount paid").fill("3000")
  await tryBad("partial equal to total", async () => {}, "/partial payment greater than zero/i")
  await page.getByLabel("Amount paid").fill("-1")
  await tryBad("negative partial", async () => {}, "/partial payment greater than zero/i")
  const a = await counts()
  must(a.sales === b.sales, `an invalid bill was saved (${a.sales - b.sales})`)
  must((await stockOf("Bravo Black")) === 50, "stock changed by a refused bill")
  // the same bill, now valid, still goes through
  await page.getByLabel("Amount paid").fill("1000")
  await save().click()
  await page.waitForSelector("text=/Sale INV-\\d+ saved/")
})

// ---------------------------------------------------------------- odd names
await step("odd customer names (Urdu, emoji, quotes, <script>, SQL, spaces, very long) are stored and shown exactly, and nothing runs", async () => {
  await nav("Customers")
  const names = ["علی ٹریڈرز", "😀 Happy Shop", `Zaid "Bhai", Sons`, "O'Brien'; DROP TABLE parties;--", "<img src=x onerror=\"window.__xss=1\"> Hax", "  Spaced Out   Name  ", "X".repeat(150)]
  for (const n of names) {
    await page.getByRole("button", { name: /Add party/ }).first().click()
    await page.locator("input[name=name]").fill(n)
    await page.locator("input[name=city]").fill("Ghotki")
    await page.getByRole("button", { name: "Add party" }).last().click()
    await wait(500)
    const err = await page.locator(".form-error").allInnerTexts().catch(() => [])
    if (err.length) {
      await page.getByRole("button", { name: /Cancel|Close/ }).first().click().catch(() => page.keyboard.press("Escape"))
      note(`name "${n.slice(0, 30)}" was refused: ${err[0]}`)
    }
  }
  const s = await api("snapshot:get")
  const stored = s.parties.map((p) => p.name)
  for (const n of names) {
    const want = n.trim().replace(/\s+/g, " ")
    if (!stored.some((x) => x === want || x === n.trim() || x === n)) note(`name not stored as typed: "${n.slice(0, 40)}" (stored list has ${stored.filter((x) => x.includes(n.trim().slice(0, 4))).join(" | ").slice(0, 80)})`)
  }
  must((await page.evaluate(() => window.__xss)) === undefined, "a script in a customer name RAN")
  must((await api("health:get")).integrityOk, "database damaged by a SQL-looking name")
  // sell to the hostile one and look at the bill
  await pos()
  const hostile = stored.find((x) => x.includes("<img"))
  await page.locator("select", { hasText: "Select party" }).selectOption({ label: hostile })
  await pickProduct("Charlie Black")
  await page.getByLabel(/Quantity of Charlie Black/).fill("1")
  await page.getByRole("button", { name: "Cash", exact: true }).first().click().catch(() => {})
  await save().click()
  await page.waitForSelector("text=/Sale INV-\\d+ saved/")
  must((await page.evaluate(() => window.__xss)) === undefined, "a script in a customer name ran on the bill")
  // a very long name must not break the layout of the customers list
  await nav("Customers")
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  if (wide > 2) note(`a very long customer name makes the Customers screen scroll sideways by ${wide}px`)
})
await step("two customers with the same name: what happens", async () => {
  await nav("Customers")
  await page.getByRole("button", { name: /Add party/ }).first().click()
  await page.locator("input[name=name]").fill(C[0])
  await page.locator("input[name=city]").fill("Ghotki")
  await page.getByRole("button", { name: "Add party" }).last().click()
  await wait(700)
  const n = (await api("snapshot:get")).parties.filter((p) => p.name.toLowerCase() === C[0].toLowerCase()).length
  const err = (await page.locator(".form-error").allInnerTexts().catch(() => [])).join("|")
  if (n > 1) note(`a second customer named "${C[0]}" was accepted (the party list will show two identical names)`)
  else note(`duplicate customer name refused: ${err || "silently"}`)
  await page.getByRole("button", { name: /Cancel|Close/ }).first().click().catch(() => page.keyboard.press("Escape"))
})

// ---------------------------------------------------------------- half-made bills
await step("a half-made bill: what survives switching screens and pressing F5", async () => {
  await pos()
  await page.locator("select", { hasText: "Select party" }).selectOption({ label: C[1] })
  await pickProduct("Delta Black")
  await page.getByLabel(/Quantity of Delta Black/).fill("3")
  await nav("Customers")
  await nav("POS / Sales")
  const keptAfterNav = await page.getByLabel(/Quantity of Delta Black/).count()
  if (!keptAfterNav) note("a half-made bill is LOST when you open another screen and come back")
  else note("a half-made bill is kept when you switch screens")
  await page.reload()
  await page.waitForSelector("text=Business overview")
  await pos()
  const keptAfterReload = await page.getByLabel(/Quantity of Delta Black/).count()
  note(keptAfterReload ? "a half-made bill is kept after F5" : "a half-made bill is LOST after F5 / accidental reload")
})

// ---------------------------------------------------------------- two people, one last thran
await step("two sales for the last unit at the same instant: one wins, stock never goes below zero", async () => {
  const it = (await api("products:list", { query: "Delta Black", pageSize: 5 })).rows.find((r) => r.name === "Delta Black")
  const have = it.stock
  const parties = (await api("snapshot:get")).parties
  const results = await page.evaluate(async ([id, qty, partyId]) => {
    const one = () => window.api.invoke("sale:create", { partyId, lines: [{ productId: id, qty }], payments: [] })
    return Promise.all([one(), one(), one()])
  }, [it.id, have, parties[0].id])
  const ok = results.filter((r) => r.ok).length
  must(ok === 1, `${ok} of 3 simultaneous sales of the whole stock succeeded`)
  must((await stockOf("Delta Black")) === 0, "stock should be 0")
  // and a sold-out product cannot be added on the sales screen
  await pos()
  await page.getByPlaceholder(/Scan a barcode or search|Search by name/).fill("Delta Black")
  await wait(500)
  const opt = page.locator(".product-option, .product-card, button", { hasText: "Delta Black" }).first()
  must((await opt.count()) === 0 || (await opt.isDisabled().catch(() => true)), "a sold-out product can be put on a bill")
})

// ---------------------------------------------------------------- export
await step("Export CSV from Customers opens in Excel correctly (BOM, Urdu, quotes, no formulas, readable headings)", async () => {
  await api("party:save", { kind: "customer", name: "=HYPERLINK(\"http://x\")", city: "Lahore" }).catch(() => null)
  await nav("Customers")
  // Electron shows a native Save dialog for downloads, so capture the file the page builds instead
  await page.evaluate(() => {
    const orig = URL.createObjectURL.bind(URL)
    URL.createObjectURL = (b) => ((window.__blob = b), orig(b))
    window.__blob = null
  })
  await page.getByRole("button", { name: /^Export/ }).first().click()
  await wait(800)
  const bytes = await page.evaluate(async () => (window.__blob ? Array.from(new Uint8Array(await window.__blob.arrayBuffer())) : null))
  must(bytes, "Export built no file")
  const buf = Buffer.from(bytes)
  must(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf, "CSV has no UTF-8 BOM, Urdu will look broken in Excel")
  const text = buf.toString("utf8")
  must(text.includes("\r\n"), "CSV lines are not CRLF")
  must(!/^"?[=+@]/m.test(text.split("\r\n").slice(1).join("\r\n").replace(/"[^"]*"/g, (m) => m)) || !text.includes('"=HYPERLINK'), "a cell starting with = was exported as a formula")
  must(text.includes("علی ٹریڈرز"), "Urdu name missing from export")
  must(text.includes('Zaid ""Bhai"", Sons'), "quoted name not escaped")
  const head = text.split("\r\n")[0]
  must(!/minStock|[a-z][A-Z]/.test(head), `raw key names in the heading: ${head.slice(0, 120)}`)
})

await finish()
