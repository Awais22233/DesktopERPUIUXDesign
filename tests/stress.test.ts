import { describe, expect, it } from "vitest"
import { statSync } from "node:fs"
import { join } from "node:path"
import { buildSnapshot } from "../src/main/services/snapshot"
import { accountingIdentity, bookChecks } from "../src/main/services/bookchecks"
import { runReport } from "../src/main/services/reports"
import { postPurchase } from "../src/main/services/purchases"
import { postSale } from "../src/main/services/sales"
import { recordReceipt } from "../src/main/services/payments"
import { createCity, createCompany, createItem, createParty, createSupplier, createVariant, createAccount, ensureWalkInParty } from "../src/main/services/masterData"
import { createBackup } from "../src/main/db/backup"
import { rng } from "./support/fuzz"
import { setFlag } from "../src/main/services/config"
import { setup, tempDir } from "./helpers"

// Heavy: run with STRESS=1. Models a large wholesaler: 20,000 variants, 3,000 customers, 90 trading days.
const heavy = process.env.STRESS ? describe : describe.skip
const timed = async <T>(label: string, fn: () => T | Promise<T>, log: string[]): Promise<T> => {
  const t = performance.now()
  const v = await fn()
  log.push(`${label}: ${Math.round(performance.now() - t)} ms`)
  return v
}

heavy("a very large shop", () => {
  it("stays correct and fast", async () => {
    const dir = tempDir()
    const c = await setup("cloth", join(dir, "big.db"))
    const log: string[] = []
    setFlag(c.db, null, "profit", true) // this test also times the profit reports, which cloth hides by default
    const r = rng(2026)
    const N_VARIANTS = Number(process.env.STRESS_VARIANTS ?? 20_000)
    const N_CUSTOMERS = 3000
    const N_SUPPLIERS = 300
    const DAYS = 90

    const variants: number[] = []
    const customers: number[] = []
    const suppliers: number[] = []
    await timed(`create ${N_VARIANTS} variants, ${N_CUSTOMERS} customers, ${N_SUPPLIERS} suppliers`, () => {
      const company = createCompany(c.db, c.owner, "Big Co")
      c.db.exec("BEGIN")
      for (let i = 0; i < 2000; i++) {
        const item = createItem(c.db, { companyId: company, name: `Article ${i}` })
        for (let k = 0; k < N_VARIANTS / 2000; k++) {
          const cost = r.int(300, 6000) * 100
          variants.push(createVariant(c.db, { itemId: item, color: `Color ${k}`, sizeLabel: `${r.int(10, 60)} meter`, purchasePrice: cost, salePrice: Math.round(cost * 1.25) }))
        }
      }
      const city = createCity(c.db, "Bigcity")
      for (let i = 0; i < N_CUSTOMERS; i++) customers.push(createParty(c.db, { name: `Customer ${i}`, cityId: city, creditLimit: 0 }))
      for (let i = 0; i < N_SUPPLIERS; i++) suppliers.push(createSupplier(c.db, { name: `Supplier ${i}` }))
      c.db.exec("COMMIT")
    }, log)
    ensureWalkInParty(c.db)

    // stock it up
    await timed("opening purchases (every variant bought once)", () => {
      for (let i = 0; i < variants.length; i += 25) {
        postPurchase(c.db, c.owner, { supplierId: r.pick(suppliers), lines: variants.slice(i, i + 25).map((v) => ({ variantId: v, qty: r.int(30, 80), rate: r.int(300, 6000) * 100 })), payments: [{ accountId: c.cash, method: "Cash", amount: 1 }] })
      }
    }, log)

    let sales = 0
    let receipts = 0
    await timed(`${DAYS} days of trading`, () => {
      for (let d = 0; d < DAYS; d++) {
        const ts = new Date(Date.UTC(2026, 6, 1) + d * 86_400_000 + 8 * 3_600_000).toISOString()
        for (let i = 0; i < 60; i++) {
          const party = r.pick(customers)
          const lines = Array.from(new Set(Array.from({ length: r.int(1, 5) }, () => r.pick(variants)))).map((v) => ({ variantId: v, qty: r.int(1, 6) }))
          try {
            postSale(c.db, c.owner, { partyId: party, ts, lines, payments: r.chance(0.3) ? [{ accountId: c.cash, method: "Cash", amount: 1000 }] : [] })
            sales++
          } catch { /* rejected sales are fine */ }
        }
        const owing = c.db.prepare("SELECT party_id id, SUM(debit)-SUM(credit) b FROM ledger_entries WHERE party_kind='customer' GROUP BY party_id HAVING b > 0 ORDER BY RANDOM() LIMIT 25").all() as { id: number; b: number }[]
        for (const o of owing) {
          try {
            recordReceipt(c.db, c.owner, { partyId: o.id, ts, accountId: c.cash, method: "Cash", amount: Math.min(o.b, r.int(1, 5) * 100_000) })
            receipts++
          } catch { /* ignore */ }
        }
        if (d % 7 === 6) {
          try { postPurchase(c.db, c.owner, { supplierId: r.pick(suppliers), ts, lines: Array.from({ length: 30 }, () => ({ variantId: r.pick(variants), qty: r.int(10, 60), rate: r.int(300, 6000) * 100 })).filter((l, i, a) => a.findIndex((x) => x.variantId === l.variantId) === i), payments: [] }) } catch { /* ignore */ }
        }
      }
    }, log)
    log.push(`sales: ${sales}, receipts: ${receipts}`)

    const snap = await timed("buildSnapshot", () => buildSnapshot(c.db), log)
    log.push(`snapshot JSON size: ${(JSON.stringify(snap).length / 1e6).toFixed(1)} MB`)
    await timed("report: Profit & Loss", () => runReport(c.db, { name: "Profit & Loss", from: "2026-07-01", to: "2026-12-31" }), log)
    await timed("report: Current Stock", () => runReport(c.db, { name: "Current Stock", from: "2026-07-01", to: "2026-12-31" }), log)
    await timed("report: Outstanding Report", () => runReport(c.db, { name: "Outstanding Report", from: "2026-07-01", to: "2026-12-31" }), log)
    const checks = await timed("bookChecks", () => bookChecks(c.db), log)
    const id = accountingIdentity(c.db)
    const dest = await timed("backup", () => createBackup(c.db, dir, "stress"), log)
    log.push(`database ${(statSync(join(dir, "big.db")).size / 1e6).toFixed(1)} MB, backup ${(statSync(dest).size / 1e6).toFixed(1)} MB`)
    const ic = await timed("integrity_check", () => c.db.pragma("integrity_check", { simple: true }), log)
    console.log("\nSTRESS RESULTS\n" + log.join("\n"))

    expect(ic).toBe("ok")
    expect({ c: checks.customers, s: checks.suppliers, a: checks.accounts, st: checks.stock, d: checks.documents }).toEqual({ c: [], s: [], a: [], st: [], d: [] })
    expect(id.difference).toBe(0)
    expect(sales).toBeGreaterThan(DAYS * 40)
  }, 900_000)
})
