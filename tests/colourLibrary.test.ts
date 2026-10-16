import { describe, expect, it } from "vitest"
import { saveProduct, saveProductColors } from "../src/main/services/catalog"
import { deleteColour, ensureColour, listColours, saveColour } from "../src/main/services/colours"
import { listProducts } from "../src/main/services/lists"
import { colourShade } from "../src/shared/colours"
import { setup } from "./helpers"

const base = { company: "Fraz", article: "FR-101", size: "than", purchasePrice: 100_000, salePrice: 150_000 }

describe("colour library", () => {
  it("a new colour typed on a product joins the library, and later spellings reuse the library spelling", async () => {
    const { db, owner } = await setup()
    saveProduct(db, owner, { ...base, color: "  Navy   Blue " })
    saveProduct(db, owner, { ...base, article: "FR-102", color: "navy blue" })
    saveProduct(db, owner, { ...base, article: "FR-103", color: "NAVY BLUE" })
    expect(listColours(db).filter((c) => c.name.toLowerCase() === "navy blue").map((c) => c.name)).toEqual(["Navy Blue"])
    const colours = listProducts(db, { query: "FR-10" }).rows.map((p) => p.color)
    expect(colours).toEqual(["Navy Blue", "Navy Blue", "Navy Blue"])
  })

  it("the several-colours form also uses the library spelling and fills the library", async () => {
    const { db, owner } = await setup()
    saveColour(db, owner, { name: "Bottle Green", hex: "#14452F" })
    saveProductColors(db, owner, { ...base, colors: [{ color: "bottle green" }, { color: "Maroon" }] })
    const rows = listProducts(db, { query: "FR-101" }).rows.map((p) => p.color).sort()
    expect(rows).toEqual(["Bottle Green", "Maroon"])
    const lib = Object.fromEntries(listColours(db).map((c) => [c.name, c]))
    expect(lib["Bottle Green"]).toMatchObject({ hex: "#14452f", uses: 1 })
    expect(lib["Maroon"]).toMatchObject({ hex: null, uses: 1 })
  })

  it("adds, edits the shade, refuses duplicates and bad shades", async () => {
    const { db, owner } = await setup()
    const id = saveColour(db, owner, { name: "Ferozi" })
    expect(() => saveColour(db, owner, { name: "ferozi" })).toThrow(/already exists/)
    expect(() => saveColour(db, owner, { name: "Pista", hex: "green" })).toThrow(/shade/)
    expect(() => saveColour(db, owner, { name: "   " })).toThrow(/required/)
    saveColour(db, owner, { id, name: "Ferozi", hex: "#1FB5B0" })
    expect(listColours(db).find((c) => c.id === id)?.hex).toBe("#1fb5b0")
    saveColour(db, owner, { id, name: "Ferozi", hex: "" })
    expect(listColours(db).find((c) => c.id === id)?.hex).toBeNull()
  })

  it("renaming a colour renames it on every product that uses it, and never merges into another colour", async () => {
    const { db, owner } = await setup()
    saveProduct(db, owner, { ...base, color: "Navi Blue" })
    saveProduct(db, owner, { ...base, article: "FR-102", color: "navi blue" })
    saveProduct(db, owner, { ...base, article: "FR-103", color: "Black" })
    const id = listColours(db).find((c) => c.name === "Navi Blue")!.id
    saveColour(db, owner, { id, name: "Navy Blue" })
    expect(listProducts(db, { query: "FR-10" }).rows.map((p) => p.color).sort()).toEqual(["Black", "Navy Blue", "Navy Blue"])
    const black = listColours(db).find((c) => c.name === "Black")!.id
    expect(() => saveColour(db, owner, { id: black, name: "navy blue" })).toThrow(/already exists/)
    expect(listProducts(db, { query: "FR-103" }).rows[0].color).toBe("Black")
  })

  it("removes only a colour no product uses", async () => {
    const { db, owner } = await setup()
    saveProduct(db, owner, { ...base, color: "Red" })
    const unused = saveColour(db, owner, { name: "Pista" })
    const red = listColours(db).find((c) => c.name === "Red")!.id
    expect(() => deleteColour(db, owner, red)).toThrow(/used by 1 product/)
    deleteColour(db, owner, unused)
    expect(listColours(db).some((c) => c.name === "Pista")).toBe(false)
    expect(() => deleteColour(db, owner, unused)).toThrow(/not found/)
  })

  it("needs the catalog permission and rejects a very long name", async () => {
    const { db, owner, limited } = await setup()
    expect(() => saveColour(db, limited, { name: "Blue" })).toThrow()
    expect(() => ensureColour(db, "x".repeat(61))).toThrow(/too long/)
    expect(ensureColour(db, "  ")).toBeNull()
    expect(() => saveColour(db, owner, { name: "x".repeat(61) })).toThrow(/too long/)
  })

  it("swatch shade: the library shade wins, then the common name, else none", () => {
    expect(colourShade("Navy Blue", "#123456")).toBe("#123456")
    expect(colourShade("  navy   blue ")).toBeDefined()
    expect(colourShade("Dusty Black")).toBeDefined()
    expect(colourShade("Zzz")).toBeUndefined()
  })
})
