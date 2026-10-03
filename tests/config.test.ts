import { describe, expect, it } from "vitest"
import { AppError } from "../src/core/errors"
import { featureInUse, getConfig, setFlag, setProfile } from "../src/main/services/config"
import { recordReceipt } from "../src/main/services/payments"
import { postSale } from "../src/main/services/sales"
import { postPurchase } from "../src/main/services/purchases"
import { setup } from "./helpers"

describe("profiles and feature flags", () => {
  it("cloth and cosmetics installations get their presets", async () => {
    const cloth = await setup("cloth")
    expect(getConfig(cloth.db).flags).toMatchObject({ than: true, recovery: true, barcode: false, expiry: false })
    const cosm = await setup("cosmetics")
    expect(getConfig(cosm.db).flags).toMatchObject({ than: false, recovery: false, barcode: true, expiry: true })
  })

  it("a disabled feature is rejected by the backend, not just hidden", async () => {
    const c = await setup("cosmetics")
    expect(() => recordReceipt(c.db, c.owner, { partyId: c.party, accountId: c.cash, method: "Cash", amount: 1 })).toThrowError(
      expect.objectContaining({ code: "FEATURE_DISABLED" }),
    )
  })

  it("a feature cannot be turned off while records depend on it", async () => {
    const c = await setup("cloth")
    // the setup created variants with a than size label
    expect(featureInUse(c.db, "than")).toBe(true)
    expect(() => setFlag(c.db, c.ownerId, "than", false)).toThrow(AppError)
    expect(getConfig(c.db).flags.than).toBe(true)
    expect(getConfig(setFlag(c.db, c.ownerId, "barcode", true).flags ? c.db : c.db).flags.barcode).toBe(true)
  })

  it("the profile can only change before any transaction exists", async () => {
    const c = await setup("cloth")
    expect(setProfile(c.db, c.ownerId, "cosmetics").profile).toBe("cosmetics")
    postPurchase(c.db, c.owner, { supplierId: c.supplier, lines: [{ variantId: c.blue, qty: 1, rate: 100 }], payments: [] })
    expect(() => setProfile(c.db, c.ownerId, "cloth")).toThrow(/cannot be changed/)
    void postSale
  })
})
