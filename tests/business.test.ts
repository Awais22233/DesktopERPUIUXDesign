import { beforeEach, describe, expect, it } from "vitest"
import { AppError } from "../src/core/errors"
import { postPurchase, voidPurchase } from "../src/main/services/purchases"
import { postSale, voidSale } from "../src/main/services/sales"
import { adjustStock, postOpeningAccountBalance, postOpeningPartyBalance, postOpeningStock, postTransfer, recordExpense, recordReceipt, recordSupplierPayment } from "../src/main/services/payments"
import { accountBalance, customerBalance, partyLedger, profitSummary, stockReconcile, supplierBalance } from "../src/main/services/queries"
import { setSetting } from "../src/main/db/util"
import { count, setup, type Ctx } from "./helpers"

const stock = (c: Ctx, variantId: number) => (c.db.prepare("SELECT qty, avg_cost FROM stock_levels WHERE variant_id=?").get(variantId) as { qty: number; avg_cost: number } | undefined) ?? { qty: 0, avg_cost: 0 }
const codeOf = (fn: () => unknown) => {
  try {
    fn()
  } catch (e) {
    return e instanceof AppError ? e.code : `non-app:${(e as Error).message}`
  }
  return "no error"
}

let c: Ctx
beforeEach(async () => {
  c = await setup()
  // 10 thans @ 1,000.00 and 10 @ 1,200.00 -> weighted average 1,100.00
  postPurchase(c.db, c.owner, { supplierId: c.supplier, lines: [{ variantId: c.blue, qty: 10, rate: 100_000 }], payments: [] })
  postPurchase(c.db, c.owner, { supplierId: c.supplier, lines: [{ variantId: c.blue, qty: 10, rate: 120_000 }], payments: [] })
})

describe("purchases", () => {
  it("increase stock, use weighted-average cost and create a supplier payable", () => {
    expect(stock(c, c.blue)).toEqual({ qty: 20, avg_cost: 110_000 })
    expect(supplierBalance(c.db, c.supplier)).toBe(2_200_000)
  })
  it("partial payment at purchase reduces the account and the payable", () => {
    const r = postPurchase(c.db, c.owner, { supplierId: c.supplier, lines: [{ variantId: c.black, qty: 5, rate: 100_000 }], payments: [{ accountId: c.cash, method: "Cash", amount: 200_000 }] })
    expect(r.payable).toBe(300_000)
    expect(accountBalance(c.db, c.cash)).toBe(-200_000)
    expect(supplierBalance(c.db, c.supplier)).toBe(2_200_000 + 300_000)
  })
  it("supplier payment cannot exceed what is owed", () => {
    expect(codeOf(() => recordSupplierPayment(c.db, c.owner, { partyId: c.supplier, accountId: c.cash, method: "Cash", amount: 9_999_999 }))).toBe("VALIDATION")
    recordSupplierPayment(c.db, c.owner, { partyId: c.supplier, accountId: c.cash, method: "Cash", amount: 1_000_000 })
    expect(supplierBalance(c.db, c.supplier)).toBe(1_200_000)
    expect(accountBalance(c.db, c.cash)).toBe(-1_000_000)
  })
})

describe("sales", () => {
  it("credit sale: sale is not payment; khata, stock, cash and COGS all update", () => {
    // Sale 5 thans @ 1,500.00 = 7,500.00, paid 3,000.00 -> owes 4,500.00
    const r = postSale(c.db, c.owner, { partyId: c.party, lines: [{ variantId: c.blue, qty: 5 }], payments: [{ accountId: c.cash, method: "Cash", amount: 300_000 }] })
    expect(r.total).toBe(750_000)
    expect(r.outstanding).toBe(450_000)
    expect(stock(c, c.blue).qty).toBe(15)
    expect(customerBalance(c.db, c.party)).toBe(450_000)
    expect(accountBalance(c.db, c.cash)).toBe(300_000)
    const line = c.db.prepare("SELECT unit_cost, size_label FROM sale_lines WHERE sale_id=?").get(r.saleId) as { unit_cost: number; size_label: string }
    expect(line).toEqual({ unit_cost: 110_000, size_label: "40 meter" })
    const p = profitSummary(c.db, "2000-01-01", "2100-01-01")
    expect(p).toMatchObject({ sales: 750_000, cogs: 550_000, grossProfit: 200_000 })
  })

  it("installment payments produce the running ledger from the specification", () => {
    postSale(c.db, c.owner, { partyId: c.party, lines: [{ variantId: c.blue, qty: 4, rate: 2_500_000 }], payments: [] }) // not permitted rate for owner? owner has override
    // Party owes 100,000.00 => then pays 30,000 / 20,000 / 50,000
    recordReceipt(c.db, c.owner, { partyId: c.party, accountId: c.cash, method: "Cash", amount: 3_000_000 })
    recordReceipt(c.db, c.owner, { partyId: c.party, accountId: c.cash, method: "Cash", amount: 2_000_000 })
    recordReceipt(c.db, c.owner, { partyId: c.party, accountId: c.bank, method: "Bank", amount: 5_000_000 })
    const rows = partyLedger(c.db, "customer", c.party)
    expect(rows.map((r) => r.balance)).toEqual([10_000_000, 7_000_000, 5_000_000, 0])
    expect(customerBalance(c.db, c.party)).toBe(0)
  })

  it("recovery cannot exceed the outstanding balance", () => {
    postSale(c.db, c.owner, { partyId: c.party, lines: [{ variantId: c.blue, qty: 1 }], payments: [] })
    expect(codeOf(() => recordReceipt(c.db, c.owner, { partyId: c.party, accountId: c.cash, method: "Cash", amount: 999_999_999 }))).toBe("VALIDATION")
  })

  it("is atomic: a failure on the last step leaves NO partial sale (power-loss style rollback)", () => {
    const before = { sales: count(c.db, "sales"), lines: count(c.db, "sale_lines"), mov: count(c.db, "stock_movements"), led: count(c.db, "ledger_entries"), acc: count(c.db, "account_entries"), seq: c.db.prepare("SELECT next_number n FROM document_sequences WHERE kind='sale'").get() }
    c.db.exec("CREATE TEMP TRIGGER boom BEFORE INSERT ON account_entries BEGIN SELECT RAISE(ABORT,'simulated crash'); END")
    expect(() => postSale(c.db, c.owner, { partyId: c.party, lines: [{ variantId: c.blue, qty: 3 }], payments: [{ accountId: c.cash, method: "Cash", amount: 100_000 }] })).toThrow(/simulated crash/)
    c.db.exec("DROP TRIGGER boom")
    expect({ sales: count(c.db, "sales"), lines: count(c.db, "sale_lines"), mov: count(c.db, "stock_movements"), led: count(c.db, "ledger_entries"), acc: count(c.db, "account_entries"), seq: c.db.prepare("SELECT next_number n FROM document_sequences WHERE kind='sale'").get() }).toEqual(before)
    expect(stock(c, c.blue).qty).toBe(20)
    expect(stockReconcile(c.db)).toEqual([])
  })

  it("refuses to oversell and writes nothing", () => {
    const sales = count(c.db, "sales")
    expect(codeOf(() => postSale(c.db, c.owner, { partyId: c.party, lines: [{ variantId: c.blue, qty: 21 }], payments: [] }))).toBe("INSUFFICIENT_STOCK")
    expect(count(c.db, "sales")).toBe(sales)
  })

  it("walk-in customers must pay in full", () => {
    expect(codeOf(() => postSale(c.db, c.owner, { partyId: c.walkIn, lines: [{ variantId: c.blue, qty: 1 }], payments: [] }))).toBe("VALIDATION")
    const ok = postSale(c.db, c.owner, { partyId: c.walkIn, lines: [{ variantId: c.blue, qty: 1 }], payments: [{ accountId: c.cash, method: "Cash", amount: 150_000 }] })
    expect(ok.outstanding).toBe(0)
  })

  it("credit limit: off by default, warn, or block (with permissioned override)", () => {
    c.db.prepare("UPDATE parties SET credit_limit = 500_000 WHERE id = ?").run(c.party)
    const big = { partyId: c.party, lines: [{ variantId: c.blue, qty: 5 }], payments: [] as never[] } // 7,500.00 > 5,000.00 limit
    expect(postSale(c.db, c.owner, big).warnings).toEqual([]) // off
    setSetting(c.db, "credit.limit_mode", "warn")
    expect(postSale(c.db, c.owner, big).warnings.length).toBe(1)
    setSetting(c.db, "credit.limit_mode", "block")
    expect(codeOf(() => postSale(c.db, c.owner, big))).toBe("CREDIT_LIMIT")
    expect(postSale(c.db, c.owner, { ...big, overrideCreditLimit: true }).warnings[0]).toMatch(/overridden/)
    expect(codeOf(() => postSale(c.db, c.limited, { ...big, overrideCreditLimit: true }))).toBe("CREDIT_LIMIT") // no permission
  })

  it("price override and backdating need permission", () => {
    expect(codeOf(() => postSale(c.db, c.limited, { partyId: c.party, lines: [{ variantId: c.blue, qty: 1, rate: 1 }], payments: [] }))).toBe("FORBIDDEN")
    expect(codeOf(() => postSale(c.db, c.limited, { partyId: c.party, ts: "2020-01-01T00:00:00Z", lines: [{ variantId: c.blue, qty: 1 }], payments: [] }))).toBe("FORBIDDEN")
    expect(postSale(c.db, c.limited, { partyId: c.party, lines: [{ variantId: c.blue, qty: 1 }], payments: [] }).total).toBe(150_000)
  })

  it("invoice numbers are sequential with no gaps, even after a failed attempt", () => {
    const a = postSale(c.db, c.owner, { partyId: c.party, lines: [{ variantId: c.blue, qty: 1 }], payments: [] })
    expect(() => postSale(c.db, c.owner, { partyId: c.party, lines: [{ variantId: c.blue, qty: 999 }], payments: [] })).toThrow()
    const b = postSale(c.db, c.owner, { partyId: c.party, lines: [{ variantId: c.blue, qty: 1 }], payments: [] })
    expect([a.invoiceNo, b.invoiceNo]).toEqual(["INV-00001", "INV-00002"])
  })
})

describe("void (no destructive deletes)", () => {
  it("voiding a sale reverses stock, khata and cash exactly", () => {
    const r = postSale(c.db, c.owner, { partyId: c.party, lines: [{ variantId: c.blue, qty: 5 }], payments: [{ accountId: c.cash, method: "Cash", amount: 300_000 }] })
    voidSale(c.db, c.owner, r.saleId, "Customer cancelled")
    expect(stock(c, c.blue)).toEqual({ qty: 20, avg_cost: 110_000 })
    expect(customerBalance(c.db, c.party)).toBe(0)
    expect(accountBalance(c.db, c.cash)).toBe(0)
    expect(profitSummary(c.db, "2000-01-01", "2100-01-01").sales).toBe(0)
    expect(codeOf(() => voidSale(c.db, c.owner, r.saleId, "again"))).toBe("INVALID_STATE")
    expect(codeOf(() => voidSale(c.db, c.limited, r.saleId, "x"))).toBe("FORBIDDEN")
    expect(count(c.db, "sales")).toBe(1) // still there, marked void
    expect(stockReconcile(c.db)).toEqual([])
  })
  it("a purchase cannot be voided once its goods were sold", () => {
    const p = postPurchase(c.db, c.owner, { supplierId: c.supplier, lines: [{ variantId: c.black, qty: 3, rate: 100_000 }], payments: [] })
    postSale(c.db, c.owner, { partyId: c.party, lines: [{ variantId: c.black, qty: 2 }], payments: [] })
    expect(codeOf(() => voidPurchase(c.db, c.owner, p.purchaseId, "mistake"))).toBe("INSUFFICIENT_STOCK")
    expect(supplierBalance(c.db, c.supplier)).toBe(2_200_000 + 300_000)
  })
})

describe("finance rules", () => {
  it("transfers and recovery are not income; expenses reduce profit", () => {
    postSale(c.db, c.owner, { partyId: c.party, lines: [{ variantId: c.blue, qty: 2 }], payments: [] }) // 3,000.00 sale
    recordReceipt(c.db, c.owner, { partyId: c.party, accountId: c.cash, method: "Cash", amount: 100_000 })
    postOpeningAccountBalance(c.db, c.owner, { accountId: c.cash, amount: 1_000_000 })
    postTransfer(c.db, c.owner, { fromAccountId: c.cash, toAccountId: c.bank, amount: 500_000 })
    recordExpense(c.db, c.owner, { categoryId: c.rent, amount: 50_000, accountId: c.cash })
    const p = profitSummary(c.db, "2000-01-01", "2100-01-01")
    expect(p).toMatchObject({ sales: 300_000, cogs: 220_000, grossProfit: 80_000, expenses: 50_000, netProfit: 30_000 })
    expect(accountBalance(c.db, c.cash)).toBe(100_000 + 1_000_000 - 500_000 - 50_000)
    expect(accountBalance(c.db, c.bank)).toBe(500_000)
  })
  it("opening balances for parties, accounts and stock", () => {
    postOpeningPartyBalance(c.db, c.owner, { kind: "customer", partyId: c.party, amount: 2_500_000 })
    postOpeningPartyBalance(c.db, c.owner, { kind: "supplier", partyId: c.supplier, amount: 1_000_000 })
    expect(customerBalance(c.db, c.party)).toBe(2_500_000)
    expect(supplierBalance(c.db, c.supplier)).toBe(2_200_000 + 1_000_000)
    postOpeningStock(c.db, c.owner, { variantId: c.black, qty: 8, unitCost: 95_000 })
    expect(stock(c, c.black)).toEqual({ qty: 8, avg_cost: 95_000 })
  })
  it("stock adjustment needs permission and a reason, and is audited", () => {
    expect(codeOf(() => adjustStock(c.db, c.limited, { variantId: c.blue, qtyDelta: -1, reason: "lost" }))).toBe("FORBIDDEN")
    expect(codeOf(() => adjustStock(c.db, c.owner, { variantId: c.blue, qtyDelta: -1, reason: " " }))).toBe("VALIDATION")
    adjustStock(c.db, c.owner, { variantId: c.blue, qtyDelta: -2, reason: "water damage", type: "damage" })
    expect(stock(c, c.blue).qty).toBe(18)
    expect(c.db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='stock.adjust'").get()).toEqual({ c: 1 })
  })
})

describe("invariants", () => {
  it("after a mixed workload: stock cache == movements; every ledger balance ties to its statement", () => {
    for (let i = 0; i < 6; i++) postSale(c.db, c.owner, { partyId: c.party, lines: [{ variantId: c.blue, qty: 2 }], payments: i % 2 ? [{ accountId: c.cash, method: "Cash", amount: 100_000 }] : [] })
    const v = postSale(c.db, c.owner, { partyId: c.party, lines: [{ variantId: c.blue, qty: 1 }], payments: [] })
    voidSale(c.db, c.owner, v.saleId, "test")
    adjustStock(c.db, c.owner, { variantId: c.blue, qtyDelta: -1, reason: "count" })
    expect(stockReconcile(c.db)).toEqual([])
    const rows = partyLedger(c.db, "customer", c.party)
    expect(rows.at(-1)!.balance).toBe(customerBalance(c.db, c.party))
    const net = c.db.prepare("SELECT COALESCE(SUM(amount),0) s FROM account_entries").get() as { s: number }
    expect(net.s).toBe(accountBalance(c.db, c.cash) + accountBalance(c.db, c.bank))
  })
})
