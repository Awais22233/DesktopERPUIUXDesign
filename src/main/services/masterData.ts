import type { DB } from "../db/connection"
import { AppError } from "@core/errors"
import { requirePermission, type Actor } from "@core/permissions"
import { audit, tx } from "../db/util"

const text = (v: string | undefined | null) => (v === undefined || v === null || v.trim() === "" ? null : v.trim())
function required(v: string, label: string): string {
  if (!v || !v.trim()) throw new AppError("VALIDATION", `${label} is required`)
  return v.trim()
}
function unique<T>(fn: () => T, message: string): T {
  try {
    return fn()
  } catch (e) {
    if (e instanceof Error && /UNIQUE constraint failed/.test(e.message)) throw new AppError("VALIDATION", message)
    throw e
  }
}

export function createCity(db: DB, name: string): number {
  return unique(() => Number(db.prepare("INSERT INTO cities(name) VALUES (?)").run(required(name, "City")).lastInsertRowid), "That city already exists")
}

export function createCompany(db: DB, actor: Actor, name: string): number {
  requirePermission(actor, "settings.manage")
  return unique(() => {
    const id = Number(db.prepare("INSERT INTO companies(name) VALUES (?)").run(required(name, "Company name")).lastInsertRowid)
    audit(db, actor.userId, "company.create", "company", id, { name })
    return id
  }, "That company already exists")
}

export function createCategory(db: DB, name: string, parentId?: number): number {
  return unique(() => Number(db.prepare("INSERT INTO categories(name, parent_id) VALUES (?,?)").run(required(name, "Category name"), parentId ?? null).lastInsertRowid), "That category already exists")
}

export function createItem(db: DB, input: { companyId: number; name: string; categoryId?: number; code?: string }): number {
  return unique(
    () =>
      Number(
        db.prepare("INSERT INTO items(company_id, category_id, name, code) VALUES (?,?,?,?)").run(input.companyId, input.categoryId ?? null, required(input.name, "Item name"), text(input.code)).lastInsertRowid,
      ),
    "That item already exists for this company",
  )
}

export interface VariantInput {
  itemId: number
  sku?: string
  barcode?: string
  color?: string
  design?: string
  /** Free text such as "40 meter" or "180 ml". */
  sizeLabel?: string
  unit?: string
  purchasePrice?: number
  salePrice?: number
  wholesalePrice?: number
  minStock?: number
}

export function createVariant(db: DB, input: VariantInput): number {
  return unique(
    () =>
      Number(
        db
          .prepare(
            `INSERT INTO variants(item_id, sku, barcode, color, design, size_label, unit, purchase_price, sale_price, wholesale_price, min_stock)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            input.itemId,
            text(input.sku),
            text(input.barcode),
            text(input.color),
            text(input.design),
            text(input.sizeLabel),
            input.unit ?? "piece",
            input.purchasePrice ?? 0,
            input.salePrice ?? 0,
            input.wholesalePrice ?? null,
            input.minStock ?? 0,
          ).lastInsertRowid,
      ),
    "SKU or barcode already in use",
  )
}

export interface PartyInput {
  name: string
  code?: string
  contactPerson?: string
  phone?: string
  whatsapp?: string
  cityId?: number
  area?: string
  address?: string
  notes?: string
  creditLimit?: number
  paymentTermsDays?: number
}

export function createParty(db: DB, input: PartyInput): number {
  return unique(
    () =>
      Number(
        db
          .prepare(
            `INSERT INTO parties(code, name, contact_person, phone, whatsapp, city_id, area, address, notes, credit_limit, payment_terms_days)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(text(input.code), required(input.name, "Party name"), text(input.contactPerson), text(input.phone), text(input.whatsapp), input.cityId ?? null, text(input.area), text(input.address), text(input.notes), input.creditLimit ?? 0, input.paymentTermsDays ?? null).lastInsertRowid,
      ),
    "That party code is already used",
  )
}

/** The single default customer for anonymous cash sales. Idempotent. */
export function ensureWalkInParty(db: DB): number {
  const row = db.prepare("SELECT id FROM parties WHERE is_walk_in = 1").get() as { id: number } | undefined
  if (row) return row.id
  return Number(db.prepare("INSERT INTO parties(name, is_walk_in, code) VALUES ('Walk-in customer', 1, 'WALKIN')").run().lastInsertRowid)
}

export function createSupplier(db: DB, input: { name: string; code?: string; contactPerson?: string; phone?: string; cityId?: number; address?: string; notes?: string; paymentTermsDays?: number }): number {
  return unique(
    () =>
      Number(
        db
          .prepare("INSERT INTO suppliers(code, name, contact_person, phone, city_id, address, notes, payment_terms_days) VALUES (?,?,?,?,?,?,?,?)")
          .run(text(input.code), required(input.name, "Supplier name"), text(input.contactPerson), text(input.phone), input.cityId ?? null, text(input.address), text(input.notes), input.paymentTermsDays ?? null).lastInsertRowid,
      ),
    "That supplier code is already used",
  )
}

export function createAccount(db: DB, name: string, type: "cash" | "bank"): number {
  return unique(() => Number(db.prepare("INSERT INTO accounts(name, type) VALUES (?,?)").run(required(name, "Account name"), type).lastInsertRowid), "That account already exists")
}

export function createExpenseCategory(db: DB, name: string): number {
  return unique(() => Number(db.prepare("INSERT INTO expense_categories(name) VALUES (?)").run(required(name, "Category name")).lastInsertRowid), "That category already exists")
}

export { tx }
