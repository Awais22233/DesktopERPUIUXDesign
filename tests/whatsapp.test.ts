import { describe, expect, it } from "vitest"
import { whatsappText } from "../src/shared/whatsapp"

const biz = { name: "Raza *Cloth* House", phone: "0300-1234567", address: "", city: "Ghotki", invoiceFooter: "" }
const sale = {
  id: "INV-00012", party: "Ali _Traders_", date: "2026-10-22", time: "14:05", items: 7, total: 11_250.5, paid: 5_000, method: "Partial", status: "completed" as const,
  invoiceDiscount: 100, balanceBefore: 20_000, balanceAfter: 26_250.5,
  lines: [
    { productId: "1", name: "Alpha Black", color: "Black", size: "40 meter", qty: 5, rate: 1_500, discount: 0 },
    { productId: "2", name: "Lawn علی", color: "Red", size: "", qty: 2, rate: 1_925.25, discount: 50 },
  ],
}

describe("WhatsApp bill text", () => {
  it("lists every line with its amount and the balances", () => {
    const t = whatsappText(sale, "sale", biz)
    expect(t).toContain("*SALES INVOICE*  INV-00012")
    expect(t).toContain("1. Alpha Black (40 meter)")
    expect(t).toContain("5 x Rs. 1,500 = Rs. 7,500")
    expect(t).toContain("2. Lawn علی (Red)")
    expect(t).toContain("2 x Rs. 1,925.25 - Rs. 50 disc = Rs. 3,800.50")
    expect(t).toContain("Subtotal: Rs. 11,350.50")
    expect(t).toContain("*Bill total: Rs. 11,250.50*")
    expect(t).toContain("Previous balance: Rs. 20,000")
    expect(t).toContain("*Remaining balance: Rs. 26,250.50*")
    expect(t).toContain("Thank you for your business.")
  })
  it("a star or underscore in a name cannot break WhatsApp formatting", () => {
    const t = whatsappText(sale, "sale", biz)
    expect(t).toContain("*Raza Cloth House*")
    expect(t).toContain("Customer: Ali Traders")
  })
  it("walk-in bill shows paid and remaining without account balances; advance is worded", () => {
    const t = whatsappText({ ...sale, walkIn: true, paid: 11_250.5, method: "Cash" }, "sale", biz)
    expect(t).not.toContain("Previous balance")
    expect(t).toContain("*Remaining: Rs. 0*")
    const adv = whatsappText({ ...sale, balanceBefore: -500, balanceAfter: -100 }, "sale", biz)
    expect(adv).toContain("Previous balance: Rs. 500 advance")
  })
  it("a cancelled bill says so, and a receipt has its own layout", () => {
    expect(whatsappText({ ...sale, status: "void" }, "sale", biz)).toContain("*CANCELLED - this invoice is void*")
    const r = whatsappText({ id: "RCP-00003", party: "Ali", amount: 5_000, method: "Cash", account: "Cash", date: "2026-10-22", time: "15:00", user: "x", notes: "", balanceBefore: 26_250.5, balanceAfter: 21_250.5 }, "receipt", biz)
    expect(r).toContain("*PAYMENT RECEIPT*  RCP-00003")
    expect(r).toContain("*Amount received: Rs. 5,000*")
    expect(r).toContain("*Remaining balance: Rs. 21,250.50*")
  })
})
