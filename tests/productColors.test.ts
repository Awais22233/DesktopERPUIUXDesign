import { describe, expect, it } from "vitest"
import { saveProduct, saveProductColors } from "../src/main/services/catalog"
import { listProducts } from "../src/main/services/lists"
import { setup } from "./helpers"

const base = { company: "Gul Ahmed", article: "Lawn 101", size: "40 meter", purchasePrice: 100_000, salePrice: 150_000, minStock: 2 }

describe("one article in several colours", () => {
  it("creates one product per colour with the shared details and each colour's opening stock", async () => {
    const { db, owner } = await setup()
    const r = saveProductColors(db, owner, { ...base, colors: [{ color: "Blue", openingQty: 10 }, { color: "Black" }, { color: "Maroon", openingQty: 4 }] })
    expect(r.created).toHaveLength(3)
    expect(r.skipped).toEqual([])
    const rows = listProducts(db, { query: "Lawn 101" }).rows
    expect(rows.map((p) => p.color).sort()).toEqual(["Black", "Blue", "Maroon"])
    expect(rows.every((p) => p.company === "Gul Ahmed" && p.size === "40 meter" && p.rate === 1500 && p.cost >= 0)).toBe(true)
    expect(Object.fromEntries(rows.map((p) => [p.color, p.stock]))).toEqual({ Blue: 10, Black: 0, Maroon: 4 })
    // one shared article, not three
    expect((db.prepare("SELECT COUNT(*) n FROM items WHERE name = 'Lawn 101'").get() as { n: number }).n).toBe(1)
  })

  it("skips a colour that already exists (any letter case) and reports it, without touching its stock", async () => {
    const { db, owner } = await setup()
    saveProduct(db, owner, { ...base, color: "Blue", openingQty: 7, openingCost: 100_000 })
    const r = saveProductColors(db, owner, { ...base, colors: [{ color: "blue", openingQty: 99 }, { color: "Green", openingQty: 1 }] })
    expect(r.skipped).toEqual(["blue"])
    expect(r.created).toHaveLength(1)
    const stock = Object.fromEntries(listProducts(db, { query: "Lawn 101" }).rows.map((p) => [p.color, p.stock]))
    expect(stock).toEqual({ Blue: 7, Green: 1 })
  })

  it("the same colour in a different size is a different product", async () => {
    const { db, owner } = await setup()
    saveProduct(db, owner, { ...base, color: "Blue" })
    const r = saveProductColors(db, owner, { ...base, size: "20 meter", colors: [{ color: "Blue" }] })
    expect(r.created).toHaveLength(1)
  })

  it("is all-or-nothing, and refuses empty, duplicated, negative or unauthorised input", async () => {
    const { db, owner, limited } = await setup()
    expect(() => saveProductColors(db, owner, { ...base, colors: [] })).toThrow(/at least one/)
    expect(() => saveProductColors(db, owner, { ...base, colors: [{ color: "Red" }, { color: " red " }] })).toThrow(/twice/)
    expect(() => saveProductColors(db, owner, { ...base, colors: [{ color: "  " }] })).toThrow(/empty/)
    expect(() => saveProductColors(db, owner, { ...base, colors: [{ color: "Red", openingQty: -1 }] })).toThrow(/whole number/)
    expect(() => saveProductColors(db, limited, { ...base, colors: [{ color: "Red" }] })).toThrow()
    // a failure in the middle (negative price is rejected by the product rules) leaves nothing behind
    expect(() => saveProductColors(db, owner, { ...base, purchasePrice: -5, colors: [{ color: "Red" }, { color: "Tan" }] })).toThrow()
    expect(listProducts(db, { query: "Lawn 101" }).total).toBe(0)
    expect((db.prepare("SELECT COUNT(*) n FROM items WHERE name = 'Lawn 101'").get() as { n: number }).n).toBe(0)
  })

  it("a different design is a different product; inner spaces are tidied; a huge opening stock is refused politely", async () => {
    const { db, owner } = await setup()
    saveProduct(db, owner, { ...base, color: "Blue", design: "Floral" })
    expect(saveProductColors(db, owner, { ...base, design: "Stripes", colors: [{ color: "Blue" }] }).created).toHaveLength(1)
    expect(saveProductColors(db, owner, { ...base, design: "Floral", colors: [{ color: "Blue" }] }).skipped).toEqual(["Blue"])
    saveProductColors(db, owner, { ...base, colors: [{ color: "Sky   Blue" }] })
    expect(saveProductColors(db, owner, { ...base, colors: [{ color: "Sky Blue" }] }).skipped).toEqual(["Sky Blue"])
    expect(() => saveProductColors(db, owner, { ...base, colors: [{ color: "Tan", openingQty: 1e12 }] })).toThrow(/up to 1,000,000/)
  })
})
