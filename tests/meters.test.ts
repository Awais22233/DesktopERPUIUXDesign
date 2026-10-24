import { beforeEach, describe, expect, it } from "vitest"
import { AppError } from "../src/core/errors"
import { postPurchase } from "../src/main/services/purchases"
import { postSale, voidSale } from "../src/main/services/sales"
import { variantForLength, toTenths, fmtMeters } from "../src/main/services/meters"
import { listDocs, listProducts } from "../src/main/services/lists"
import { customerBalance, stockReconcile, supplierBalance } from "../src/main/services/queries"
import { setup, type Ctx } from "./helpers"

const codeOf = (fn: () => unknown) => {
  try {
    fn()
  } catch (e) {
    return e instanceof AppError ? `${e.code}: ${e.message}` : `non-app:${(e as Error).message}`
  }
  return "no error"
}
const stockOf = (c: Ctx, id: number) => (c.db.prepare("SELECT COALESCE(qty,0) q FROM stock_levels WHERE variant_id=?").get(id) as { q: number } | undefined)?.q ?? 0
const buy = (c: Ctx, lengthMeters: number, qty: number, rate: number, variantId = c.blue) =>
  postPurchase(c.db, c.owner, { supplierId: c.supplier, lines: [{ variantId, qty, rate, lengthMeters }], payments: [] })

let c: Ctx
beforeEach(async () => {
  c = await setup()
})

describe("lengths", () => {
  it("accepts one decimal and refuses more", () => {
    expect(toTenths(44.5)).toBe(445)
    expect(toTenths(20)).toBe(200)
    expect(fmtMeters(445)).toBe("44.5")
    expect(fmtMeters(200)).toBe("20")
    expect(codeOf(() => toTenths(44.55))).toContain("one decimal")
    expect(codeOf(() => toTenths(0))).toContain("between")
  })
  it("the first length goes on the product itself; other lengths become siblings of the same product", () => {
    const first = variantForLength(c.db, c.blue, 200)
    expect(first).toBe(c.blue) // the empty variant takes the length
    const second = variantForLength(c.db, c.blue, 400)
    expect(second).not.toBe(c.blue)
    expect(variantForLength(c.db, c.blue, 400)).toBe(second) // asked again: the same one
    expect(variantForLength(c.db, second, 200)).toBe(c.blue)
    const sibs = c.db.prepare("SELECT color, size_label FROM variants WHERE item_id = (SELECT item_id FROM variants WHERE id = ?)").all(c.blue) as { color: string; size_label: string }[]
    expect(sibs.filter((x) => x.color === "Blue").map((x) => x.size_label).sort()).toEqual(["20 meter", "40 meter"])
  })
})

describe("buying and selling by the meter", () => {
  it("purchase: than x length x rate per meter, one product, two lengths", () => {
    const a = buy(c, 20, 9, 12_555) // 9 thans of 20 m at 125.55 per meter
    expect(a.total).toBe(2_259_900) // 22,599.00
    buy(c, 40, 5, 12_000)
    const lens = listProducts(c.db, { query: "Blue" }).rows.filter((p) => p.color === "Blue")
    expect(lens.map((p) => [p.length, p.stock]).sort()).toEqual([[20, 9], [40, 5]])
    expect(supplierBalance(c.db, c.supplier)).toBe(2_259_900 + 5 * 480_000)
    expect(stockReconcile(c.db)).toEqual([])
  })
  it("sale: Gul Ahmed buys 9 x 20 m and 5 x 40 m; the bill is in meters and remembers the lengths", () => {
    buy(c, 20, 10, 10_000)
    buy(c, 40, 10, 10_000)
    const v20 = variantForLength(c.db, c.blue, 200)
    const v40 = variantForLength(c.db, c.blue, 400)
    const s = postSale(c.db, c.owner, { partyId: c.party, lines: [{ variantId: v20, qty: 9, rate: 15_000 }, { variantId: v40, qty: 5, rate: 14_000 }], payments: [] })
    // 9 x 20 m x 150.00 = 27,000.00 ; 5 x 40 m x 140.00 = 28,000.00
    expect(s.total).toBe(2_700_000 + 2_800_000)
    expect(customerBalance(c.db, c.party)).toBe(5_500_000)
    expect(stockOf(c, v20)).toBe(1)
    expect(stockOf(c, v40)).toBe(5)
    const bill = listDocs(c.db, { kind: "sale", no: s.invoiceNo, pageSize: 1 }).rows[0]
    expect(bill.lines?.map((l) => [l.qty, l.length, l.rateM])).toEqual([[9, 20, 150], [5, 40, 140]])
    expect(stockReconcile(c.db)).toEqual([])
  })
  it("decimal lengths: the than price is rounded to the paisa", () => {
    buy(c, 44.5, 4, 12_555)
    const v = variantForLength(c.db, c.blue, 445)
    const s = postSale(c.db, c.owner, { partyId: c.party, lines: [{ variantId: v, qty: 2, rate: 12_555 }], payments: [] })
    expect(s.total).toBe(2 * 558_698) // 12555 x 44.5 = 558,697.5 paisa -> 558,698
  })
  it("a rate is still required on every line, and a different rate needs the override permission when the product has a price", () => {
    buy(c, 20, 3, 10_000)
    const v = variantForLength(c.db, c.blue, 200)
    expect(codeOf(() => postSale(c.db, c.owner, { partyId: c.party, lines: [{ variantId: v, qty: 1, rate: 0 }], payments: [] }))).toContain("Enter the rate")
    c.db.prepare("UPDATE variants SET sale_price = 0 WHERE id = ?").run(v)
    const ok = postSale(c.db, c.limited, { partyId: c.party, lines: [{ variantId: v, qty: 1, rate: 12_300 }], payments: [] })
    expect(ok.total).toBe(246_000)
  })
  it("variants without a length still work per than, exactly as before", () => {
    postPurchase(c.db, c.owner, { supplierId: c.supplier, lines: [{ variantId: c.black, qty: 5, rate: 100_000 }], payments: [] })
    const s = postSale(c.db, c.owner, { partyId: c.party, lines: [{ variantId: c.black, qty: 2, rate: 150_000 }], payments: [] })
    expect(s.total).toBe(300_000)
  })
  it("cancelling a meter sale puts the thans back", () => {
    buy(c, 20, 4, 10_000)
    const v = variantForLength(c.db, c.blue, 200)
    const s = postSale(c.db, c.owner, { partyId: c.party, lines: [{ variantId: v, qty: 3, rate: 15_000 }], payments: [] })
    expect(stockOf(c, v)).toBe(1)
    expect(s.total).toBe(3 * 300_000)
    voidSale(c.db, c.owner, s.saleId, "mistake")
    expect(stockOf(c, v)).toBe(4)
    expect(customerBalance(c.db, c.party)).toBe(0)
    expect(stockReconcile(c.db)).toEqual([])
  })
})

describe("a product with several lengths in one go", () => {
  it("creates one product, a variant per length with its thans, and refuses a repeated length", async () => {
    const { saveProduct } = await import("../src/main/services/catalog")
    const id = saveProduct(c.db, c.owner, { company: "Gul Ahmed", article: "Cotton", color: "Grey", purchasePrice: 10_000, salePrice: 0, lengths: [{ length: 28, qty: 5 }, { length: 22, qty: 4 }, { length: 44.5, qty: 2 }] })
    const rows = listProducts(c.db, { query: "Cotton" }).rows
    expect(rows.map((p) => [p.length, p.stock]).sort((a, b) => a[0]! - b[0]!)).toEqual([[22, 4], [28, 5], [44.5, 2]])
    expect(rows.some((p) => p.id.endsWith(String(id).padStart(4, "0")))).toBe(true)
    expect(stockReconcile(c.db)).toEqual([])
    expect(codeOf(() => saveProduct(c.db, c.owner, { company: "Gul Ahmed", article: "Cotton", color: "Red", purchasePrice: 0, salePrice: 0, lengths: [{ length: 28 }, { length: 28.0 }] }))).toContain("twice")
  })
})

describe("purchase bill number", () => {
  it("can be changed, stays unique, and the automatic number skips a typed one", async () => {
    const { renumberPurchase } = await import("../src/main/services/purchases")
    const a = buy(c, 20, 1, 10_000)
    expect(renumberPurchase(c.db, c.owner, a.purchaseId, "P-501")).toBe("P-501")
    const b = buy(c, 20, 1, 10_000)
    expect(codeOf(() => renumberPurchase(c.db, c.owner, b.purchaseId, "p-501"))).toContain("already used")
    renumberPurchase(c.db, c.owner, b.purchaseId, "PUR-00003")
    expect(buy(c, 20, 1, 10_000).purchaseNo).toBe("PUR-00004") // PUR-00003 is taken by b
  })
})
