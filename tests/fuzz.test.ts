import { describe, expect, it } from "vitest"
import { accountingIdentity, bookChecks } from "../src/main/services/bookchecks"
import { postOpeningAccountBalance, postOpeningStock } from "../src/main/services/payments"
import { stockReconcile } from "../src/main/services/queries"
import { setup } from "./helpers"
import { buildWorld, OPS, rng, step, type Op, type Tally } from "./support/fuzz"

async function world(seed: number) {
  const c = await setup()
  const r = rng(seed)
  const w = buildWorld(c.db, c.owner, r)
  // Start from a believable opening position so the identity has something to carry.
  for (const a of w.accounts) postOpeningAccountBalance(c.db, c.owner, { accountId: a, amount: 5_000_000 })
  for (const v of w.variants) postOpeningStock(c.db, c.owner, { variantId: v, qty: 20, unitCost: 100_033 })
  return { c, r, w }
}

function assertBooks(c: Awaited<ReturnType<typeof setup>>, label: string) {
  const b = bookChecks(c.db)
  expect({ label, customers: b.customers, suppliers: b.suppliers, accounts: b.accounts, stock: b.stock, documents: b.documents }).toEqual({ label, customers: [], suppliers: [], accounts: [], stock: [], documents: [] })
  const id = accountingIdentity(c.db)
  expect({ label, difference: id.difference }).toEqual({ label, difference: 0 })
  expect(stockReconcile(c.db)).toEqual([])
}

describe("random business: the books always balance", () => {
  for (const seed of [1, 7, 42, 2026]) {
    it(`seed ${seed}: 1200 mixed operations`, async () => {
      const { c, r, w } = await world(seed)
      const tally: Tally = {}
      for (let i = 1; i <= 1200; i++) {
        step(w, r, tally)
        if (i % 150 === 0) assertBooks(c, `seed ${seed} after ${i} ops`)
      }
      assertBooks(c, `seed ${seed} final`)
      // The run must really have exercised the engine, not just been rejected.
      const done = Object.values(tally).reduce((s, x) => s + x.ok, 0)
      expect(done).toBeGreaterThan(600)
      expect(tally.sale!.ok).toBeGreaterThan(100)
    }, 120_000)
  }
  for (const op of OPS) {
    it(`only "${op}" operations, interleaved with sales and purchases, never drift`, async () => {
      const { c, r, w } = await world(99)
      const tally: Tally = {}
      for (let i = 0; i < 80; i++) {
        step(w, r, tally, i % 3 === 0 ? ("purchase" as Op) : i % 3 === 1 ? ("sale" as Op) : op)
      }
      assertBooks(c, op)
    }, 60_000)
  }
})

describe("the checks themselves are able to fail", () => {
  it("a mixed run does real work of every kind", async () => {
    const { r, w } = await world(5)
    const tally: Tally = {}
    for (let i = 0; i < 1500; i++) step(w, r, tally)
    for (const op of OPS) expect(tally[op]?.ok ?? 0, `operation ${op} never succeeded: ${JSON.stringify(tally)}`).toBeGreaterThan(0)
  }, 120_000)

  it("detects a customer balance, a cash entry, a stock value and a profit leak when tampered with", async () => {
    const { c, r, w } = await world(11)
    const tally: Tally = {}
    for (let i = 0; i < 300; i++) step(w, r, tally)
    assertBooks(c, "clean")
    // each tamper is rolled back so the next one is isolated
    const tamper = (sql: string, check: (b: ReturnType<typeof bookChecks>, id: ReturnType<typeof accountingIdentity>) => boolean) => {
      c.db.exec("SAVEPOINT t")
      c.db.exec("DROP TRIGGER IF EXISTS no_update_ledger")
      try {
        c.db.exec(sql)
        expect(check(bookChecks(c.db), accountingIdentity(c.db)), sql).toBe(true)
      } finally {
        c.db.exec("ROLLBACK TO t; RELEASE t")
      }
    }
    tamper("UPDATE ledger_entries SET debit = debit + 100 WHERE id = (SELECT MIN(id) FROM ledger_entries WHERE party_kind='customer' AND debit > 0)", (b) => b.customers.length > 0)
    tamper("UPDATE account_entries SET amount = amount + 1 WHERE id = (SELECT MAX(id) FROM account_entries)", (b) => b.accounts.length > 0)
    tamper("UPDATE stock_levels SET value = value + 1 WHERE qty > 0", (b) => b.stock.length > 0)
    tamper("UPDATE sale_lines SET cost_total = cost_total + 5 WHERE id = (SELECT MIN(id) FROM sale_lines)", (b, id) => b.documents.length > 0 || id.difference !== 0)
  }, 60_000)
})
