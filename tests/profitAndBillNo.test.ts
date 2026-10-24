import { beforeEach, describe, expect, it } from "vitest"
import { AppError } from "../src/core/errors"
import { postPurchase } from "../src/main/services/purchases"
import { postSale, renumberSale, suggestInvoiceNo } from "../src/main/services/sales"
import { runReport } from "../src/main/services/reports"
import { buildDashboard } from "../src/main/services/dashboard"
import { setFlag } from "../src/main/services/config"
import { PROFIT_REPORTS } from "../src/shared/profiles"
import { setup, type Ctx } from "./helpers"

const codeOf = (fn: () => unknown) => {
  try {
    fn()
  } catch (e) {
    return e instanceof AppError ? `${e.code}: ${e.message}` : `non-app:${(e as Error).message}`
  }
  return "no error"
}
const sale = (c: Ctx, extra: Record<string, unknown> = {}) =>
  postSale(c.db, c.owner, { partyId: c.party, lines: [{ variantId: c.blue, qty: 1, rate: 150_000 }], payments: [], ...extra })

let c: Ctx
beforeEach(async () => {
  c = await setup()
  postPurchase(c.db, c.owner, { supplierId: c.supplier, lines: [{ variantId: c.blue, qty: 50, rate: 100_000 }], payments: [] })
})
const day = new Date().toISOString().slice(0, 10)

describe("profit and cost are hidden (cloth default)", () => {
  it("refuses every profit report and strips cost from stock reports and the dashboard", () => {
    sale(c)
    for (const name of PROFIT_REPORTS) expect(codeOf(() => runReport(c.db, { name, from: day, to: day })), name).toContain("FORBIDDEN")
    const stock = runReport(c.db, { name: "Current Stock", from: day, to: day })
    expect(stock.columns.map((x) => x.key)).not.toContain("cost")
    expect(stock.columns.map((x) => x.key)).not.toContain("value")
    const d = buildDashboard(c.db, day)
    expect(d.grossProfit).toBe(0)
    expect(d.margin).toBeNull()
    expect(d.stockValue).toBe(0)
  })
  it("comes back when the owner switches it on", () => {
    sale(c)
    setFlag(c.db, null, "profit", true)
    expect(runReport(c.db, { name: "Profit & Loss", from: day, to: day }).rows.length).toBeGreaterThan(0)
    expect(runReport(c.db, { name: "Current Stock", from: day, to: day }).columns.map((x) => x.key)).toContain("cost")
  })
})

describe("rate typed on the bill", () => {
  it("a product with no price takes the typed rate; no rate at all is refused", () => {
    c.db.prepare("UPDATE variants SET sale_price = 0 WHERE id = ?").run(c.blue)
    const limited = { ...c.limited }
    expect(codeOf(() => postSale(c.db, limited, { partyId: c.party, lines: [{ variantId: c.blue, qty: 1 }], payments: [] }))).toContain("Enter the rate")
    const r = postSale(c.db, limited, { partyId: c.party, lines: [{ variantId: c.blue, qty: 2, rate: 123_400 }], payments: [] })
    expect(r.total).toBe(246_800) // salesman without override can type a rate when the product has none
  })
  it("a different customer rate on a priced product still needs the override permission", () => {
    expect(codeOf(() => postSale(c.db, c.limited, { partyId: c.party, lines: [{ variantId: c.blue, qty: 1, rate: 140_000 }], payments: [] }))).toContain("FORBIDDEN")
  })
})

describe("manual bill number", () => {
  it("uses the typed number, refuses a repeat (any letter case) and never collides with the automatic one", () => {
    expect(sale(c, { invoiceNo: "  1042 " }).invoiceNo).toBe("1042")
    expect(codeOf(() => sale(c, { invoiceNo: "1042" }))).toContain("already used")
    expect(sale(c, { invoiceNo: "a-7" }).invoiceNo).toBe("a-7")
    expect(codeOf(() => sale(c, { invoiceNo: "A-7" }))).toContain("already used")
    // type the number the program would have chosen next, then let it choose
    expect(sale(c, { invoiceNo: "INV-00001" }).invoiceNo).toBe("INV-00001")
    expect(sale(c).invoiceNo).toBe("INV-00002")
    expect(codeOf(() => sale(c, { invoiceNo: "x".repeat(31) }))).toContain("30 characters")
  })
  it("a refused bill number saves nothing", () => {
    sale(c, { invoiceNo: "5" })
    const before = (c.db.prepare("SELECT COUNT(*) n FROM sales").get() as { n: number }).n
    expect(codeOf(() => sale(c, { invoiceNo: "5" }))).toContain("already used")
    expect((c.db.prepare("SELECT COUNT(*) n FROM sales").get() as { n: number }).n).toBe(before)
  })
  it("suggests the last number plus one, keeping zero padding", () => {
    expect(suggestInvoiceNo(c.db)).toBe("INV-00001")
    sale(c, { invoiceNo: "0099" })
    expect(suggestInvoiceNo(c.db)).toBe("0100")
    sale(c, { invoiceNo: "A-17" })
    expect(suggestInvoiceNo(c.db)).toBe("A-18")
  })
  it("can be changed afterwards: audited, unique, and statements follow", () => {
    const s = sale(c, { invoiceNo: "10" })
    sale(c, { invoiceNo: "11" })
    expect(codeOf(() => renumberSale(c.db, c.owner, s.saleId, "11"))).toContain("already used")
    expect(codeOf(() => renumberSale(c.db, c.limited, s.saleId, "12"))).toContain("FORBIDDEN")
    expect(renumberSale(c.db, c.owner, s.saleId, "12")).toBe("12")
    expect((c.db.prepare("SELECT invoice_no FROM sales WHERE id = ?").get(s.saleId) as { invoice_no: string }).invoice_no).toBe("12")
    const desc = (c.db.prepare("SELECT description FROM ledger_entries WHERE source_type='sale' AND source_id=? AND kind='sale'").get(s.saleId) as { description: string }).description
    expect(desc).toBe("Sale 12")
    expect(c.db.prepare("SELECT 1 FROM audit_log WHERE action = 'sale.renumber'").get()).toBeTruthy()
  })
})
