import { describe, expect, it } from "vitest"
import { saveParty } from "../src/main/services/catalog"
import { setup } from "./helpers"

describe("duplicate party names", () => {
  it("same name in the same city is refused (any case); same name in another city is fine", async () => {
    const { db, owner } = await setup()
    saveParty(db, owner, "customer", { name: "Noor Cloth House", city: "Ghotki" })
    expect(() => saveParty(db, owner, "customer", { name: "noor cloth house", city: "Ghotki" })).toThrow(/already exists/)
    expect(() => saveParty(db, owner, "customer", { name: "Noor Cloth House" })).not.toThrow()
    expect(() => saveParty(db, owner, "customer", { name: "Noor Cloth House", city: "Sukkur" })).not.toThrow()
    const id = saveParty(db, owner, "supplier", { name: "ABC Mills", city: "Faisalabad" })
    expect(() => saveParty(db, owner, "supplier", { name: "abc mills", city: "Faisalabad" })).toThrow(/already exists/)
    // editing a record to keep its own name must still work
    expect(() => saveParty(db, owner, "supplier", { id, name: "ABC Mills", city: "Faisalabad", phone: "0300" })).not.toThrow()
  })
})
