import { describe, expect, it } from "vitest"
import { accountingIdentity, bookChecks } from "../src/main/services/bookchecks"
import { buildDashboard } from "../src/main/services/dashboard"
import { listDocs } from "../src/main/services/lists"
import { ledgerView } from "../src/main/services/ledger"
import { postOpeningAccountBalance, postOpeningStock } from "../src/main/services/payments"
import { customerBalance, partyLedger, profitSummary, supplierBalance } from "../src/main/services/queries"
import { postSaleReturn } from "../src/main/services/returns"
import { postPurchase } from "../src/main/services/purchases"
import { postSale } from "../src/main/services/sales"
import { buildSnapshot } from "../src/main/services/snapshot"
import { setup } from "./helpers"
import { buildWorld, rng, step, type Tally } from "./support/fuzz"

async function randomBusiness(seed: number, ops: number) {
  const c = await setup()
  const r = rng(seed)
  const w = buildWorld(c.db, c.owner, r)
  for (const a of w.accounts) postOpeningAccountBalance(c.db, c.owner, { accountId: a, amount: 5_000_000 })
  for (const v of w.variants) postOpeningStock(c.db, c.owner, { variantId: v, qty: 20, unitCost: 100_033 })
  const tally: Tally = {}
  for (let i = 0; i < ops; i++) step(w, r, tally)
  return { c, w, tally }
}

describe("every screen tells the same story after a random business", () => {
  for (const seed of [11, 23, 314]) {
    it(`seed ${seed}: party balances, statements, bills, dashboard and aging agree`, async () => {
      const { c } = await randomBusiness(seed, 700)
      const { db } = c
      const snap = buildSnapshot(db)

      // 1. one balance per party, however it is read
      const customers = db.prepare("SELECT id FROM parties WHERE is_walk_in = 0").all() as { id: number }[]
      for (const { id } of customers) {
        const rows = partyLedger(db, "customer", id)
        const viaRows = rows.length ? rows[rows.length - 1]!.balance : 0
        const view = ledgerView(db, "customer", id)
        const viaView = view.rows.length ? Math.round(view.rows[view.rows.length - 1]!.balance * 100) : 0
        const viaView2 = customerBalance(db, id)
        const listed = snap.parties.find((p) => p.id === `PTY-${String(id).padStart(4, "0")}`)
        expect({ id, viaRows, viaView, listed: Math.round((listed?.balance ?? 0) * 100) }).toEqual({ id, viaRows: viaView2, viaView: viaView2, listed: viaView2 })
        // aging only splits the positive balance into age buckets: it must add up to what is owed
        const aged = Math.round(view.aging.reduce((s, x) => s + x, 0) * 100)
        expect({ id, aged }).toEqual({ id, aged: Math.max(0, viaView2) })
      }
      const suppliers = db.prepare("SELECT id FROM suppliers").all() as { id: number }[]
      for (const { id } of suppliers) {
        const rows = partyLedger(db, "supplier", id)
        const viaRows = rows.length ? rows[rows.length - 1]!.balance : 0
        expect({ id, viaRows }).toEqual({ id, viaRows: supplierBalance(db, id) })
      }

      // 2. dashboard receivables / payables are the sums of what parties owe / are owed
      const dash = buildDashboard(db, snap.today)
      const owed = customers.reduce((s, c0) => s + Math.max(0, customerBalance(db, c0.id)), 0)
      const payable = suppliers.reduce((s, c0) => s + Math.max(0, supplierBalance(db, c0.id)), 0)
      expect(Math.round(dash.receivables * 100)).toBe(owed)
      expect(Math.round(dash.payables * 100)).toBe(payable)

      // 3. every bill: balance after - before = what the bill itself added; totals add up from the lines
      for (const kind of ["sale", "purchase"] as const) {
        const docs = listDocs(db, { kind, pageSize: 500 }).rows
        expect(docs.length).toBeGreaterThan(5)
        for (const d of docs) {
          const lines = d.lines ?? []
          const gross = lines.reduce((s, l) => s + Math.round(l.qty * l.rate * 100), 0)
          const lineDisc = lines.reduce((s, l) => s + Math.round(l.discount * 100), 0)
          expect({ id: d.id, total: Math.round(d.total * 100) }).toEqual({ id: d.id, total: gross - lineDisc - Math.round((d.invoiceDiscount ?? 0) * 100) })
          if (d.balanceBefore !== undefined && !d.walkIn) {
            expect({ id: d.id, moved: Math.round((d.balanceAfter! - d.balanceBefore) * 100) }).toEqual({ id: d.id, moved: Math.round(d.total * 100) - Math.round(d.paid * 100) })
          }
        }
      }

      // 4. the books themselves
      const b = bookChecks(db)
      expect({ customers: b.customers, suppliers: b.suppliers, accounts: b.accounts, stock: b.stock, documents: b.documents }).toEqual({ customers: [], suppliers: [], accounts: [], stock: [], documents: [] })
      expect(accountingIdentity(db).difference).toBe(0)
    }, 180_000)
  }
})

describe("returns, discounts and cost: the pennies add up", () => {
  it("returning every line of a discounted invoice, in pieces, refunds exactly what was charged and restores stock and cost", async () => {
    const c = await setup()
    postOpeningStock(c.db, c.owner, { variantId: c.blue, qty: 50, unitCost: 100_033 })
    postOpeningStock(c.db, c.owner, { variantId: c.black, qty: 50, unitCost: 99_967 })
    const sale = postSale(c.db, c.owner, {
      partyId: c.party,
      lines: [{ variantId: c.blue, qty: 7, rate: 150_017, discount: 331 }, { variantId: c.black, qty: 3, rate: 149_999 }],
      extraDiscount: 1_003,
      payments: [{ accountId: c.cash, method: "Cash", amount: 500_001 }],
    })
    const row = db(c).prepare("SELECT total, subtotal, discount, paid FROM sales WHERE id = ?").get(sale.saleId) as { total: number; subtotal: number; discount: number; paid: number }
    expect(row.subtotal).toBe(7 * 150_017 + 3 * 149_999)
    expect(row.discount).toBe(331 + 1_003)
    expect(row.total).toBe(row.subtotal - row.discount)
    const before = customerBalance(c.db, c.party)
    expect(before).toBe(row.total - row.paid)
    const sl = c.db.prepare("SELECT id, qty FROM sale_lines WHERE sale_id = ? ORDER BY id").all(sale.saleId) as { id: number; qty: number }[]
    let refunded = 0
    for (const [qtys, line] of [[[2, 3, 2], sl[0]!], [[1, 2], sl[1]!]] as const) {
      for (const q of qtys) refunded += postSaleReturn(c.db, c.owner, { saleId: sale.saleId, lines: [{ saleLineId: line.id, qty: q }], settlement: "balance" }).total
    }
    expect(refunded).toBe(row.total) // nothing lost or invented by rounding
    expect(customerBalance(c.db, c.party)).toBe(before - row.total)
    // stock and its value are back exactly
    const lv = c.db.prepare("SELECT variant_id, qty, value FROM stock_levels WHERE variant_id IN (?,?) ORDER BY variant_id").all(c.blue, c.black) as { variant_id: number; qty: number; value: number }[]
    expect(lv.map((x) => [x.qty, x.value])).toEqual([[50, 50 * 100_033], [50, 50 * 99_967]])
    expect(bookChecks(c.db).stock).toEqual([])
    expect(accountingIdentity(c.db).difference).toBe(0)
  })

  it("weighted-average cost: sold cost + remaining value always equals what was bought, and profit = revenue - exact cost", async () => {
    const c = await setup()
    postPurchase(c.db, c.owner, { supplierId: c.supplier, lines: [{ variantId: c.blue, qty: 7, rate: 100_001 }], payments: [] })
    postPurchase(c.db, c.owner, { supplierId: c.supplier, lines: [{ variantId: c.blue, qty: 13, rate: 120_007 }], payments: [] })
    const bought = 7 * 100_001 + 13 * 120_007
    const s1 = postSale(c.db, c.owner, { partyId: c.party, lines: [{ variantId: c.blue, qty: 5, rate: 200_000 }], payments: [] })
    postPurchase(c.db, c.owner, { supplierId: c.supplier, lines: [{ variantId: c.blue, qty: 4, rate: 90_333 }], payments: [] })
    const s2 = postSale(c.db, c.owner, { partyId: c.party, lines: [{ variantId: c.blue, qty: 11, rate: 210_000, discount: 777 }], payments: [] })
    const cost = (id: number) => (c.db.prepare("SELECT SUM(cost_total) v FROM sale_lines WHERE sale_id = ?").get(id) as { v: number }).v
    const level = c.db.prepare("SELECT qty, value FROM stock_levels WHERE variant_id = ?").get(c.blue) as { qty: number; value: number }
    expect(level.qty).toBe(7 + 13 + 4 - 5 - 11)
    expect(cost(s1.saleId) + cost(s2.saleId) + level.value).toBe(bought + 4 * 90_333)
    const p = profitSummary(c.db, "2000-01-01T00:00:00Z", "2100-01-01T00:00:00Z")
    expect(p.cogs).toBe(cost(s1.saleId) + cost(s2.saleId))
    expect(p.netSales).toBe(5 * 200_000 + 11 * 210_000 - 777)
    expect(p.grossProfit).toBe(p.netSales - p.cogs)
    expect(p.netProfit).toBe(p.grossProfit) // no expenses or write-offs here
  })
})

const db = (c: Awaited<ReturnType<typeof setup>>) => c.db

import { runReport } from "../src/main/services/reports"
describe("reports add up to the invoices", () => {
  it("item reports reconcile with the invoice totals when a whole-invoice discount was given; dates split at local midnight", async () => {
    const c = await setup()
    postOpeningStock(c.db, c.owner, { variantId: c.blue, qty: 100, unitCost: 100_000 })
    postOpeningStock(c.db, c.owner, { variantId: c.black, qty: 100, unitCost: 100_000 })
    // 23:59:59 and 00:00:00 in Pakistan (UTC+5) are different business days
    const lateOnThe14th = "2026-10-14T18:59:59.000Z"
    const earlyOnThe15th = "2026-10-14T19:00:00.000Z"
    const a = postSale(c.db, c.owner, { partyId: c.party, ts: lateOnThe14th, lines: [{ variantId: c.blue, qty: 4, rate: 150_000 }, { variantId: c.black, qty: 3, rate: 140_000, discount: 1_000 }], extraDiscount: 5_001, payments: [] })
    const b = postSale(c.db, c.owner, { partyId: c.party, ts: earlyOnThe15th, lines: [{ variantId: c.blue, qty: 1, rate: 150_000 }], payments: [] })
    const total = (id: number) => (c.db.prepare("SELECT total FROM sales WHERE id = ?").get(id) as { total: number }).total
    const day = (d: string, name: string) => runReport(c.db, { name, from: d, to: d })
    const sum = (rep: ReturnType<typeof runReport>, label: string) => Math.round((rep.summary.find((s) => s.label === label)!.value as number) * 100)
    expect(sum(day("2026-10-14", "Daily Sales"), "Total sales")).toBe(total(a.saleId))
    expect(sum(day("2026-10-15", "Daily Sales"), "Total sales")).toBe(total(b.saleId))
    for (const name of ["Sales by Customer", "Sales by City", "Sales by User"]) expect(sum(day("2026-10-14", name), "Total sales")).toBe(total(a.saleId))
    const both = (name: string) => runReport(c.db, { name, from: "2026-10-14", to: "2026-10-15" })
    for (const name of ["Sales by Article", "Sales by Company"]) {
      const rep = both(name)
      expect(sum(rep, "Net amount (matches invoice totals)")).toBe(total(a.saleId) + total(b.saleId))
    }
    // purchases: same idea
    const p = postPurchase(c.db, c.owner, { supplierId: c.supplier, lines: [{ variantId: c.blue, qty: 10, rate: 90_000 }], extraDiscount: 2_500, payments: [] })
    const today = new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10)
    const pr = runReport(c.db, { name: "Article Purchase", from: today, to: today })
    expect(sum(pr, "Net amount (matches invoice totals)")).toBe((c.db.prepare("SELECT total FROM purchases WHERE id = ?").get(p.purchaseId) as { total: number }).total)
  })
})

describe("absurd amounts are refused, not wrapped or rounded", () => {
  it("a line that overflows safe integers, and NaN / Infinity / negative payments, are rejected before anything is written", async () => {
    const c = await setup()
    postOpeningStock(c.db, c.owner, { variantId: c.blue, qty: 1_000_000, unitCost: 100 })
    const count = () => (c.db.prepare("SELECT (SELECT COUNT(*) FROM sales) s, (SELECT COUNT(*) FROM ledger_entries) l, (SELECT COUNT(*) FROM account_entries) a").get() as Record<string, number>)
    const before = count()
    const bad = [
      { variantId: c.blue, qty: 1_000_000, rate: Number.MAX_SAFE_INTEGER },
      { variantId: c.blue, qty: 2 ** 53, rate: 10 },
      { variantId: c.blue, qty: 1, rate: -5 },
      { variantId: c.blue, qty: 1, rate: Number.NaN },
      { variantId: c.blue, qty: 1.5, rate: 100 },
    ]
    for (const line of bad) expect(() => postSale(c.db, c.owner, { partyId: c.party, lines: [line], payments: [] })).toThrow()
    expect(() => postSale(c.db, c.owner, { partyId: c.party, lines: [{ variantId: c.blue, qty: 1, rate: 1000 }], payments: [{ accountId: c.cash, method: "Cash", amount: -1 }] })).toThrow()
    expect(() => postSale(c.db, c.owner, { partyId: c.party, lines: [{ variantId: c.blue, qty: 1, rate: 1000 }], payments: [{ accountId: c.cash, method: "Cash", amount: 1000.5 }] })).toThrow()
    expect(count()).toEqual(before)
  })
})
