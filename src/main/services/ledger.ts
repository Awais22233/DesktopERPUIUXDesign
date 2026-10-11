import type { DB } from "../db/connection"
import { getSetting } from "../db/util"
import type { LedgerView } from "@shared/models"
import { bizDate, docLabel } from "./snapshot"

const r = (minor: number) => minor / 100
const DAY = 86_400_000
const KIND_LABEL: Record<string, string> = {
  opening: "Opening balance", sale: "Sales invoice", sale_return: "Sale return", receipt: "Payment received", purchase: "Purchase invoice",
  purchase_return: "Purchase return", payment: "Payment made", sale_void: "Sale cancelled", purchase_void: "Purchase cancelled", adjustment: "Adjustment",
}

/**
 * Statement with running balance, plus aging. Aging applies every payment/credit to the oldest charges first
 * (balance-forward), then groups what is still unpaid by how old the charge is.
 */
export function ledgerView(db: DB, kind: "customer" | "supplier", partyId: number, now = Date.now()): LedgerView {
  const off = Number(getSetting(db, "timezone_offset_minutes", "300"))
  const rows = db.prepare("SELECT id, ts, debit, credit, kind, source_type, source_id, description FROM ledger_entries WHERE party_kind = ? AND party_id = ? ORDER BY ts, id").all(kind, partyId) as {
    id: number; ts: string; debit: number; credit: number; kind: string; source_type: string | null; source_id: number | null; description: string | null
  }[]
  // from the business's point of view: customer owes on debit; supplier is owed on credit
  const charge = (x: { debit: number; credit: number }) => (kind === "customer" ? x.debit : x.credit)
  const settle = (x: { debit: number; credit: number }) => (kind === "customer" ? x.credit : x.debit)

  let running = 0
  const out = rows.map((x) => {
    running += charge(x) - settle(x)
    return { id: x.id, date: bizDate(x.ts, off), ref: docLabel(db, x.source_type, x.source_id), description: x.description || KIND_LABEL[x.kind] || x.kind, debit: r(x.debit), credit: r(x.credit), balance: r(running) }
  })

  let credit = rows.reduce((s, x) => s + settle(x), 0)
  const open: { ts: string; left: number }[] = []
  for (const x of rows) {
    let c = charge(x)
    if (c <= 0) continue
    const used = Math.min(c, credit)
    credit -= used
    c -= used
    if (c > 0) open.push({ ts: x.ts, left: c })
  }
  const buckets = [0, 0, 0, 0]
  for (const o of open) {
    const days = Math.floor((now - new Date(o.ts).getTime()) / DAY)
    buckets[days <= 30 ? 0 : days <= 60 ? 1 : days <= 90 ? 2 : 3]! += o.left
  }
  return { rows: out, aging: buckets.map(r) }
}
