import { launch, pickParty } from "./lib.mjs"

const { page, step, shot, nav, finish } = await launch("cosmetics", "Estimate House")
const call = (ch, req) => page.evaluate(([c, r]) => window.api.invoke(c, r), [ch, req])
const must = (c, m) => { if (!c) throw new Error(m) }
let cust, prod

await step("setup: staff added in Settings, a party with usual salesman and recovery", async () => {
  await page.waitForSelector("text=Create the owner account")
  await page.locator("input[name=name]").fill("Owner")
  await page.locator("input[name=username]").fill("owner")
  await page.locator("input[name=password]").fill("secret1")
  await page.locator("input[name=again]").fill("secret1")
  await page.getByRole("button", { name: "Create account" }).click()
  await page.waitForSelector("text=Business overview")
  await nav("Settings")
  await page.getByRole("button", { name: "Salesmen & recovery" }).click()
  await page.getByLabel("Staff name").fill("Imran Arain")
  await page.getByLabel("Staff phone").fill("0300-1112223")
  await page.getByRole("button", { name: "Add" }).click()
  await page.waitForSelector("text=Imran Arain")
  await page.getByLabel("Staff name").fill("Bilal Ahmed")
  await page.getByLabel("Staff phone").fill("0311-9998887")
  await page.getByLabel("Staff role").selectOption("recovery")
  await page.getByRole("button", { name: "Add" }).click()
  await page.waitForSelector("text=Bilal Ahmed")
  const staff = (await call("snapshot:get")).data.masters.staff
  must(staff.length === 2, "two people expected")
  const sm = staff.find((s) => s.name === "Imran Arain").id
  const rc = staff.find((s) => s.name === "Bilal Ahmed").id
  cust = (await call("party:save", { kind: "customer", name: "Shahdani Medical Store", city: "Pepel Chok", phone: "0333-4445556", address: "Main Road, Pepel Chok", salesman: sm, recovery: rc })).data.id
  must((await call("product:save", { company: "Glow", article: "Cream", color: "", cost: 100, rate: 150, openingQty: 50 })).ok, "product")
  prod = (await call("products:list", { query: "Cream", pageSize: 3 })).data.rows[0].id
  await page.reload()
  await page.waitForSelector("text=Business overview")
})
await step("the sale screen fills in the party's salesman and recovery person", async () => {
  await nav("POS / Sales")
  await pickParty(page, "Shahdani Medical Store")
  const booked = await page.getByLabel("Booked by").evaluate((e) => e.selectedOptions[0].text)
  const rec = await page.getByLabel("Recovery person").evaluate((e) => e.selectedOptions[0].text)
  must(booked === "Imran Arain" && rec === "Bilal Ahmed", `prefill: ${booked} / ${rec}`)
  // a recovery-only person is not offered as salesman
  const opts = await page.getByLabel("Booked by").locator("option").allTextContents()
  must(!opts.includes("Bilal Ahmed"), "recovery person offered as salesman")
})
await step("the bill shows the customer's address and phone and both people, in the Estimate design", async () => {
  const st = (await call("snapshot:get")).data.masters.staff
  const sale = await call("sale:create", { partyId: cust, lines: [{ productId: prod, qty: 3, rate: 150 }], payments: [], bookedBy: st.find((x) => x.name === "Imran Arain").id, recoveryBy: st.find((x) => x.name === "Bilal Ahmed").id })
  must(sale.ok, JSON.stringify(sale))
  await nav("POS / Sales")
  await page.getByRole("button", { name: /history/i }).first().click()
  await page.waitForSelector("tbody tr")
  await page.locator("tbody tr").first().click()
  await page.waitForSelector(".invoice-paper")
  await page.getByLabel("Bill design").selectOption({ label: "Estimate" })
  must((await page.locator(".invoice-paper").getAttribute("class")).includes("inv-estimate"), "estimate class")
  const t = await page.locator(".invoice-paper").textContent()
  for (const need of ["Prepared by:", "Shahdani Medical Store", "Main Road, Pepel Chok", "0333-4445556", "Booked by", "Imran Arain", "0300-1112223", "Recovery by", "Bilal Ahmed", "0311-9998887", "Total # of items"]) must(t.includes(need), "bill is missing: " + need + "\n" + t.slice(0, 600))
  await shot("estimate-bill")
  for (const d of ["Modern", "Classic", "Minimal", "Compact ledger", "Elegant"]) {
    await page.getByLabel("Bill design").selectOption({ label: d })
    must(!(await page.locator(".invoice-count").isVisible()), "item count shown in " + d)
  }
})
await finish()
