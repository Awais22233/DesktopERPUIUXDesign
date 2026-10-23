import { describe, expect, it } from "vitest"
import { createCommands, type Ctx } from "../src/main/commands"
import { openDatabase } from "../src/main/db/connection"
import { migrate } from "../src/main/db/migrate"
import { migrations } from "../src/main/db/migrations"
import { seedRoles } from "../src/main/services/auth"
import { ensureConfig } from "../src/main/services/config"
import { seedDefaults } from "../src/main/services/defaults"
import { ensureWalkInParty } from "../src/main/services/masterData"
import { Session } from "../src/main/session"
import { AppError } from "../src/core/errors"
import type { ProfileId } from "../src/shared/profiles"

async function app(profile: ProfileId = "cloth") {
  const db = openDatabase(":memory:")
  await migrate(db, migrations)
  seedRoles(db)
  ensureConfig(db, profile)
  ensureWalkInParty(db)
  seedDefaults(db)
  const session = new Session()
  const ctx: Ctx = { db: () => db, session, backups: () => { throw new Error("n/a") }, restore: async () => {}, chooseFolder: async () => null, backupsDir: "", restoreInfo: () => ({ maxSchema: 99 }), restoreExternal: async () => {} }
  const c = createCommands(ctx)
  c["auth:setup"]({ name: "Faraz", username: "faraz", password: "secret1" })
  return { db, c, session }
}
/** Paged lists: the renderer no longer receives whole collections in the snapshot. */
type Cmds = ReturnType<typeof createCommands>
const P = async (c: Cmds) => (await c["products:list"]({ pageSize: 500 })).rows
const S = async (c: Cmds) => (await c["docs:list"]({ kind: "sale", pageSize: 500 })).rows
const U = async (c: Cmds) => (await c["docs:list"]({ kind: "purchase", pageSize: 500 })).rows
const fail = async (fn: () => unknown) => {
  try {
    await fn()
  } catch (e) {
    return e instanceof AppError ? `${e.code}: ${e.message}` : `other: ${(e as Error).message}`
  }
  return "no error"
}

describe("a brand-new installation holds no demo data", () => {
  it("starts empty apart from configuration defaults", async () => {
    const { c } = await app()
    const s = (await c["snapshot:get"](undefined)) as Awaited<ReturnType<typeof c["snapshot:get"]>>
    expect(s.parties).toEqual([])
    expect(s.suppliers).toEqual([])
    expect(await P(c)).toEqual([])
    expect(await S(c)).toEqual([])
    expect(await U(c)).toEqual([])
    expect(s.collections).toEqual([])
    expect(s.expenses).toEqual([])
    expect(s.returns).toEqual([])
    expect(s.accounts).toEqual({ "Cash in hand": 0 })
    expect(s.masters.expenseCategories).toContain("Rent")
    expect(s.users.map((u) => u.name)).toEqual(["Faraz"])
  })
})

describe("sign-in", () => {
  it("only one owner can be created at first run; wrong passwords lock out briefly", async () => {
    const { c, db, session } = await app()
    expect(await fail(() => c["auth:setup"]({ name: "x", username: "x", password: "secret1" }))).toMatch(/already exists/)
    session.logout(db)
    expect(session.loggedIn).toBe(false)
    for (let i = 0; i < 5; i++) expect(await fail(() => session.login(db, "faraz", "wrong", 1_000))).toMatch(/not correct/)
    expect(await fail(() => session.login(db, "faraz", "secret1", 2_000))).toMatch(/Too many attempts/)
    expect(session.login(db, "faraz", "secret1", 1_000 + 61_000).name).toBe("Faraz")
  })
  it("a user without a permission is refused by the engine", async () => {
    const { c, db, session } = await app()
    await c["user:create"]({ name: "Sam", username: "sam", password: "abcdef", role: "Sales User" })
    session.logout(db)
    session.login(db, "sam", "abcdef")
    expect(await fail(() => c["user:create"]({ name: "Z", username: "z", password: "abcdef", role: "Viewer" }))).toMatch(/FORBIDDEN/)
    expect(await fail(() => c["expense:create"]({ category: "Rent", amount: 10, account: "Cash in hand" }))).toMatch(/FORBIDDEN/)
  })
})

describe("end to end through the command layer (what the screens call)", () => {
  it("catalog, purchase, sale, recovery, return, void: every figure ties out", async () => {
    const { c } = await app()
    const sup = (await c["party:save"]({ kind: "supplier", name: "ABC Textile", city: "Karachi" })).id
    const party = (await c["party:save"]({ kind: "customer", name: "Ali Traders", city: "Ghotki", whatsapp: "0300", limit: 50000, openingBalance: 2000 })).id
    const blue = (await c["product:save"]({ company: "Faraz Company", article: "Article A", color: "Blue", size: "40 meter", cost: 1000, rate: 1500 })).id
    await c["purchase:create"]({ supplierId: sup, supplierInvoice: "S-77", lines: [{ productId: blue, qty: 20, rate: 1000 }], payments: [{ account: "Cash in hand", method: "Cash", amount: 0 }] })
    await c["opening:account"]({ account: "Cash in hand", amount: 100000 })
    const sale = await c["sale:create"]({ partyId: party, lines: [{ productId: blue, qty: 10 }], payments: [{ account: "Cash in hand", method: "Cash", amount: 6000 }] })
    expect(sale.id).toBe("INV-00001")

    let s = await c["snapshot:get"](undefined)
    const p = s.parties[0]!
    expect(p).toMatchObject({ name: "Ali Traders", city: "Ghotki", balance: 2000 + 15000 - 6000, status: "Outstanding" })
    expect((await P(c))[0]).toMatchObject({ stock: 10, cost: 1000, rate: 1500, size: "40 meter" })
    expect(s.accounts["Cash in hand"]).toBe(106000)
    expect((await S(c))[0]).toMatchObject({ id: "INV-00001", party: "Ali Traders", total: 15000, paid: 6000, method: "Partial", items: 10 })
    expect((await S(c))[0]!.lines![0]).toMatchObject({ qty: 10, rate: 1500, size: "40 meter" })

    await c["receipt:create"]({ partyId: party, account: "Cash in hand", method: "Cash", amount: 3000, notes: "Installment", receivedBy: "Faraz" })
    await c["return:sale"]({ invoice: "INV-00001", quantities: { [blue]: 2 }, settlement: "balance" })
    await c["expense:create"]({ category: "Rent", amount: 500, account: "Cash in hand" })
    s = await c["snapshot:get"](undefined)
    expect(s.parties[0]!.balance).toBe(11000 - 3000 - 3000)
    expect(s.collections[0]).toMatchObject({ amount: 3000, notes: "Installment" })
    expect(s.returns[0]).toMatchObject({ type: "Sale return", original: "INV-00001", total: 3000 })
    expect((await P(c))[0]!.stock).toBe(12)
    expect(s.accounts["Cash in hand"]).toBe(106000 + 3000 - 500)
    expect(s.audits.some((a) => a.action === "Sale saved")).toBe(true)

    // a sale that has a return against it cannot also be cancelled (it would restore the goods twice)
    expect(await fail(() => c["sale:void"]({ id: "INV-00001", reason: "x" }))).toMatch(/has a return/)
    const second = await c["sale:create"]({ partyId: party, lines: [{ productId: blue, qty: 4 }], payments: [] })
    await c["sale:void"]({ id: second.id, reason: "customer cancelled" })
    s = await c["snapshot:get"](undefined)
    expect((await S(c))[0]!.status).toBe("void")
    expect((await P(c))[0]!.stock).toBe(12)
  })

  it("rejects bad input at the boundary with plain messages", async () => {
    const { c } = await app()
    const blue = (await c["product:save"]({ company: "X", article: "A", cost: 1, rate: 2 })).id
    const party = (await c["party:save"]({ kind: "customer", name: "P" })).id
    expect(await fail(() => c["sale:create"]({ partyId: party, lines: [{ productId: blue, qty: 1 }], payments: [] }))).toMatch(/Only 0 in stock/)
    expect(await fail(() => c["sale:create"]({ partyId: party, lines: [{ productId: blue, qty: 1.5 }], payments: [] }))).toMatch(/whole number/)
    expect(await fail(() => c["expense:create"]({ category: "Nope", amount: 1, account: "Cash in hand" }))).toMatch(/NOT_FOUND/)
    expect(await fail(() => c["settings:set"]({ key: "credit.limit_mode", value: "maybe" }))).toMatch(/not allowed/)
    expect(await fail(() => c["settings:set"]({ key: "evil.key", value: "x" }))).toMatch(/not allowed/)
    expect(await fail(() => c["party:save"]({ kind: "customer", name: "  " }))).toMatch(/required/)
    expect(await fail(() => c["product:save"]({ company: "X", article: "A", barcode: "111", cost: 1, rate: 2 }))).toBe("no error")
    expect(await fail(() => c["product:save"]({ company: "X", article: "B", barcode: "111", cost: 1, rate: 2 }))).toMatch(/already used/)
  })

  it("cosmetics: batches and expiry are tracked, and sales draw from the earliest expiry first", async () => {
    const { c, db } = await app("cosmetics")
    const sup = (await c["party:save"]({ kind: "supplier", name: "Beauty Wholesale" })).id
    const cust = (await c["party:save"]({ kind: "customer", name: "Walk shop" })).id
    const v = (await c["product:save"]({ company: "Lifebuoy", article: "Shampoo Anti-Dandruff", size: "180 ml", barcode: "8901234", cost: 200, rate: 300 })).id
    await c["purchase:create"]({ supplierId: sup, lines: [{ productId: v, qty: 10, rate: 200, batchNo: "B2", expiryDate: "2027-06-01" }], payments: [] })
    await c["purchase:create"]({ supplierId: sup, lines: [{ productId: v, qty: 5, rate: 200, batchNo: "B1", expiryDate: "2026-12-01" }], payments: [] })
    await c["sale:create"]({ partyId: cust, lines: [{ productId: v, qty: 7 }], payments: [] })
    const rows = db.prepare("SELECT b.batch_no, COALESCE(SUM(m.qty_delta),0) q FROM batches b LEFT JOIN stock_movements m ON m.batch_id=b.id GROUP BY b.id ORDER BY b.batch_no").all()
    expect(rows).toEqual([{ batch_no: "B1", q: 0 }, { batch_no: "B2", q: 8 }]) // B1 (earlier expiry) went first
    const s = await c["snapshot:get"](undefined)
    expect((await P(c))[0]).toMatchObject({ stock: 8, expiry: "2027-06-01", barcode: "8901234" })
    await c["sale:void"]({ id: "INV-00001", reason: "test" })
    const back = db.prepare("SELECT b.batch_no, COALESCE(SUM(m.qty_delta),0) q FROM batches b LEFT JOIN stock_movements m ON m.batch_id=b.id GROUP BY b.id ORDER BY b.batch_no").all()
    expect(back).toEqual([{ batch_no: "B1", q: 5 }, { batch_no: "B2", q: 10 }]) // restored to the same batches
  })
})

describe("statements and aging", () => {
  it("shows the real running ledger and ages unpaid charges oldest-first", async () => {
    const { c, db } = await app()
    const party = (await c["party:save"]({ kind: "customer", name: "Ali Traders" })).id
    const sup = (await c["party:save"]({ kind: "supplier", name: "ABC" })).id
    const v = (await c["product:save"]({ company: "F", article: "A", cost: 100, rate: 150 })).id
    await c["purchase:create"]({ supplierId: sup, lines: [{ productId: v, qty: 100, rate: 100 }], payments: [] })
    await c["sale:create"]({ partyId: party, lines: [{ productId: v, qty: 10 }], payments: [] }) // 1,500
    await c["sale:create"]({ partyId: party, lines: [{ productId: v, qty: 10 }], payments: [] }) // 1,500
    // make the first invoice 70 days old and the second 10 days old
    const day = 86_400_000
    db.prepare("UPDATE ledger_entries SET ts = ? WHERE source_type='sale' AND source_id = 1").run(new Date(Date.now() - 70 * day).toISOString())
    db.prepare("UPDATE ledger_entries SET ts = ? WHERE source_type='sale' AND source_id = 2").run(new Date(Date.now() - 10 * day).toISOString())
    await c["receipt:create"]({ partyId: party, account: "Cash in hand", method: "Cash", amount: 1000, date: undefined })
    const l = await c["ledger:get"]({ kind: "customer", id: party })
    expect(l.rows.map((r) => [r.description, r.debit, r.credit, r.balance])).toEqual([
      ["Sale INV-00001", 1500, 0, 1500],
      ["Sale INV-00002", 1500, 0, 3000],
      ["Payment RCT-00001", 0, 1000, 2000],
    ])
    expect(l.rows[0]!.ref).toBe("INV-00001")
    // the 1,000 payment clears part of the OLDEST invoice: 500 left at 61-90 days, 1,500 at 0-30 days
    expect(l.aging).toEqual([1500, 0, 500, 0])
    expect(l.aging.reduce((s, x) => s + x, 0)).toBe(2000)
  })
})

describe("what the sales screen charges", () => {
  it("shows the same default price the engine charges, so an ordinary salesperson is never blocked", async () => {
    const { c, db, session } = await app()
    const party = (await c["party:save"]({ kind: "customer", name: "P" })).id
    const sup = (await c["party:save"]({ kind: "supplier", name: "S" })).id
    const v = (await c["product:save"]({ company: "F", article: "A", cost: 1000, rate: 1500, wholesale: 1400 })).id
    await c["purchase:create"]({ supplierId: sup, lines: [{ productId: v, qty: 5, rate: 1000 }], payments: [] })
    const p = (await P(c))[0]!
    expect(p).toMatchObject({ rate: 1500, wholesale: 1400, price: 1400 }) // wholesale feature is on for cloth
    await c["user:create"]({ name: "Sam", username: "sam", password: "abcdef", role: "Sales User" })
    session.logout(db)
    session.login(db, "sam", "abcdef")
    const sale = await c["sale:create"]({ partyId: party, lines: [{ productId: v, qty: 1, rate: p.price }], payments: [] })
    expect(sale.id).toBe("INV-00001")
    expect(await fail(() => c["sale:create"]({ partyId: party, lines: [{ productId: v, qty: 1, rate: 1 }], payments: [] }))).toMatch(/price_override/)
  })
})

describe("amounts have at most two decimals", () => {
  it("refuses 1.005 instead of silently rounding it, and accepts ordinary floating-point sums", async () => {
    const { c } = await app()
    const id = (await c["product:save"]({ company: "X", article: "A", cost: 1, rate: 2, openingQty: 5 })).id
    const party = (await c["party:save"]({ kind: "customer", name: "P" })).id
    await expect(async () => await c["sale:create"]({ partyId: party, lines: [{ productId: id, qty: 1, rate: 1.005 }], payments: [] })).rejects.toThrow(/at most 2 decimal/)
    // 0.1 + 0.2 = 0.30000000000000004 is still thirty paisa
    const ok = await c["sale:create"]({ partyId: party, lines: [{ productId: id, qty: 1, rate: 0.1 + 0.2 }], payments: [] })
    expect(ok.id).toMatch(/INV-/)
  })
})
