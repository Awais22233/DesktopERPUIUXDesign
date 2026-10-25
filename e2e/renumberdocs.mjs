import { launch } from "./lib.mjs"

const { page, step, nav, finish } = await launch("cosmetics", "Number House")
const call = (ch, req) => page.evaluate(([c, r]) => window.api.invoke(c, r), [ch, req])
const must = (c, m) => { if (!c) throw new Error(m) }
let cust, sup, acct

await step("setup", async () => {
  await page.waitForSelector("text=Create the owner account")
  await page.locator("input[name=name]").fill("Owner")
  await page.locator("input[name=username]").fill("owner")
  await page.locator("input[name=password]").fill("secret1")
  await page.locator("input[name=again]").fill("secret1")
  await page.getByRole("button", { name: "Create account" }).click()
  await page.waitForSelector("text=Business overview")
  acct = (await call("snapshot:get")).data.masters.accounts[0].name
  cust = (await call("party:save", { kind: "customer", name: "Num Customer", city: "Ghotki" })).data.id
  sup = (await call("party:save", { kind: "supplier", name: "Num Supplier", city: "Karachi" })).data.id
  must((await call("opening:party", { kind: "customer", id: cust, amount: 5000 })).ok, "opening c")
  must((await call("opening:party", { kind: "supplier", id: sup, amount: 5000 })).ok, "opening s")
  must((await call("receipt:create", { partyId: cust, account: acct, method: "Cash", amount: 100 })).ok, "receipt")
  must((await call("supplierPayment:create", { partyId: sup, account: acct, method: "Cash", amount: 200 })).ok, "slip")
  const cat = (await call("snapshot:get")).data.masters.expenseCategories[0]
  must((await call("expense:create", { category: cat, amount: 300, account: acct })).ok, "expense")
  await page.reload()
  await page.waitForSelector("text=Business overview")
})
await step("receipt number changes and the receipt stays open", async () => {
  await nav("Recovery")
  await page.locator("tbody tr").first().click()
  await page.getByRole("button", { name: "Change number" }).click()
  await page.getByLabel("New bill number").fill("R-501")
  await page.getByRole("button", { name: "Save number" }).click()
  await page.waitForSelector("text=Number changed to R-501")
  await page.waitForSelector(".invoice-no:has-text('R-501')")
})
await step("supplier pay slip number changes", async () => {
  await page.keyboard.press("Escape")
  await nav("Suppliers")
  await page.locator("text=Supplier payments").waitFor()
  await page.locator("tr", { hasText: "Num Supplier" }).last().click()
  await page.getByRole("button", { name: "Change number" }).click()
  await page.getByLabel("New bill number").fill("S-77")
  await page.getByRole("button", { name: "Save number" }).click()
  await page.waitForSelector("text=Number changed to S-77")
})
await step("expense number changes", async () => {
  await page.keyboard.press("Escape")
  await nav("Expenses")
  await page.getByRole("button", { name: "Change no." }).first().click()
  await page.locator("input[name=no]").fill("V-12")
  await page.getByRole("button", { name: "Save number" }).click()
  await page.waitForSelector("text=Expense number changed to V-12")
  await page.waitForSelector("text=V-12")
})
await finish()
