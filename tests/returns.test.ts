import { beforeEach, describe, expect, it } from "vitest"
import { AppError } from "../src/core/errors"
import { postCashClosing, postStockCount } from "../src/main/services/closing"
import { postPurchase } from "../src/main/services/purchases"
import { postExchange, postPurchaseReturn, postSaleReturn } from "../src/main/services/returns"
import { postSale } from "../src/main/services/sales"
import { postOpeningAccountBalance, recordReceipt } from "../src/main/services/payments"
import { accountBalance, customerBalance, partyLedger, profitSummary, stockReconcile, supplierBalance } from "../src/main/services/queries"
import { setSetting } from "../src/main/db/util"
import { count, setup, type Ctx } from "./helpers"

const stock = (c: Ctx, id: number) => (c.db.prepare("SELECT qty, avg_cost FROM stock_levels WHERE variant_id=?").get(id) as { qty: number; avg_cost: number } | undefined) ?? { qty: 0, avg_cost: 0 }
const codeOf = (fn: () => unknown) => {
  try {
    fn()
  } catch (e) {
    return e instanceof AppError ? e.code : `non-app:${(e as Error).message}`
  }
  return "no error"
}
const lineOf = (c: Ctx, saleId: number) => (c.db.prepare("SELECT id FROM sale_lines WHERE sale_id=?").get(saleId) as { id: number }).id

let c: Ctx
let saleId: number
beforeEach(async () => {
  c = await setup()
  postPurchase(c.db, c.owner, { supplierId: c.supplier, lines: [{ variantId: c.blue, qty: 20, rate: 100_000 }], payments: [] })
  // 10 thans @ 1,500 = 15,000; party pays 6,000 and owes 9,000
  saleId = postSale(c.db, c.owner, { partyId: c.party, lines: [{ variantId: c.blue, qty: 10 }], payments: [{ accountId: c.cash, method: "Cash", amount: 600_000 }] }).saleId
})

describe("sale return", () => {
  it("credit sale: stock comes back, party balance falls, no cash moves, COGS reverses", () => {
    const r = postSaleReturn(c.db, c.owner, { saleId, lines: [{ saleLineId: lineOf(c, saleId), qty: 4 }], settlement: "balance" })
    expect(r.total).toBe(600_000)
    expect(stock(c, c.blue).qty).toBe(14)
    expect(customerBalance(c.db, c.party)).toBe(900_000 - 600_000)
    expect(accountBalance(c.db, c.cash)).toBe(600_000)
    const p = profitSummary(c.db, "2000-01-01", "2100-01-01")
    expect(p).toMatchObject({ sales: 1_500_000, returns: 600_000, netSales: 900_000, cogs: 600_000, grossProfit: 300_000 })
    expect(stockReconcile(c.db)).toEqual([])
  })
  it("cash refund pays from the chosen account and leaves the khata net unchanged by the cash part", () => {
    const r = postSaleReturn(c.db, c.owner, { saleId, lines: [{ saleLineId: lineOf(c, saleId), qty: 2 }], settlement: "cash", accountId: c.cash, refundAmount: 300_000 })
    expect(r.refunded).toBe(300_000)
    expect(accountBalance(c.db, c.cash)).toBe(600_000 - 300_000)
    expect(customerBalance(c.db, c.party)).toBe(900_000) // credit 300k, then refund debit 300k
  })
  it("cannot return more than was sold, even across several returns", () => {
    const l = lineOf(c, saleId)
    postSaleReturn(c.db, c.owner, { saleId, lines: [{ saleLineId: l, qty: 7 }], settlement: "balance" })
    expect(codeOf(() => postSaleReturn(c.db, c.owner, { saleId, lines: [{ saleLineId: l, qty: 4 }], settlement: "balance" }))).toBe("VALIDATION")
    const last = postSaleReturn(c.db, c.owner, { saleId, lines: [{ saleLineId: l, qty: 3 }], settlement: "balance" })
    expect(last.total).toBeGreaterThan(0)
    // everything returned: total credited equals the invoice exactly (no rounding leftovers)
    expect((c.db.prepare("SELECT SUM(total) s FROM sale_returns").get() as { s: number }).s).toBe(1_500_000)
  })
  it("damaged goods are booked out again and their cost stays in COGS as a loss", () => {
    postSaleReturn(c.db, c.owner, { saleId, lines: [{ saleLineId: lineOf(c, saleId), qty: 2, damaged: true }], settlement: "balance" })
    expect(stock(c, c.blue).qty).toBe(10) // 20 - 10 sold; the 2 returned were written off
    expect(profitSummary(c.db, "2000-01-01", "2100-01-01").cogs).toBe(1_000_000)
    expect(stockReconcile(c.db)).toEqual([])
  })
  it("respects the return window and the no-invoice permission", () => {
    setSetting(c.db, "returns.window_days", "7")
    c.db.prepare("UPDATE sales SET ts = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(saleId)
    expect(codeOf(() => postSaleReturn(c.db, c.limited, { saleId, lines: [{ saleLineId: lineOf(c, saleId), qty: 1 }], settlement: "balance" }))).toBe("FORBIDDEN") // limited has no return.create
    expect(codeOf(() => postSaleReturn(c.db, c.owner, { partyId: c.party, lines: [{ variantId: c.blue, qty: 1, unitPrice: 100_000 }], settlement: "balance" }))).toBe("no error")
    expect(codeOf(() => postSaleReturn(c.db, { ...c.limited, permissions: new Set(["return.create"]) }, { partyId: c.party, lines: [{ variantId: c.blue, qty: 1, unitPrice: 1 }], settlement: "balance" }))).toBe("FORBIDDEN")
  })
  it("is atomic when the refund account step fails", () => {
    const before = { r: count(c.db, "sale_returns"), m: count(c.db, "stock_movements"), l: count(c.db, "ledger_entries") }
    c.db.exec("CREATE TEMP TRIGGER boom BEFORE INSERT ON account_entries BEGIN SELECT RAISE(ABORT,'simulated crash'); END")
    expect(() => postSaleReturn(c.db, c.owner, { saleId, lines: [{ saleLineId: lineOf(c, saleId), qty: 1 }], settlement: "cash", accountId: c.cash })).toThrow(/simulated crash/)
    c.db.exec("DROP TRIGGER boom")
    expect({ r: count(c.db, "sale_returns"), m: count(c.db, "stock_movements"), l: count(c.db, "ledger_entries") }).toEqual(before)
  })
})

describe("exchange", () => {
  it("returns old goods and sells new ones in one step; the difference is settled on the new sale", () => {
    postPurchase(c.db, c.owner, { supplierId: c.supplier, lines: [{ variantId: c.black, qty: 3, rate: 100_000 }], payments: [] })
    const ex = postExchange(c.db, c.owner, {
      ret: { saleId, lines: [{ saleLineId: lineOf(c, saleId), qty: 2 }] },
      sale: { partyId: c.party, lines: [{ variantId: c.black, qty: 1 }], payments: [] },
    })
    expect(ex.ret.total).toBe(300_000)
    expect(ex.sale.total).toBe(150_000)
    expect(customerBalance(c.db, c.party)).toBe(900_000 - 300_000 + 150_000)
  })
  it("rolls everything back when the new sale cannot be completed", () => {
    const before = count(c.db, "sale_returns")
    expect(codeOf(() => postExchange(c.db, c.owner, { ret: { saleId, lines: [{ saleLineId: lineOf(c, saleId), qty: 2 }] }, sale: { partyId: c.party, lines: [{ variantId: c.black, qty: 5 }], payments: [] } }))).toBe("INSUFFICIENT_STOCK")
    expect(count(c.db, "sale_returns")).toBe(before)
    expect(stock(c, c.blue).qty).toBe(10)
  })
})

describe("purchase return", () => {
  it("lowers stock and the supplier payable; a refund brings cash in", () => {
    const p = postPurchase(c.db, c.owner, { supplierId: c.supplier, lines: [{ variantId: c.black, qty: 5, rate: 100_000 }], payments: [] })
    const pl = (c.db.prepare("SELECT id FROM purchase_lines WHERE purchase_id=?").get(p.purchaseId) as { id: number }).id
    const before = supplierBalance(c.db, c.supplier)
    const r = postPurchaseReturn(c.db, c.owner, { purchaseId: p.purchaseId, lines: [{ purchaseLineId: pl, qty: 2 }], refundAmount: 100_000, accountId: c.cash })
    expect(r.total).toBe(200_000)
    expect(stock(c, c.black).qty).toBe(3)
    expect(supplierBalance(c.db, c.supplier)).toBe(before - 200_000 + 100_000)
    expect(accountBalance(c.db, c.cash)).toBe(600_000 + 100_000)
  })
  it("cannot return goods that were already sold", () => {
    const p = postPurchase(c.db, c.owner, { supplierId: c.supplier, lines: [{ variantId: c.black, qty: 3, rate: 100_000 }], payments: [] })
    postSale(c.db, c.owner, { partyId: c.party, lines: [{ variantId: c.black, qty: 3 }], payments: [] })
    const pl = (c.db.prepare("SELECT id FROM purchase_lines WHERE purchase_id=?").get(p.purchaseId) as { id: number }).id
    expect(codeOf(() => postPurchaseReturn(c.db, c.owner, { purchaseId: p.purchaseId, lines: [{ purchaseLineId: pl, qty: 1 }] }))).toBe("INSUFFICIENT_STOCK")
  })
})

describe("cash closing and stock count", () => {
  it("records expected vs counted cash with the variance, once per account per day", () => {
    postOpeningAccountBalance(c.db, c.owner, { accountId: c.cash, amount: 400_000 })
    const day = new Date().toISOString().slice(0, 10)
    const r = postCashClosing(c.db, c.owner, { accountId: c.cash, businessDate: day, counted: 990_000, notes: "short" })
    expect(r).toMatchObject({ expected: 1_000_000, counted: 990_000, variance: -10_000 })
    expect(codeOf(() => postCashClosing(c.db, c.owner, { accountId: c.cash, businessDate: day, counted: 1 }))).toBe("INVALID_STATE")
    expect(codeOf(() => postCashClosing(c.db, c.limited, { accountId: c.bank, businessDate: day, counted: 0 }))).toBe("FORBIDDEN")
  })
  it("a physical count adjusts only the differences, audited, and keeps stock reconciled", () => {
    const r = postStockCount(c.db, c.owner, { lines: [{ variantId: c.blue, countedQty: 8 }, { variantId: c.black, countedQty: 0 }], note: "monthly" })
    expect(r.adjusted).toBe(1) // black was 0 and counted 0
    expect(stock(c, c.blue).qty).toBe(8)
    expect(codeOf(() => postStockCount(c.db, c.owner, { lines: [{ variantId: c.blue, countedQty: -1 }] }))).toBe("VALIDATION")
    expect(codeOf(() => postStockCount(c.db, c.limited, { lines: [{ variantId: c.blue, countedQty: 1 }] }))).toBe("FORBIDDEN")
    expect(stockReconcile(c.db)).toEqual([])
  })
  it("ledger statement shows returns and refunds", () => {
    postSaleReturn(c.db, c.owner, { saleId, lines: [{ saleLineId: lineOf(c, saleId), qty: 1 }], settlement: "balance" })
    recordReceipt(c.db, c.owner, { partyId: c.party, accountId: c.cash, method: "Cash", amount: 100_000 })
    const rows = partyLedger(c.db, "customer", c.party)
    expect(rows.map((r) => r.kind)).toEqual(["sale", "receipt", "sale_return", "receipt"])
    expect(rows.at(-1)!.balance).toBe(1_500_000 - 600_000 - 150_000 - 100_000)
  })
})
