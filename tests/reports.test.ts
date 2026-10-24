import { describe, expect, it } from "vitest"
import { createCommands, type Ctx } from "../src/main/commands"
import { openDatabase } from "../src/main/db/connection"
import { migrate } from "../src/main/db/migrate"
import { migrations } from "../src/main/db/migrations"
import { seedRoles } from "../src/main/services/auth"
import { ensureConfig, setFlag } from "../src/main/services/config"
import { seedDefaults } from "../src/main/services/defaults"
import { ensureWalkInParty } from "../src/main/services/masterData"
import { runReport } from "../src/main/services/reports"
import { Session } from "../src/main/session"
import { bizDate } from "../src/main/services/snapshot"

const REPORTS = ["Daily Sales", "Sales by Customer", "Sales by City", "Sales by Company", "Sales by Article", "Sales by User", "Purchase Report", "Supplier Purchase", "Company Purchase", "Article Purchase", "Current Stock", "Stock Movement", "Stock Valuation", "Low Stock", "Out of Stock", "Stock Adjustments", "Batch Stock", "Near Expiry", "Expired Items", "Outstanding Report", "Party Statements", "Receivable Aging", "Party Payments", "City-wise Analysis", "Supplier Payables", "Supplier Statements", "Payable Aging", "Supplier Payments", "Cash Book", "Bank Book", "Transfers", "Expenses", "Daily Closing", "Profit & Loss", "Daily Profit", "Monthly Profit", "Company Profitability", "Category Profitability", "Customer Profitability", "City Profitability"]

async function world() {
  const db = openDatabase(":memory:")
  await migrate(db, migrations)
  seedRoles(db)
  ensureConfig(db, "cloth")
  setFlag(db, null, "profit", true) // the cloth preset hides profit; these tests check the numbers behind it
  ensureWalkInParty(db)
  seedDefaults(db)
  const session = new Session()
  const c = createCommands({ db: () => db, session, backups: () => { throw new Error("n/a") }, restore: async () => {}, chooseFolder: async () => null, backupsDir: "", restoreInfo: () => ({ maxSchema: 99 }), restoreExternal: async () => {} } as Ctx)
  c["auth:setup"]({ name: "Faraz", username: "faraz", password: "secret1" })
  const sup = (await c["party:save"]({ kind: "supplier", name: "ABC Textile", city: "Karachi" })).id
  const a = (await c["party:save"]({ kind: "customer", name: "Ali Traders", city: "Ghotki" })).id
  const b = (await c["party:save"]({ kind: "customer", name: "Bilal Cloth", city: "Pano Aqil" })).id
  const x = (await c["product:save"]({ company: "Faraz Company", article: "Article A", category: "Cotton", color: "Blue", size: "40 meter", cost: 1000, rate: 1500, minStock: 5 })).id
  await c["purchase:create"]({ supplierId: sup, lines: [{ productId: x, qty: 30, rate: 1000 }], payments: [{ account: "Cash in hand", method: "Cash", amount: 0 }] })
  await c["opening:account"]({ account: "Cash in hand", amount: 50000 })
  await c["sale:create"]({ partyId: a, lines: [{ productId: x, qty: 10 }], payments: [{ account: "Cash in hand", method: "Cash", amount: 6000 }] })
  await c["sale:create"]({ partyId: b, lines: [{ productId: x, qty: 4 }], payments: [] })
  await c["receipt:create"]({ partyId: b, account: "Cash in hand", method: "Cash", amount: 2000 })
  await c["return:sale"]({ invoice: "INV-00001", quantities: { [x]: 2 }, settlement: "balance" })
  await c["expense:create"]({ category: "Rent", amount: 1000, account: "Cash in hand" })
  const day = bizDate(new Date().toISOString(), 300) // the business day, not the UTC day
  return { db, c, day }
}

describe("reports", () => {
  it("every report in the catalog runs and returns well-formed data", async () => {
    const { db, day } = await world()
    for (const name of REPORTS) {
      const r = runReport(db, { name, from: day, to: day })
      expect(r.columns.length, name).toBeGreaterThan(0)
      expect(r.summary.length, name).toBe(3)
      for (const row of r.rows) for (const col of r.columns) expect(row[col.key], `${name}.${col.key}`).not.toBeUndefined()
    }
  })

  it("Profit & Loss uses recorded costs, returns and expenses (no assumed margin)", async () => {
    const { db, day } = await world()
    const p = runReport(db, { name: "Profit & Loss", from: day, to: day })
    const amount = (n: string) => p.rows.find((x) => x.name === n)!.amount
    // sold 14 thans @1500 = 21,000; returned 2 thans = 3,000; cost 1,000 per than
    expect(amount("Sales")).toBe(21000)
    expect(amount("Less: sale returns")).toBe(-3000)
    expect(amount("Net sales")).toBe(18000)
    expect(amount("Cost of goods sold")).toBe(-12000) // 12 thans kept by customers
    expect(amount("Gross profit")).toBe(6000)
    expect(amount("Net profit")).toBe(5000) // less 1,000 rent
  })

  it("the reports agree with the balances shown elsewhere", async () => {
    const { db, c, day } = await world()
    const s = await c["snapshot:get"](undefined)
    const out = runReport(db, { name: "Outstanding Report", from: day, to: day })
    expect(out.summary[0]!.value).toBe(s.dashboard.receivables)
    const stock = runReport(db, { name: "Stock Valuation", from: day, to: day })
    expect(stock.summary[0]!.value).toBe(s.dashboard.stockValue)
    const cash = runReport(db, { name: "Cash Book", from: day, to: day })
    expect(cash.rows.at(-1)!.balance).toBe(s.accounts["Cash in hand"])
    const city = runReport(db, { name: "City-wise Analysis", from: day, to: day })
    expect(city.rows.map((r) => r.city).sort()).toEqual(["Ghotki", "Pano Aqil"])
    expect(Number(city.summary[2]!.value)).toBe(s.dashboard.receivables)
  })

  it("filters narrow a report to one party", async () => {
    const { db, day } = await world()
    const r = runReport(db, { name: "Daily Sales", from: day, to: day, filter: "Ali" })
    expect(r.rows.map((x) => x.party)).toEqual(["Ali Traders"])
  })
})
