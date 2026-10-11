import { describe, expect, it } from "vitest"
import { ensureBusinessName, getBusiness, setBusiness } from "../src/main/services/business"
import { setup } from "./helpers"

const full = (o: Record<string, string> = {}) => ({ name: "Faraz Cloth House", tagline: "Wholesale cloth", owner: "Faraz", phone: "0300", email: "", address: "Market road", city: "Ghotki", logo: "", invoiceFooter: "Thanks", ...o })

describe("dynamic business settings", () => {
  it("stores shop identity in the database so one installer serves any client", async () => {
    const c = await setup()
    expect(getBusiness(c.db).name).toBe("")
    ensureBusinessName(c.db, "Licensed Client")
    expect(getBusiness(c.db).name).toBe("Licensed Client")
    ensureBusinessName(c.db, "Other") // never overwrites the owner's choice
    expect(getBusiness(c.db).name).toBe("Licensed Client")
    const saved = setBusiness(c.db, c.ownerId, full())
    expect(saved).toMatchObject({ name: "Faraz Cloth House", city: "Ghotki", invoiceFooter: "Thanks" })
    expect(c.db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='business.update'").get()).toEqual({ c: 1 })
  })
  it("validates input: name required, logo must be a small real image data URL", async () => {
    const c = await setup()
    expect(() => setBusiness(c.db, null, full({ name: "   " }))).toThrow(/required/)
    expect(() => setBusiness(c.db, null, full({ logo: "javascript:alert(1)" }))).toThrow(/PNG, JPG, WebP or SVG/)
    expect(() => setBusiness(c.db, null, full({ logo: "https://evil.example/x.png" }))).toThrow()
    expect(() => setBusiness(c.db, null, full({ logo: "data:image/png;base64," + "A".repeat(500_000) }))).toThrow(/too large/)
    expect(setBusiness(c.db, null, full({ logo: "data:image/png;base64,iVBORw0KGgo=" })).logo).toMatch(/^data:image\/png/)
    expect(setBusiness(c.db, null, full({ logo: "" })).logo).toBe("")
  })
})
