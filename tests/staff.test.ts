import { describe, expect, it } from "vitest"
import { AppError } from "../src/core/errors"
import { saveParty } from "../src/main/services/catalog"
import { listDocs } from "../src/main/services/lists"
import { postPurchase } from "../src/main/services/purchases"
import { postSale } from "../src/main/services/sales"
import { listStaff, saveStaff } from "../src/main/services/staff"
import { buildSnapshot } from "../src/main/services/snapshot"
import { setup } from "./helpers"

const code = (fn: () => unknown) => {
  try {
    fn()
  } catch (e) {
    return e instanceof AppError ? e.code : "other"
  }
  return "none"
}

describe("salesmen and recovery persons on the bill", () => {
  it("keeps the name and phone on the bill, and the customer's address and phone", async () => {
    const c = await setup()
    postPurchase(c.db, c.owner, { supplierId: c.supplier, lines: [{ variantId: c.blue, qty: 10, rate: 100_000 }], payments: [] })
    const sm = saveStaff(c.db, c.owner, { name: "Imran Arain", phone: "0300-1112223", role: "salesman" })
    const rec = saveStaff(c.db, c.owner, { name: "Bilal", phone: "0311-9998887", role: "recovery" })
    saveParty(c.db, c.owner, "customer", { id: c.party, name: "Ali Traders", city: "Ghotki", phone: "0333-555", address: "Main Bazaar, Shop 4", salesmanId: sm, recoveryId: rec })
    expect(c.db.prepare("SELECT salesman_id s, recovery_id r FROM parties WHERE id = ?").get(c.party)).toEqual({ s: sm, r: rec })
    postSale(c.db, c.owner, { partyId: c.party, lines: [{ variantId: c.blue, qty: 1, rate: 150_000 }], payments: [], bookedById: sm, recoveryById: rec })
    // renaming the person later must not change a printed bill
    saveStaff(c.db, c.owner, { id: sm, name: "Imran A.", phone: "0300-0000000", role: "salesman" })
    const bill = listDocs(c.db, { kind: "sale" }).rows[0]
    expect(bill).toMatchObject({ bookedBy: "Imran Arain", bookedPhone: "0300-1112223", recoveryBy: "Bilal", recoveryPhone: "0311-9998887", partyPhone: "0333-555", partyAddress: "Main Bazaar, Shop 4", partyCity: "Ghotki" })
    const party = buildSnapshot(c.db).parties.find((p) => p.name === "Ali Traders")!
    expect(party.salesmanId).toBe(`STF-${String(sm).padStart(4, "0")}`)
    expect(buildSnapshot(c.db).masters.staff.map((x) => x.name)).toEqual(["Bilal", "Imran A."])
  })
  it("refuses the wrong job, a switched-off person, a duplicate name, and a user without settings permission", async () => {
    const c = await setup()
    postPurchase(c.db, c.owner, { supplierId: c.supplier, lines: [{ variantId: c.blue, qty: 10, rate: 100_000 }], payments: [] })
    const sm = saveStaff(c.db, c.owner, { name: "Imran", role: "salesman" })
    const rec = saveStaff(c.db, c.owner, { name: "Bilal", role: "recovery" })
    const base = { partyId: c.party, lines: [{ variantId: c.blue, qty: 1, rate: 100 }], payments: [] }
    expect(code(() => postSale(c.db, c.owner, { ...base, bookedById: rec }))).toBe("VALIDATION")
    expect(code(() => postSale(c.db, c.owner, { ...base, recoveryById: sm }))).toBe("VALIDATION")
    saveStaff(c.db, c.owner, { id: sm, name: "Imran", role: "salesman", active: false })
    expect(code(() => postSale(c.db, c.owner, { ...base, bookedById: sm }))).toBe("INVALID_STATE")
    expect(code(() => saveStaff(c.db, c.owner, { name: "bilal", role: "both" }))).toBe("VALIDATION")
    expect(code(() => saveStaff(c.db, c.limited, { name: "X", role: "both" }))).toBe("FORBIDDEN")
    expect(listStaff(c.db).find((x) => x.name === "Imran")!.active).toBe(false)
  })
  it("a person who does both can be chosen for either job; a bill without staff still saves", async () => {
    const c = await setup()
    postPurchase(c.db, c.owner, { supplierId: c.supplier, lines: [{ variantId: c.blue, qty: 10, rate: 100_000 }], payments: [] })
    const both = saveStaff(c.db, c.owner, { name: "Kamran", role: "both" })
    const r = postSale(c.db, c.owner, { partyId: c.party, lines: [{ variantId: c.blue, qty: 1, rate: 100 }], payments: [], bookedById: both, recoveryById: both })
    expect(r.saleId).toBeGreaterThan(0)
    expect(code(() => postSale(c.db, c.owner, { partyId: c.party, lines: [{ variantId: c.blue, qty: 1, rate: 100 }], payments: [] }))).toBe("none")
  })
})
