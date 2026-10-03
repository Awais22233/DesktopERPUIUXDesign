import type { DB } from "../db/connection"

/** Low-level ledger/account writes shared by all services. Always called inside a transaction. */

export function addLedgerEntry(
  db: DB,
  e: {
    ts: string
    partyKind: "customer" | "supplier"
    partyId: number
    debit?: number
    credit?: number
    kind: string
    sourceType?: string
    sourceId?: number
    description?: string
    userId: number | null
  },
): void {
  db.prepare(
    `INSERT INTO ledger_entries(ts, party_kind, party_id, debit, credit, kind, source_type, source_id, description, user_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(e.ts, e.partyKind, e.partyId, e.debit ?? 0, e.credit ?? 0, e.kind, e.sourceType ?? null, e.sourceId ?? null, e.description ?? null, e.userId)
}

export function addAccountEntry(
  db: DB,
  e: {
    ts: string
    accountId: number
    amount: number
    kind: string
    sourceType?: string
    sourceId?: number
    description?: string
    userId: number | null
  },
): void {
  db.prepare(
    `INSERT INTO account_entries(ts, account_id, amount, kind, source_type, source_id, description, user_id)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(e.ts, e.accountId, e.amount, e.kind, e.sourceType ?? null, e.sourceId ?? null, e.description ?? null, e.userId)
}
