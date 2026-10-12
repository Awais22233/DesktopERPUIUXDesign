import { describe, expect, it } from "vitest"
import { openDatabase } from "../src/main/db/connection"
import { migrate } from "../src/main/db/migrate"
import { migrations } from "../src/main/db/migrations"
import { seedRoles } from "../src/main/services/auth"
import { ensureConfig } from "../src/main/services/config"
import { setBusiness } from "../src/main/services/business"
import { buildDashboard } from "../src/main/services/dashboard"
import { setup } from "./helpers"

async function bare() {
  const db = openDatabase(":memory:")
  await migrate(db, migrations)
  seedRoles(db)
  ensureConfig(db, "cloth")
  return db
}

describe("getting-started progress on the dashboard", () => {
  it("a brand-new installation has nothing done", async () => {
    const db = await bare()
    expect(buildDashboard(db, "2026-10-13").setup).toEqual({ shopDetails: false, money: false, parties: false, products: false, firstSale: false })
  })

  it("shop details count once an address, city or phone is saved", async () => {
    const db = await bare()
    setBusiness(db, null, { name: "Faraz Cloth House", tagline: "", owner: "", phone: "", email: "", address: "", city: "", logo: "", invoiceFooter: "", accent: "navy" })
    expect(buildDashboard(db, "2026-10-13").setup.shopDetails).toBe(false) // a name alone is not enough
    setBusiness(db, null, { name: "Faraz Cloth House", tagline: "", owner: "", phone: "0300", email: "", address: "", city: "", logo: "", invoiceFooter: "", accent: "navy" })
    expect(buildDashboard(db, "2026-10-13").setup.shopDetails).toBe(true)
  })

  it("parties, products, money and the first sale tick off as real records appear", async () => {
    const c = await setup()
    const s = buildDashboard(c.db, "2026-10-13").setup
    expect(s).toMatchObject({ money: true, parties: true, products: true })
    expect(s.firstSale).toBe(false)
  })
})
