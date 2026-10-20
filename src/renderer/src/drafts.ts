import type { CartItem } from "@shared/models"

/**
 * A bill that is half made survives opening another screen and even an accidental F5, so nobody has to type it again.
 * It lives in memory while the app runs and in sessionStorage (this window only) across a reload. It is dropped when the
 * bill is saved or when the user signs out.
 */
export interface BillDraft {
  party: string
  cart: CartItem[]
  method: string
  paid: string
  account: string
  discount: string
  invoice: string
  invoiceDate: string
}

const memory: Record<string, BillDraft | undefined> = {}
const key = (kind: "sale" | "purchase") => `erp.draft.${kind}`

export function loadDraft(kind: "sale" | "purchase"): BillDraft | undefined {
  if (memory[kind]) return memory[kind]
  try {
    const raw = sessionStorage.getItem(key(kind))
    if (!raw) return undefined
    const d = JSON.parse(raw) as BillDraft
    if (!d || !Array.isArray(d.cart)) return undefined
    memory[kind] = d
    return d
  } catch {
    return undefined
  }
}

export function saveDraft(kind: "sale" | "purchase", d: BillDraft | undefined): void {
  memory[kind] = d
  try {
    if (d && d.cart.length) sessionStorage.setItem(key(kind), JSON.stringify(d))
    else sessionStorage.removeItem(key(kind))
  } catch {
    /* storage unavailable: the in-memory copy still works while the app is open */
  }
}

export function clearDrafts(): void {
  saveDraft("sale", undefined)
  saveDraft("purchase", undefined)
}
