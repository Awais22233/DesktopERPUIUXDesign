import { describe, expect, it } from "vitest"
import { listDocs, listMovements, listProducts, inventorySummary } from "../src/main/services/lists"
import { postPurchase } from "../src/main/services/purchases"
import { postSale, voidSale } from "../src/main/services/sales"
import { createItem, createVariant } from "../src/main/services/masterData"
import { setup } from "./helpers"

describe("paged, searchable lists", () => {
  it("search matches several words across name, colour, company, size, barcode and sku; a scanned barcode comes first", async () => {
    const c = await setup()
    const a = createVariant(c.db, { itemId: c.item, color: "Maroon", sizeLabel: "30 meter", purchasePrice: 1, salePrice: 2, barcode: "8901234", sku: "SKU-9" })
    const other = createItem(c.db, { companyId: c.company, name: "Lawn Print" })
    createVariant(c.db, { itemId: other, color: "Green", sizeLabel: "20 meter", purchasePrice: 1, salePrice: 2, barcode: "55555" })
    expect(listProducts(c.db, { query: "article maroon" }).rows.map((p) => p.color)).toEqual(["Maroon"])
    expect(listProducts(c.db, { query: "faraz green" }).rows.map((p) => p.color)).toEqual(["Green"])
    expect(listProducts(c.db, { query: "8901234" }).rows[0]!.id).toBe(`VAR-${String(a).padStart(4, "0")}`)
    expect(listProducts(c.db, { query: "sku-9" }).total).toBe(1)
    expect(listProducts(c.db, { query: "100%" }).total).toBe(0) // % is not a wildcard
    expect(listProducts(c.db, { query: "nothing like this" }).rows).toEqual([])
    expect(listProducts(c.db, { ids: [`VAR-${a}`] }).rows).toHaveLength(1)
  })

  it("pages are stable and complete; status filters and the summary add up", async () => {
    const c = await setup()
    for (let i = 0; i < 130; i++) createVariant(c.db, { itemId: c.item, color: `P${String(i).padStart(3, "0")}`, sizeLabel: "x", purchasePrice: 100, salePrice: 200, minStock: 5 })
    const low = createVariant(c.db, { itemId: c.item, color: "Lowish", sizeLabel: "x", purchasePrice: 100, salePrice: 200, minStock: 5 })
    postPurchase(c.db, c.owner, { supplierId: c.supplier, lines: [{ variantId: low, qty: 3, rate: 100_000 }, { variantId: c.black, qty: 50, rate: 100_000 }], payments: [] })
    const seen = new Set<string>()
    let pages = 0
    for (let p = 1; ; p++) {
      const page = listProducts(c.db, { page: p, pageSize: 40 })
      page.rows.forEach((r) => seen.add(r.id))
      pages++
      if (page.rows.length < 40) break
    }
    expect(seen.size).toBe(133)
    expect(pages).toBe(4)
    expect(listProducts(c.db, { status: "low" }).rows.map((r) => r.color)).toEqual(["Lowish"])
    expect(listProducts(c.db, { status: "in" }).total).toBe(1)
    expect(listProducts(c.db, { status: "out" }).total).toBe(131)
    expect(inventorySummary(c.db)).toMatchObject({ items: 133, units: 53, value: 53 * 1000, low: 1, out: 131, reorder: 132 })
  })

  it("document lists search by number/party, filter by status, and report totals that exclude cancelled documents", async () => {
    const c = await setup()
    postPurchase(c.db, c.owner, { supplierId: c.supplier, lines: [{ variantId: c.blue, qty: 20, rate: 100_000 }], payments: [] })
    const s1 = postSale(c.db, c.owner, { partyId: c.party, lines: [{ variantId: c.blue, qty: 2 }], payments: [] })
    postSale(c.db, c.owner, { partyId: c.walkIn, lines: [{ variantId: c.blue, qty: 1 }], payments: [{ accountId: c.cash, method: "Cash", amount: 150_000 }] })
    voidSale(c.db, c.owner, s1.saleId, "test")
    const all = listDocs(c.db, { kind: "sale" })
    expect(all.rows.map((r) => r.id)).toEqual(["INV-00002", "INV-00001"])
    expect(all.summary).toEqual({ count: 2, total: 1500, paid: 1500 })
    expect(listDocs(c.db, { kind: "sale", status: "void" }).rows.map((r) => r.status)).toEqual(["void"])
    expect(listDocs(c.db, { kind: "sale", query: "ali" }).rows.map((r) => r.id)).toEqual(["INV-00001"])
    expect(listDocs(c.db, { kind: "sale", no: "INV-00002" }).rows[0]!.lines![0]).toMatchObject({ qty: 1, name: "Article A Blue" })
    expect(listDocs(c.db, { kind: "purchase", query: "abc" }).total).toBe(1)
    expect(listDocs(c.db, { kind: "sale", query: "%" }).total).toBe(0)
  })

  it("movement history pages per product", async () => {
    const c = await setup()
    postPurchase(c.db, c.owner, { supplierId: c.supplier, lines: [{ variantId: c.blue, qty: 20, rate: 100_000 }], payments: [] })
    for (let i = 0; i < 7; i++) postSale(c.db, c.owner, { partyId: c.walkIn, lines: [{ variantId: c.blue, qty: 1 }], payments: [{ accountId: c.cash, method: "Cash", amount: 150_000 }] })
    const first = listMovements(c.db, { productId: `VAR-${c.blue}`, pageSize: 5 })
    expect(first.total).toBe(8)
    expect(first.rows).toHaveLength(5)
    expect(listMovements(c.db, { productId: `VAR-${c.blue}`, pageSize: 5, page: 2 }).rows).toHaveLength(3)
    expect(listMovements(c.db, { productId: `VAR-${c.black}` }).total).toBe(0)
  })
})
