import type { Collection, Transaction } from "./models"
import type { Business } from "./ipc"

/** Same rule as the screens: whole rupees when whole, otherwise exactly two decimals, never "-0". */
function rs(n: number): string {
  if (Math.abs(n) < 0.005) n = 0
  const whole = Math.round(n * 100) % 100 === 0
  return "Rs. " + n.toLocaleString("en-PK", whole ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
/** WhatsApp turns *x*, _x_, ~x~ and `x` into formatting; a stray one inside a name must not garble the message. */
const plain = (s: string | undefined) => (s ?? "").replace(/[*_~`]/g, " ").replace(/\s+/g, " ").trim()
const round2 = (n: number) => Math.round(n * 100) / 100
const bal = (n: number) => (n < 0 ? `${rs(-n)} advance` : rs(n))

export type ShareKind = "sale" | "purchase" | "receipt"

/**
 * The bill as plain text that reads well in WhatsApp (bold headings with *stars*, one line per item).
 * The user copies it and pastes it into a chat.
 */
export function whatsappText(doc: Transaction | Collection, kind: ShareKind, business: Pick<Business, "name" | "phone" | "address" | "city" | "invoiceFooter">): string {
  const out: string[] = []
  out.push(`*${plain(business.name) || "Invoice"}*`)
  if (business.phone) out.push(`Phone: ${plain(business.phone)}`)
  out.push("------------------------------")

  if (kind === "receipt") {
    const c = doc as Collection
    out.push(`*PAYMENT RECEIPT*  ${c.id}`)
    out.push(`Date: ${c.date}${c.time ? ` ${c.time}` : ""}`)
    out.push(`Received from: ${plain(c.party)}`)
    out.push("")
    out.push(`*Amount received: ${rs(c.amount)}*`)
    out.push(`${plain(c.method)} · ${plain(c.account)}`)
    if (c.balanceBefore !== undefined && c.balanceAfter !== undefined) {
      out.push("")
      out.push(`Previous balance: ${bal(c.balanceBefore)}`)
      out.push(`*Remaining balance: ${bal(c.balanceAfter)}*`)
    }
    if (c.notes) out.push("", plain(c.notes))
  } else {
    const t = doc as Transaction
    if (t.status === "void") out.push("*CANCELLED - this invoice is void*")
    out.push(`*${kind === "purchase" ? "PURCHASE INVOICE" : "SALES INVOICE"}*  ${t.id}`)
    out.push(`Date: ${t.date}${t.time ? ` ${t.time}` : ""}`)
    out.push(`${kind === "purchase" ? "Supplier" : "Customer"}: ${plain(t.party)}`)
    out.push("")
    ;(t.lines ?? []).forEach((l, i) => {
      const extra = [l.size, l.color && !l.name.endsWith(l.color) ? l.color : ""].map(plain).filter(Boolean).join(", ")
      const amount = l.qty * l.rate - l.discount
      out.push(`${i + 1}. ${plain(l.name)}${extra ? ` (${extra})` : ""}`)
      out.push(`    ${l.qty} x ${rs(l.rate)}${l.discount > 0 ? ` - ${rs(l.discount)} disc` : ""} = ${rs(amount)}`)
    })
    out.push("")
    if ((t.invoiceDiscount ?? 0) > 0) {
      out.push(`Subtotal: ${rs(t.total + (t.invoiceDiscount ?? 0))}`)
      out.push(`Discount: - ${rs(t.invoiceDiscount ?? 0)}`)
    }
    out.push(`*Bill total: ${rs(t.total)}*`)
    if (t.balanceBefore !== undefined && t.balanceAfter !== undefined && !t.walkIn) {
      out.push(`Previous balance: ${bal(t.balanceBefore)}`)
      out.push(`Total payable: ${bal(round2(t.balanceBefore + t.total))}`)
      out.push(`Paid${t.method && t.paid > 0 && !["Partial", "Credit"].includes(t.method) ? ` (${plain(t.method)})` : ""}: ${rs(t.paid)}`)
      out.push(`*Remaining balance: ${bal(t.balanceAfter)}*`)
    } else {
      out.push(`Paid${t.method ? ` (${plain(t.method)})` : ""}: ${rs(t.paid)}`)
      out.push(`*Remaining: ${rs(t.total - t.paid)}*`)
    }
  }
  out.push("------------------------------")
  out.push(plain(business.invoiceFooter) || "Thank you for your business.")
  return out.join("\n")
}
