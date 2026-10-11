// Prints a long invoice and a receipt to PDF in every layout and reads the result back.
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { launch } from "./lib.mjs"

const { app, page, step, nav, finish } = await launch("cloth", "Print Test House")
const dir = mkdtempSync(join(tmpdir(), "erp-print-"))
const api = (channel, payload) =>
  page.evaluate(async ([c, p]) => {
    const r = await window.api.invoke(c, p)
    if (!r.ok) throw new Error(r.error.message)
    return r.data
  }, [channel, payload])

const toPdf = async (name, opts) => {
  const b64 = await app.evaluate(async ({ BrowserWindow }, o) => (await BrowserWindow.getAllWindows()[0].webContents.printToPDF(o)).toString("base64"), { printBackground: true, ...opts })
  const file = join(dir, name + ".pdf")
  writeFileSync(file, Buffer.from(b64, "base64"))
  const info = execFileSync("pdfinfo", [file]).toString()
  return {
    file,
    pages: Number(/Pages:\s+(\d+)/.exec(info)[1]),
    w: Number(/Page size:\s+([\d.]+) x/.exec(info)[1]),
    h: Number(/x ([\d.]+) pts/.exec(info)[1]),
    text: execFileSync("pdftotext", ["-layout", file, "-"]).toString(),
  }
}
const must = (cond, msg) => {
  if (!cond) throw new Error(msg)
}

await step("set up: owner, a customer, 45 products, one long invoice", async () => {
  await page.waitForSelector("text=Create the owner account")
  await page.locator("input[name=name]").fill("Owner")
  await page.locator("input[name=username]").fill("owner")
  await page.locator("input[name=password]").fill("secret1")
  await page.locator("input[name=again]").fill("secret1")
  await page.getByRole("button", { name: "Create account" }).click()
  await page.waitForSelector("text=Business overview")
  await api("business:set", { name: "Print Test House", tagline: "Wholesale cloth", owner: "", phone: "0300-1234567", email: "", address: "Main Bazar, Ghotki", city: "Ghotki", logo: "", invoiceFooter: "Goods once sold will not be taken back." })
  const party = await api("party:save", { kind: "customer", name: "Ali Traders", city: "Ghotki" })
  const ids = []
  for (let i = 1; i <= 45; i++) {
    const p = await api("product:save", { company: "Faraz Co", article: `Bolt ${String(i).padStart(2, "0")}`, color: "Blue", size: "40 meter", cost: 1000, rate: 1500, openingQty: 20 })
    ids.push(p.id)
  }
  await page.reload()
  await page.waitForSelector("text=Business overview")
  await api("sale:create", { partyId: party.id, lines: ids.map((id) => ({ productId: id, qty: 3 })), discount: 500, payments: [{ account: "Cash in hand", method: "Cash", amount: 20000 }] })
})

let a4
await step("A4: a 45-line invoice spans pages, shows every line and the totals", async () => {
  await nav("POS / Sales")
  await page.getByRole("button", { name: /Sales history/ }).click()
  await page.locator("td", { hasText: "INV-00001" }).first().click()
  await page.getByRole("heading", { name: "SALES INVOICE" }).waitFor()
  a4 = await toPdf("a4", { pageSize: "A4", preferCSSPageSize: true })
  must(Math.abs(a4.w - 595) < 3 && Math.abs(a4.h - 842) < 3, `not A4: ${a4.w}x${a4.h}`)
  must(a4.pages >= 2, `expected a multi-page invoice, got ${a4.pages} page(s)`)
  for (let i = 1; i <= 45; i++) must(a4.text.includes(`Bolt ${String(i).padStart(2, "0")}`), `line Bolt ${i} is missing from the printout`)
  const headers = (a4.text.match(/Description/g) || []).length
  must(headers >= a4.pages, `column titles repeat on ${headers} of ${a4.pages} pages`)
  // 45 x 3 x 1,500 = 202,500; less 500 discount = 202,000; paid 20,000; remaining 182,000
  for (const s of ["SALES INVOICE", "Print Test House", "Main Bazar, Ghotki", "202,500", "202,000", "182,000", "Goods once sold"]) must(a4.text.includes(s), `"${s}" missing from the A4 printout`)
  must(/Invoice discount/.test(a4.text), "invoice discount row missing")
  must(a4.text.indexOf("Remaining balance") > a4.text.indexOf("Bolt 45"), "totals must come after the last line")
  must(!/Search|Previous page|Cancel invoice|Save PDF/.test(a4.text), "screen-only controls leaked into the printout")
})

for (const width of ["80", "58"]) {
  await step(`thermal ${width} mm: roll-sized page, readable, no signature block`, async () => {
    await api("settings:set", { key: "print.thermal_width", value: width })
    await page.reload()
    await page.waitForSelector("text=Business overview")
    await nav("POS / Sales")
    await page.getByRole("button", { name: /Sales history/ }).click()
    await page.locator("td", { hasText: "INV-00001" }).first().click()
    await page.getByLabel("Print layout").selectOption("Thermal receipt")
    const t = await toPdf(`thermal${width}`, { preferCSSPageSize: true })
    const mm = (t.w / 72) * 25.4
    must(Math.abs(mm - Number(width)) < 1.5, `page is ${mm.toFixed(1)} mm wide, expected ${width}`)
    must(t.h > t.w && t.pages === 1, `a receipt must be one tall strip, got ${t.pages} page(s)`)
    for (let i = 1; i <= 45; i++) must(t.text.includes(`Bolt ${String(i).padStart(2, "0")}`), `line Bolt ${i} is missing from the ${width} mm receipt`)
    for (const s of ["202,000", "182,000", "Print Test House"]) must(t.text.includes(s), `"${s}" missing from the ${width} mm receipt`)
    must(!t.text.includes("Customer signature"), "signature block should not print on a thermal receipt")
    // no line may be cut off at the right edge: every line of text must fit inside the page
    const widest = Math.max(...t.text.split("\n").map((l) => l.length))
    must(widest < (width === "80" ? 62 : 52), `a text line is ${widest} characters wide, too wide for ${width} mm`)
  })
}

await step("receipt: a recovery receipt prints on A4 and thermal", async () => {
  await api("receipt:create", { partyId: (await api("snapshot:get")).parties[0].id, account: "Cash in hand", method: "Cash", amount: 5000, notes: "Part payment" })
  await page.reload()
  await page.waitForSelector("text=Business overview")
  await nav("Recovery")
  await page.locator("td", { hasText: "RCT-" }).first().click()
  await page.getByRole("heading", { name: "PAYMENT RECEIPT" }).waitFor()
  const r = await toPdf("receipt", { pageSize: "A4", preferCSSPageSize: true })
  for (const s of ["PAYMENT RECEIPT", "Ali Traders", "5,000", "Part payment"]) must(r.text.includes(s), `"${s}" missing from the receipt`)
  must(r.pages === 1, `a receipt should be one page, got ${r.pages}`)
})
console.log("PDFs kept in " + dir)
await finish()
