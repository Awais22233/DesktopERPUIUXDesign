import { describe, expect, it } from "vitest"
import { listDocs } from "../src/main/services/lists"
import { recordReceipt } from "../src/main/services/payments"
import { postPurchase } from "../src/main/services/purchases"
import { postSale, voidSale } from "../src/main/services/sales"
import { postOpeningPartyBalance } from "../src/main/services/payments"
import { buildSnapshot } from "../src/main/services/snapshot"
import { setup } from "./helpers"

const stock = (c: Awaited<ReturnType<typeof setup>>) => postPurchase(c.db, c.owner, { supplierId: c.supplier, lines: [{ variantId: c.blue, qty: 100, rate: 100_000 }], payments: [{ accountId: c.cash, method: "Cash", amount: 10_000_000 }] })
const doc = (c: Awaited<ReturnType<typeof setup>>, kind: "sale" | "purchase", no: string) => listDocs(c.db, { kind, no }).rows[0]!

describe("balance printed on every bill", () => {
  it("each sale shows what the party owed before it and after it, and keeps showing it later", async () => {
    const c = await setup()
    stock(c)
    postOpeningPartyBalance(c.db, c.owner, { kind: "customer", partyId: c.party, amount: 1_000_000 }) // Rs. 10,000 owed
    const first = postSale(c.db, c.owner, { partyId: c.party, lines: [{ variantId: c.blue, qty: 2, rate: 150_000 }], payments: [{ accountId: c.cash, method: "Cash", amount: 100_000 }] }) // bill 3,000, pays 1,000
    expect(doc(c, "sale", first.invoiceNo)).toMatchObject({ balanceBefore: 10_000, balanceAfter: 12_000, walkIn: false })
    const second = postSale(c.db, c.owner, { partyId: c.party, lines: [{ variantId: c.blue, qty: 1, rate: 150_000 }], payments: [] })
    expect(doc(c, "sale", second.invoiceNo)).toMatchObject({ balanceBefore: 12_000, balanceAfter: 13_500 })
    // the first bill is unchanged by what happened afterwards
    expect(doc(c, "sale", first.invoiceNo)).toMatchObject({ balanceBefore: 10_000, balanceAfter: 12_000 })
    voidSale(c.db, c.owner, second.saleId, "mistake")
    expect(doc(c, "sale", second.invoiceNo)).toMatchObject({ balanceBefore: 12_000, balanceAfter: 13_500 })
  })

  it("a payment receipt shows the balance before and after the payment", async () => {
    const c = await setup()
    postOpeningPartyBalance(c.db, c.owner, { kind: "customer", partyId: c.party, amount: 2_000_000 })
    const rc = recordReceipt(c.db, c.owner, { partyId: c.party, accountId: c.cash, method: "Cash", amount: 500_000 })
    const later = recordReceipt(c.db, c.owner, { partyId: c.party, accountId: c.cash, method: "Cash", amount: 300_000 })
    const rows = buildSnapshot(c.db).collections
    expect(rows.find((x) => x.id === rc.docNo)).toMatchObject({ balanceBefore: 20_000, balanceAfter: 15_000 })
    expect(rows.find((x) => x.id === later.docNo)).toMatchObject({ balanceBefore: 15_000, balanceAfter: 12_000 })
  })

  it("a purchase shows what we owed the supplier before and after; a party who paid in advance shows a negative balance", async () => {
    const c = await setup()
    const p = postPurchase(c.db, c.owner, { supplierId: c.supplier, lines: [{ variantId: c.blue, qty: 10, rate: 100_000 }], payments: [{ accountId: c.cash, method: "Cash", amount: 400_000 }] })
    expect(doc(c, "purchase", p.purchaseNo)).toMatchObject({ balanceBefore: 0, balanceAfter: 6_000 })
    stock(c)
    postOpeningPartyBalance(c.db, c.owner, { kind: "customer", partyId: c.party, amount: -100_000 }) // Rs. 1,000 paid in advance
    const s = postSale(c.db, c.owner, { partyId: c.party, lines: [{ variantId: c.blue, qty: 1, rate: 150_000 }], payments: [] })
    expect(doc(c, "sale", s.invoiceNo)).toMatchObject({ balanceBefore: -1_000, balanceAfter: 500 })
  })

  it("a walk-in sale carries no balance", async () => {
    const c = await setup()
    stock(c)
    const s = postSale(c.db, c.owner, { partyId: c.walkIn, lines: [{ variantId: c.blue, qty: 1, rate: 150_000 }], payments: [{ accountId: c.cash, method: "Cash", amount: 150_000 }] })
    const d = doc(c, "sale", s.invoiceNo)
    expect(d.walkIn).toBe(true)
    expect(d.balanceBefore).toBeUndefined()
  })

  it("a backdated bill agrees with the party statement (ordered by date, then entry number)", async () => {
    const c = await setup()
    stock(c)
    const today = postSale(c.db, c.owner, { partyId: c.party, lines: [{ variantId: c.blue, qty: 2, rate: 150_000 }], payments: [] }) // 3,000 today
    const earlier = postSale(c.db, c.owner, { partyId: c.party, lines: [{ variantId: c.blue, qty: 1, rate: 150_000 }], payments: [], ts: new Date(Date.now() - 3 * 86400_000).toISOString() }) // 1,500 three days ago, entered later
    expect(doc(c, "sale", earlier.invoiceNo)).toMatchObject({ balanceBefore: 0, balanceAfter: 1_500 })
    expect(doc(c, "sale", today.invoiceNo)).toMatchObject({ balanceBefore: 1_500, balanceAfter: 4_500 })
  })

  it("stays fast for a party with thousands of entries", async () => {
    const c = await setup()
    stock(c)
    const ins = c.db.prepare("INSERT INTO ledger_entries(ts, party_kind, party_id, credit, kind, source_type, source_id, description) VALUES (?, 'customer', ?, 100, 'receipt', 'payment', ?, 'x')")
    c.db.transaction(() => {
      for (let i = 1; i <= 6000; i++) ins.run(new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(), c.party, 1_000_000 + i)
    })()
    const t = Date.now()
    buildSnapshot(c.db)
    listDocs(c.db, { kind: "sale", pageSize: 25 })
    expect(Date.now() - t).toBeLessThan(1500)
  })
})
