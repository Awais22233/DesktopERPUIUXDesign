import { launch } from "./lib.mjs"

const { page, step, shot, nav, finish } = await launch("cosmetics", "Fund House")
const call = (ch, req) => page.evaluate(([c, r]) => window.api.invoke(c, r), [ch, req])
const must = (c, m) => { if (!c) throw new Error(m) }

await step("setup with a bank account", async () => {
  await page.waitForSelector("text=Create the owner account")
  await page.locator("input[name=name]").fill("Owner")
  await page.locator("input[name=username]").fill("owner")
  await page.locator("input[name=password]").fill("secret1")
  await page.locator("input[name=again]").fill("secret1")
  await page.getByRole("button", { name: "Create account" }).click()
  await page.waitForSelector("text=Business overview")
  must((await call("account:add", { name: "Meezan Bank", type: "bank" })).ok, "bank account")
  await page.reload()
  await page.waitForSelector("text=Business overview")
})
await step("Add fund: owner capital into the bank shows in the balance and the book", async () => {
  await nav("Cash & Bank")
  await page.getByRole("button", { name: "Add fund" }).click()
  await page.locator("select[name=kind]").selectOption("capital")
  await page.locator("input[name=amount]").fill("250000")
  await page.locator("select[name=account]").selectOption({ label: "Meezan Bank" })
  await page.locator("input[name=from]").fill("Owner")
  await page.locator("input[name=reference]").fill("TRX-9981")
  await shot("add-fund")
  await page.getByRole("button", { name: /Save|Add fund|Record/ }).last().click()
  await page.waitForSelector("text=/Money added \\(FND-0001\\)/")
  const t = await page.locator("body").innerText()
  must(/250,000/.test(t), "balance not shown")
  must(/Money in/.test(t) && /FND-0001/.test(t), "book row missing: " + t.slice(0, 300))
})
await step("Other income counts in profit, capital and loan do not", async () => {
  const snap = (await call("snapshot:get")).data
  must(snap.accounts["Meezan Bank"] === 250000, "bank balance " + snap.accounts["Meezan Bank"])
  must((await call("fund:create", { kind: "income", amount: 1000, account: "Meezan Bank", notes: "scrap" })).ok, "income")
  must((await call("fund:create", { kind: "loan", amount: 5000, account: "Meezan Bank" })).ok, "loan")
  const today = new Date().toISOString().slice(0, 10)
  const pl = (await call("report:run", { name: "Profit & Loss", from: today, to: today })).data
  const row = pl.rows.find((r) => r.name === "Net profit")
  must(row && row.amount === 1000, "net profit should be 1000, got " + JSON.stringify(row))
})
await finish()
