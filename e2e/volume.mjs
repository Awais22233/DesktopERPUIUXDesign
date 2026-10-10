// A big catalogue through the real screens: every list must open and search quickly.
import { launch } from "./lib.mjs"
const N = Number(process.env.VOLUME_ITEMS || 10000)
const { page, step, nav, finish } = await launch("cloth", "Volume Test House")
const api = (channel, payload) =>
  page.evaluate(async ([c, p]) => {
    const r = await window.api.invoke(c, p)
    if (!r.ok) throw new Error(r.error.message)
    return r.data
  }, [channel, payload])
const ms = async (fn) => {
  const t = performance.now()
  await fn()
  return Math.round(performance.now() - t)
}
const must = (c, m) => { if (!c) throw new Error(m) }

await step(`set up: ${N} items, 300 customers`, async () => {
  await page.waitForSelector("text=Create the owner account")
  await page.locator("input[name=name]").fill("Owner")
  await page.locator("input[name=username]").fill("owner")
  await page.locator("input[name=password]").fill("secret1")
  await page.locator("input[name=again]").fill("secret1")
  await page.getByRole("button", { name: "Create account" }).click()
  await page.waitForSelector("text=Business overview")
  const t = await ms(async () => {
    await page.evaluate(async (n) => {
      for (let i = 1; i <= n; i++) {
        const r = await window.api.invoke("product:save", { company: `Company ${i % 40}`, article: `Article ${Math.ceil(i / 10)}`, color: `Shade ${i % 10}`, size: `${20 + (i % 40)} meter`, cost: 1000 + (i % 500), rate: 1300 + (i % 500), openingQty: 5 + (i % 30), barcode: `89${String(i).padStart(8, "0")}` })
        if (!r.ok) throw new Error(r.error.message)
      }
      for (let i = 1; i <= 300; i++) await window.api.invoke("party:save", { kind: "customer", name: `Customer ${i}`, city: "Ghotki" })
    }, N)
  })
  console.log(`      seeding took ${t} ms`)
})
await step("reload: the app opens with the big catalogue (snapshot stays small)", async () => {
  const t = await ms(async () => {
    await page.reload()
    await page.waitForSelector("text=Business overview")
  })
  console.log(`      open after reload: ${t} ms`)
  must(t < 5000, `opening took ${t} ms`)
})
await step("Inventory opens and pages instantly; search finds an item and a barcode", async () => {
  const open = await ms(async () => {
    await nav("Inventory")
    await page.getByText(/of [\d,]+ records/).waitFor()
  })
  const total = await page.getByText(/of [\d,]+ records/).innerText()
  console.log(`      inventory open: ${open} ms (${total.trim()})`)
  must(total.includes(N.toLocaleString()), `expected ${N} records, saw "${total}"`)
  must(open < 3000, `inventory took ${open} ms`)
  const expected = (await api("products:list", { query: "Article 777 Shade 3", pageSize: 3 })).total
  must(expected > 0 && expected < 50, `search returned ${expected} items`)
  const s1 = await ms(async () => {
    await page.getByPlaceholder(/Search product/).fill("Article 777 Shade 3")
    await page.getByText(new RegExp(`of ${expected} records`)).waitFor()
  })
  console.log(`      text search: ${s1} ms`)
  await page.getByPlaceholder(/Search product/).fill("8900000500")
  await page.locator("td", { hasText: "Article 50 " }).first().waitFor()
  await page.getByPlaceholder(/Search product/).fill("")
  const next = await ms(async () => {
    await page.getByRole("button", { name: "Next page" }).click()
    await page.getByText(/Showing 26–50/).waitFor()
  })
  console.log(`      next page: ${next} ms`)
})
await step("POS: scan a barcode and the item is in the cart; typing narrows the picker", async () => {
  await nav("POS / Sales")
  const t = await ms(async () => {
    const box = page.getByPlaceholder(/barcode|name/i).first()
    await box.fill("8900000123")
    await box.press("Enter")
    await page.getByLabel(/Quantity of Article 13/).waitFor()
  })
  console.log(`      scan to cart: ${t} ms`)
  must(t < 2000, "barcode scan too slow")
  await page.getByPlaceholder(/barcode|name/i).first().fill("Article 9000")
  await page.getByText(/Showing the first|Article 9000/).first().waitFor()
})
await step("a sale and a purchase on the big catalogue are saved and show up in history", async () => {
  const ids = (await api("products:list", { query: "Article 4000", pageSize: 3 })).rows.map((r) => r.id)
  const party = (await api("snapshot:get")).parties[0].id
  const sup = await api("party:save", { kind: "supplier", name: "Big Supplier" })
  await api("purchase:create", { supplierId: sup.id, lines: ids.map((id) => ({ productId: id, qty: 4, rate: 1000 })), payments: [] })
  const sale = await api("sale:create", { partyId: party, lines: ids.map((id) => ({ productId: id, qty: 2 })), payments: [] })
  await nav("POS / Sales")
  await page.getByRole("button", { name: /Sales history/ }).click()
  await page.locator("td", { hasText: sale.id }).first().waitFor()
})
await step("dashboard shows real totals for the large catalogue", async () => {
  await nav("Dashboard")
  const txt = await page.locator("body").innerText()
  must(/products are at or below|Business overview/.test(txt), "dashboard missing")
  const d = (await api("snapshot:get")).dashboard
  must(d.inventory.items === N, `dashboard counts ${d.inventory.items} items, expected ${N}`)
})
const snapSize = await api("snapshot:get").then((s) => JSON.stringify(s).length)
console.log(`      snapshot size with ${N} items: ${(snapSize / 1e6).toFixed(2)} MB`)
await finish()
