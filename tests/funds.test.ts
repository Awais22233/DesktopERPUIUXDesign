import { describe, expect, it } from "vitest"
import { AppError } from "../src/core/errors"
import { openDatabase } from "../src/main/db/connection"
import { migrate } from "../src/main/db/migrate"
import { migrations } from "../src/main/db/migrations"
import { accountingIdentity, bookChecks } from "../src/main/services/bookchecks"
import { recordExpense, recordFund } from "../src/main/services/payments"
import { profitSummary } from "../src/main/services/queries"
import { postSale } from "../src/main/services/sales"
import { postPurchase } from "../src/main/services/purchases"
import { setup } from "./helpers"

const far = "9999"
describe("money in (Add fund)", () => {
  it("adds money to a bank account, keeps the books balanced, and counts only Other income as profit", async () => {
    const c = await setup()
    postPurchase(c.db, c.owner, { supplierId: c.supplier, lines: [{ variantId: c.blue, qty: 10, rate: 100_000 }], payments: [] })
    postSale(c.db, c.owner, { partyId: c.party, lines: [{ variantId: c.blue, qty: 2, rate: 150_000 }], payments: [{ accountId: c.cash, method: "Cash", amount: 300_000 }] })
    recordExpense(c.db, c.owner, { categoryId: c.rent, amount: 50_000, accountId: c.cash })
    const before = profitSummary(c.db, "0000", far).netProfit
    recordFund(c.db, c.owner, { kind: "capital", amount: 5_000_000, accountId: c.bank, from: "Owner" })
    recordFund(c.db, c.owner, { kind: "loan", amount: 2_000_000, accountId: c.bank, from: "Uncle", notes: "returns in 6 months" })
    expect(profitSummary(c.db, "0000", far).netProfit).toBe(before)
    recordFund(c.db, c.owner, { kind: "income", amount: 120_000, accountId: c.cash, notes: "scrap sold" })
    const p = profitSummary(c.db, "0000", far)
    expect(p.otherIncome).toBe(120_000)
    expect(p.netProfit).toBe(before + 120_000)
    expect((c.db.prepare("SELECT balance FROM v_account_balance WHERE account_id = ?").get(c.bank) as { balance: number }).balance).toBe(7_000_000)
    expect(accountingIdentity(c.db).difference).toBe(0)
    const checks = bookChecks(c.db)
    expect(checks.accounts).toEqual([])
  })
  it("refuses a bad amount, an unknown kind, and a user without the adjust permission", async () => {
    const c = await setup()
    const code = (fn: () => unknown) => { try { fn() } catch (e) { return e instanceof AppError ? e.code : "other" } return "none" }
    expect(code(() => recordFund(c.db, c.owner, { kind: "capital", amount: 0, accountId: c.bank }))).toBe("VALIDATION")
    expect(code(() => recordFund(c.db, c.owner, { kind: "gift" as never, amount: 100, accountId: c.bank }))).toBe("VALIDATION")
    expect(code(() => recordFund(c.db, c.limited, { kind: "capital", amount: 100, accountId: c.bank }))).toBe("FORBIDDEN")
  })
  it("the upgrade keeps every existing cash and bank entry", async () => {
    const db = openDatabase(":memory:")
    await migrate(db, migrations.slice(0, 6))
    db.prepare("INSERT INTO accounts(name, type) VALUES ('Cash','cash')").run()
    db.prepare("INSERT INTO account_entries(ts, account_id, amount, kind, description) VALUES ('2026-01-01T00:00:00Z',1,500000,'opening','Opening'),('2026-01-02T00:00:00Z',1,-100,'expense','Tea')").run()
    await migrate(db, migrations)
    expect(db.prepare("SELECT COUNT(*) c, SUM(amount) s FROM account_entries").get()).toEqual({ c: 2, s: 499900 })
    expect((db.prepare("SELECT balance FROM v_account_balance WHERE account_id = 1").get() as { balance: number }).balance).toBe(499900)
    db.prepare("INSERT INTO account_entries(ts, account_id, amount, kind) VALUES ('2026-01-03T00:00:00Z',1,10,'fund_in')").run()
  })
})
