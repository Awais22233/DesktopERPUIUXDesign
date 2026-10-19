import { describe, expect, it } from "vitest"
import { postPurchase } from "../src/main/services/purchases"
import { listProducts } from "../src/main/services/lists"
import { money } from "../src/renderer/src/data"
import { setup } from "./helpers"

describe("purchase price shown to the user", () => {
  it("a new purchase starts from the latest supplier price, not from the average cost", async () => {
    const c = await setup()
    postPurchase(c.db, c.owner, { supplierId: c.supplier, lines: [{ variantId: c.blue, qty: 7, rate: 100_001 }], payments: [] })
    postPurchase(c.db, c.owner, { supplierId: c.supplier, lines: [{ variantId: c.blue, qty: 13, rate: 120_007 }], payments: [] })
    const p = listProducts(c.db, { query: "Blue" }).rows.find((x) => x.color === "Blue")!
    expect(p.purchasePrice).toBe(1200.07) // what the supplier charged last
    expect(p.cost).not.toBe(p.purchasePrice) // the average cost is a different, weighted number
  })
})

describe("money on screen", () => {
  it("shows whole rupees plainly and paisa exactly, never rounded away", () => {
    expect(money(96804.5)).toBe("Rs. 96,804.50")
    expect(money(2498.25)).toBe("Rs. 2,498.25")
    expect(money(1500)).toBe("Rs. 1,500")
    expect(money(0)).toBe("Rs. 0")
    expect(money(-3200.5)).toBe("Rs. -3,200.50")
    expect(money(0.1 + 0.2)).toBe("Rs. 0.30")
  })
})

describe("money on screen, zero", () => {
  it("never shows a negative zero", () => {
    expect(money(-0)).toBe("Rs. 0")
    expect(money(-0.001)).toBe("Rs. 0")
    expect(money(0.004)).toBe("Rs. 0")
  })
})
