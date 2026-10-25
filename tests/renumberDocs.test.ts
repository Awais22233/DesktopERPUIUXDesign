import { beforeEach, describe, expect, it } from "vitest"
import { AppError } from "../src/core/errors"
import { postOpeningPartyBalance, recordExpense, recordReceipt, recordSupplierPayment, renumberExpense, renumberPayment } from "../src/main/services/payments"
import { setup, type Ctx } from "./helpers"

const msg = (fn: () => unknown) => {
  try {
    fn()
  } catch (e) {
    return e instanceof AppError ? `${e.code}: ${e.message}` : "non-app"
  }
  return "no error"
}
let c: Ctx
beforeEach(async () => {
  c = await setup()
  postOpeningPartyBalance(c.db, c.owner, { kind: "customer", partyId: c.party, amount: 10_000_000 })
  postOpeningPartyBalance(c.db, c.owner, { kind: "supplier", partyId: c.supplier, amount: 10_000_000 })
})
const rc = (amount = 1000) => recordReceipt(c.db, c.owner, { partyId: c.party, accountId: c.cash, method: "Cash", amount })

describe("changing the number of receipts, pay slips and expenses", () => {
  it("renumbers a receipt, keeps money, refuses a used number, and the next automatic number skips it", () => {
    const a = rc()
    const b = rc(500)
    expect(renumberPayment(c.db, c.owner, a.paymentId, "R-77")).toBe("R-77")
    expect(c.db.prepare("SELECT doc_no FROM payments WHERE id = ?").get(a.paymentId)).toEqual({ doc_no: "R-77" })
    expect(c.db.prepare("SELECT description FROM account_entries WHERE source_type='payment' AND source_id = ?").get(a.paymentId)).toEqual({ description: "Receipt R-77" })
    expect(msg(() => renumberPayment(c.db, c.owner, b.paymentId, "r-77"))).toContain("already used")
    // typed number equal to the next automatic one must not break the next receipt
    const next = Number(/(\d+)$/.exec(b.docNo)![1]) + 1
    renumberPayment(c.db, c.owner, b.paymentId, b.docNo.replace(/\d+$/, String(next).padStart(b.docNo.length - b.docNo.replace(/\d+$/, "").length, "0")))
    const d = rc()
    expect(d.docNo).not.toBe(b.docNo)
  })
  it("renumbers a supplier pay slip", () => {
    const p = recordSupplierPayment(c.db, c.owner, { partyId: c.supplier, accountId: c.cash, method: "Cash", amount: 700 })
    expect(renumberPayment(c.db, c.owner, p.paymentId, "S-5")).toBe("S-5")
  })
  it("renumbers an expense and keeps numbers unique", () => {
    const cat = (c.db.prepare("SELECT id FROM expense_categories LIMIT 1").get() as { id: number }).id
    const e1 = recordExpense(c.db, c.owner, { categoryId: cat, amount: 100, accountId: c.cash })
    const e2 = recordExpense(c.db, c.owner, { categoryId: cat, amount: 200, accountId: c.cash })
    void e1
    const id1 = Number(c.db.prepare("SELECT MIN(id) m FROM expenses").pluck().get())
    const id2 = Number(c.db.prepare("SELECT MAX(id) m FROM expenses").pluck().get())
    void e2
    // EXP-0001 is the automatic name of the first expense, so the second one cannot take it
    expect(msg(() => renumberExpense(c.db, c.owner, id2, "EXP-0001"))).toContain("already used")
    expect(renumberExpense(c.db, c.owner, id1, "V-9")).toBe("V-9")
    expect(msg(() => renumberExpense(c.db, c.owner, id2, "v-9"))).toContain("already used")
    expect(renumberExpense(c.db, c.owner, id1, "EXP-0001")).toBe("EXP-0001")
  })
  it("needs the adjust permission", () => {
    const a = rc()
    expect(msg(() => renumberPayment(c.db, { ...c.owner, permissions: new Set<string>() } as never, a.paymentId, "X-1"))).not.toBe("no error")
  })
})
