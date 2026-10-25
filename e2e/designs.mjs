import { launch } from "./lib.mjs"

const { page, step, shot, nav, finish } = await launch("cloth", "Design House", { profitHidden: true })
const call = (ch, req) => page.evaluate(([c, r]) => window.api.invoke(c, r), [ch, req])
const must = (c, m) => { if (!c) throw new Error(m) }
let sale
const openHistory = async () => { await nav("POS / Sales"); await page.getByRole("button", { name: /history/i }).first().click(); await page.waitForSelector("tbody tr") }

await page.evaluate(() => { localStorage.removeItem("erp.theme"); document.documentElement.dataset.theme = "light" })
await step("setup with a sale that has a meter breakdown", async () => {
  await page.waitForSelector("text=Create the owner account")
  await page.locator("input[name=name]").fill("Owner")
  await page.locator("input[name=username]").fill("owner")
  await page.locator("input[name=password]").fill("secret1")
  await page.locator("input[name=again]").fill("secret1")
  await page.getByRole("button", { name: "Create account" }).click()
  await page.waitForSelector("text=Business overview")
  await call("party:save", { kind: "customer", name: "Ali Traders", city: "Ghotki" })
  const sup = (await call("party:save", { kind: "supplier", name: "ABC Textile", city: "Karachi" })).data.id
  await call("product:save", { company: "Gul", article: "Lawn", color: "Blue", cost: 0, rate: 0, minStock: 0, length: 28, lengths: [{ length: 28, qty: 40 }] })
  const prod = (await call("products:list", { query: "Lawn", pageSize: 3 })).data.rows[0].id
  const cust = (await call("snapshot:get")).data.parties[0].id
  const r = await call("sale:create", { partyId: cust, lines: [{ productId: prod, qty: 5, rate: 300 }], payments: [] })
  must(r.ok, JSON.stringify(r))
  sale = r.data.id
  await page.reload()
  await page.waitForSelector("text=Business overview")
})
await step("every design renders and is selectable on a bill", async () => {
  await openHistory()
  await page.locator("tbody tr").first().click()
  await page.waitForSelector(".invoice-paper")
  for (const d of ["Modern", "Classic", "Minimal", "Compact ledger", "Elegant"]) {
    await page.getByLabel("Bill design").selectOption({ label: d })
    must((await page.locator(".invoice-paper").getAttribute("class")).includes("inv-" + { Modern: "modern", Classic: "classic", Minimal: "minimal", "Compact ledger": "ledger", Elegant: "elegant" }[d]), d)
    await shot("bill-" + d.replace(/\W/g, ""))
  }
  await page.keyboard.press("Escape")
})
await step("Settings: design gallery, number switch, dark mode", async () => {
  await nav("Settings")
  await page.getByRole("button", { name: "Printing" }).click()
  await page.locator(".design-option").nth(1).click()
  await shot("settings-printing")
  await page.getByRole("button", { name: /Save/ }).first().click()
  await page.getByRole("button", { name: "Business setup" }).click()
  await page.getByRole("button", { name: "Dark" }).click()
  must((await page.evaluate(() => document.documentElement.dataset.theme)) === "dark", "dark not applied")
  await shot("dark-settings")
  for (const s of ["Dashboard", "POS / Sales", "Inventory", "Reports", "Recovery"]) { await nav(s); await shot("dark-" + s.replace(/\W/g, "")) }
  await openHistory()
  await page.locator("tbody tr").first().click()
  await page.waitForSelector(".invoice-paper")
  await shot("dark-bill")
  await page.keyboard.press("Escape")
  await nav("Settings")
  await page.getByRole("button", { name: "Business setup" }).click()
  await page.getByRole("button", { name: "Light" }).click()
})
await step("number change switched off hides the controls and the server refuses", async () => {
  await nav("Settings")
  await page.getByRole("button", { name: "Invoice numbering" }).click()
  await page.getByLabel("Allow changing document numbers").uncheck()
  await page.waitForSelector("text=Document numbers are now automatic only")
  await page.reload()
  await page.waitForSelector("text=Business overview")
  await nav("POS / Sales")
  must((await page.getByLabel("Bill number").count()) === 0, "bill box still shown")
  await openHistory()
  await page.locator("tbody tr").first().click()
  await page.waitForSelector(".invoice-paper")
  must((await page.getByRole("button", { name: "Change bill number" }).count()) === 0, "button still shown")
  const r = await call("sale:renumber", { id: sale, invoiceNo: "X-1" })
  must(!r.ok, "server accepted a number change")
  const rc = (await call("snapshot:get")).data.expenses
  void rc
})
await finish()
