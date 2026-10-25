import type { DB } from "../db/connection"
import { AppError } from "@core/errors"
import { requirePermission, type Actor } from "@core/permissions"
import { audit, tx } from "../db/util"
import { ensureColour } from "./colours"
import { postMovement } from "./stock"
import { lengthLabel, perThan, toTenths, variantForLength } from "./meters"
import { addAccountEntry, addLedgerEntry } from "./posting"
import { staffForBill } from "./staff"

const clean = (v: string | undefined | null) => (v === undefined || v === null || v.trim() === "" ? null : v.trim())
const must = (v: string | undefined, label: string) => {
  if (!v || !v.trim()) throw new AppError("VALIDATION", `${label} is required`)
  return v.trim()
}
function dup<T>(fn: () => T, message: string): T {
  try {
    return fn()
  } catch (e) {
    if (e instanceof Error && /UNIQUE constraint failed/.test(e.message)) throw new AppError("VALIDATION", message)
    throw e
  }
}

/** Finds a city by name or creates it, so cities can be added without code changes. */
export function cityId(db: DB, name?: string): number | null {
  const n = clean(name)
  if (!n) return null
  const row = db.prepare("SELECT id FROM cities WHERE name = ?").get(n) as { id: number } | undefined
  return row ? row.id : Number(db.prepare("INSERT INTO cities(name) VALUES (?)").run(n).lastInsertRowid)
}

export interface PartyForm {
  id?: number
  name: string
  city?: string
  phone?: string
  whatsapp?: string
  area?: string
  address?: string
  notes?: string
  /** minor units */
  creditLimit?: number
  paymentTermsDays?: number | null
  active?: boolean
  /** minor units; only when creating. Positive = they owe us (customer) / we owe them (supplier). */
  openingBalance?: number
  /** customers only: the usual salesman and recovery person (staff ids); null clears */
  salesmanId?: number | null
  recoveryId?: number | null
}

export function saveParty(db: DB, actor: Actor, kind: "customer" | "supplier", f: PartyForm): number {
  return tx(db, () => {
    const id = savePartyRow(db, actor, kind, f)
    if (kind === "customer" && (f.salesmanId !== undefined || f.recoveryId !== undefined)) {
      if (f.salesmanId) staffForBill(db, f.salesmanId, "salesman")
      if (f.recoveryId) staffForBill(db, f.recoveryId, "recovery")
      db.prepare("UPDATE parties SET salesman_id = ?, recovery_id = ? WHERE id = ? AND is_walk_in = 0").run(f.salesmanId ?? null, f.recoveryId ?? null, id)
    }
    return id
  })
}

function savePartyRow(db: DB, actor: Actor, kind: "customer" | "supplier", f: PartyForm): number {
  requirePermission(actor, "party.manage")
  const name = must(f.name, kind === "customer" ? "Party name" : "Supplier name")
  if (f.creditLimit !== undefined && (!Number.isSafeInteger(f.creditLimit) || f.creditLimit < 0)) throw new AppError("VALIDATION", "Credit limit must be zero or more")
  return tx(db, () => {
    const table = kind === "customer" ? "parties" : "suppliers"
    const status = f.active === false ? "inactive" : "active"
    const sameCity = cityId(db, f.city)
    const clash = db.prepare(`SELECT id FROM ${table} WHERE name = ? COLLATE NOCASE AND city_id IS ? AND id != ?`).get(name, sameCity, f.id ?? 0)
    if (clash) throw new AppError("VALIDATION", `${kind === "customer" ? "A party" : "A supplier"} named "${name}" already exists${f.city?.trim() ? ` in ${f.city.trim()}` : ""}. Use a different name or add the city.`)
    if (f.id) {
      const row = db.prepare(`SELECT id, ${kind === "customer" ? "is_walk_in" : "0 AS is_walk_in"} FROM ${table} WHERE id = ?`).get(f.id) as { id: number; is_walk_in: number } | undefined
      if (!row) throw new AppError("NOT_FOUND", "Record not found")
      if (row.is_walk_in) throw new AppError("INVALID_STATE", "The walk-in customer cannot be edited")
      if (kind === "customer") {
        dup(() => db.prepare("UPDATE parties SET name=?, contact_person=contact_person, phone=?, whatsapp=?, city_id=?, area=?, address=?, notes=?, credit_limit=?, payment_terms_days=?, status=? WHERE id=?").run(name, clean(f.phone), clean(f.whatsapp), cityId(db, f.city), clean(f.area), clean(f.address), clean(f.notes), f.creditLimit ?? 0, f.paymentTermsDays ?? null, status, f.id), "That name is already used")
      } else {
        dup(() => db.prepare("UPDATE suppliers SET name=?, phone=?, city_id=?, address=?, notes=?, payment_terms_days=?, status=? WHERE id=?").run(name, clean(f.phone), cityId(db, f.city), clean(f.address), clean(f.notes), f.paymentTermsDays ?? null, status, f.id), "That name is already used")
      }
      audit(db, actor.userId, `${kind}.update`, table, f.id, { name })
      return f.id
    }
    const cid = cityId(db, f.city)
    const id =
      kind === "customer"
        ? Number(db.prepare("INSERT INTO parties(name, phone, whatsapp, city_id, area, address, notes, credit_limit, payment_terms_days) VALUES (?,?,?,?,?,?,?,?,?)").run(name, clean(f.phone), clean(f.whatsapp), cid, clean(f.area), clean(f.address), clean(f.notes), f.creditLimit ?? 0, f.paymentTermsDays ?? null).lastInsertRowid)
        : Number(db.prepare("INSERT INTO suppliers(name, phone, city_id, address, notes, payment_terms_days) VALUES (?,?,?,?,?,?)").run(name, clean(f.phone), cid, clean(f.address), clean(f.notes), f.paymentTermsDays ?? null).lastInsertRowid)
    const ob = f.openingBalance ?? 0
    if (ob !== 0) {
      if (!Number.isSafeInteger(ob)) throw new AppError("VALIDATION", "Invalid opening balance")
      const abs = Math.abs(ob)
      const owed = kind === "customer" ? ob > 0 : ob > 0 // positive means owed in both cases
      addLedgerEntry(db, {
        ts: new Date().toISOString(),
        partyKind: kind,
        partyId: id,
        debit: kind === "customer" ? (owed ? abs : 0) : owed ? 0 : abs,
        credit: kind === "customer" ? (owed ? 0 : abs) : owed ? abs : 0,
        kind: "opening",
        description: "Opening balance",
        userId: actor.userId,
      })
    }
    audit(db, actor.userId, `${kind}.create`, table, id, { name, openingBalance: ob })
    return id
  })
}

export interface ProductForm {
  id?: number
  company: string
  article: string
  category?: string
  subcategory?: string
  color?: string
  design?: string
  /** free text, e.g. "40 meter" */
  size?: string
  /** cloth: length of the than in meters (one decimal). Prices are then per meter. */
  length?: number
  unit?: string
  barcode?: string
  sku?: string
  purchasePrice: number
  salePrice: number
  wholesalePrice?: number | null
  minStock?: number
  active?: boolean
  /** cloth, create only: several lengths with the thans of each held now (replaces length and openingQty) */
  lengths?: { length: number; qty?: number }[]
  /** create only: opening stock */
  openingQty?: number
  openingCost?: number
}

export function saveProduct(db: DB, actor: Actor, f: ProductForm): number {
  requirePermission(actor, "catalog.manage")
  const company = must(f.company, "Company / brand")
  const article = must(f.article, "Article / item name")
  for (const [v, l] of [[f.purchasePrice, "Purchase price"], [f.salePrice, "Sale price"]] as const) {
    if (!Number.isSafeInteger(v) || v < 0) throw new AppError("VALIDATION", `${l} must be zero or more`)
  }
  if (f.wholesalePrice != null && (!Number.isSafeInteger(f.wholesalePrice) || f.wholesalePrice < 0)) throw new AppError("VALIDATION", "Wholesale price must be zero or more")
  if (f.minStock !== undefined && (!Number.isInteger(f.minStock) || f.minStock < 0)) throw new AppError("VALIDATION", "Minimum stock must be a whole number")

  const lens = (f.lengths ?? []).map((l) => {
    if (l.qty !== undefined && (!Number.isInteger(l.qty) || l.qty < 0 || l.qty > 1_000_000)) throw new AppError("VALIDATION", "Thans must be a whole number")
    return { tenths: toTenths(l.length), qty: l.qty ?? 0 }
  })
  if (new Set(lens.map((l) => l.tenths)).size !== lens.length) throw new AppError("VALIDATION", "A length is listed twice")
  if (lens.length && f.id) throw new AppError("VALIDATION", "Lengths are added by a purchase after the product exists")
  const tenths = lens.length ? lens[0].tenths : f.length === undefined || f.length === null ? null : toTenths(f.length)
  const sizeText = tenths === null ? clean(f.size) : lengthLabel(tenths)
  return tx(db, () => {
    let companyId = (db.prepare("SELECT id FROM companies WHERE name = ?").get(company) as { id: number } | undefined)?.id
    if (!companyId) companyId = Number(db.prepare("INSERT INTO companies(name) VALUES (?)").run(company).lastInsertRowid)

    let categoryId: number | null = null
    const cat = clean(f.category)
    if (cat) {
      let top = (db.prepare("SELECT id FROM categories WHERE name = ? AND parent_id IS NULL").get(cat) as { id: number } | undefined)?.id
      if (!top) top = Number(db.prepare("INSERT INTO categories(name, parent_id) VALUES (?, NULL)").run(cat).lastInsertRowid)
      categoryId = top
      const sub = clean(f.subcategory)
      if (sub) {
        let s = (db.prepare("SELECT id FROM categories WHERE name = ? AND parent_id = ?").get(sub, top) as { id: number } | undefined)?.id
        if (!s) s = Number(db.prepare("INSERT INTO categories(name, parent_id) VALUES (?,?)").run(sub, top).lastInsertRowid)
        categoryId = s
      }
    }

    let itemId = (db.prepare("SELECT id FROM items WHERE company_id = ? AND name = ?").get(companyId, article) as { id: number } | undefined)?.id
    if (!itemId) itemId = Number(db.prepare("INSERT INTO items(company_id, category_id, name) VALUES (?,?,?)").run(companyId, categoryId, article).lastInsertRowid)
    else if (categoryId) db.prepare("UPDATE items SET category_id = ? WHERE id = ?").run(categoryId, itemId)

    const vals = [clean(f.sku), clean(f.barcode), ensureColour(db, f.color), clean(f.design), sizeText, f.unit?.trim() || "piece", f.purchasePrice, f.salePrice, f.wholesalePrice ?? null, f.minStock ?? 0] as const
    let id: number
    if (f.id) {
      const old = db.prepare("SELECT length_tenths FROM variants WHERE id = ?").get(f.id) as { length_tenths: number | null } | undefined
      if (!old) throw new AppError("NOT_FOUND", "Product not found")
      if (f.length !== undefined && f.length !== null && old.length_tenths !== tenths) {
        const used = db.prepare("SELECT 1 FROM stock_movements WHERE variant_id = ? LIMIT 1").get(f.id) || db.prepare("SELECT 1 FROM sale_lines WHERE variant_id = ? LIMIT 1").get(f.id)
        if (used) throw new AppError("VALIDATION", "The length cannot be changed after this product has been used. Buy the new length in a purchase instead.")
        db.prepare("UPDATE variants SET length_tenths = ? WHERE id = ?").run(tenths, f.id)
      }
      dup(() => db.prepare("UPDATE variants SET item_id=?, sku=?, barcode=?, color=?, design=?, size_label=?, unit=?, purchase_price=?, sale_price=?, wholesale_price=?, min_stock=?, active=? WHERE id=?").run(itemId, ...vals, f.active === false ? 0 : 1, f.id), "That SKU or barcode is already used by another product")
      id = f.id
      audit(db, actor.userId, "product.update", "variant", id, { article, color: f.color })
    } else {
      id = dup(() => Number(db.prepare("INSERT INTO variants(item_id, sku, barcode, color, design, size_label, unit, purchase_price, sale_price, wholesale_price, min_stock, length_tenths) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(itemId, ...vals, tenths).lastInsertRowid), "That SKU or barcode is already used by another product")
      audit(db, actor.userId, "product.create", "variant", id, { article, color: f.color })
      if (lens.length) {
        for (const l of lens) {
          if (l.qty <= 0) continue
          const variant = variantForLength(db, id, l.tenths)
          postMovement(db, { variantId: variant, qtyDelta: l.qty, unitCost: perThan(f.openingCost ?? f.purchasePrice, l.tenths), type: "opening", sourceType: "opening", userId: actor.userId, ts: new Date().toISOString() })
        }
        // lengths without stock are still created, so they can be chosen later
        for (const l of lens) variantForLength(db, id, l.tenths)
      } else if (f.openingQty && f.openingQty > 0) {
        postMovement(db, { variantId: id, qtyDelta: f.openingQty, unitCost: tenths === null ? (f.openingCost ?? f.purchasePrice) : perThan(f.openingCost ?? f.purchasePrice, tenths), type: "opening", sourceType: "opening", userId: actor.userId, ts: new Date().toISOString() })
      }
    }
    return id
  })
}

export interface ColoursForm {
  company: string
  article: string
  category?: string
  subcategory?: string
  design?: string
  size?: string
  length?: number
  unit?: string
  purchasePrice: number
  salePrice: number
  wholesalePrice?: number | null
  minStock?: number
  colors: { color: string; openingQty?: number }[]
}

/**
 * Adds one article in several colours in a single step: the same details, one product per colour.
 * A colour that already exists for that article and size is skipped (and reported), never duplicated.
 * Everything is saved in one transaction, so a failure leaves nothing half-created.
 */
export function saveProductColors(db: DB, actor: Actor, f: ColoursForm): { created: number[]; skipped: string[] } {
  requirePermission(actor, "catalog.manage")
  if (!Array.isArray(f.colors) || f.colors.length === 0) throw new AppError("VALIDATION", "Add at least one colour")
  if (f.colors.length > 60) throw new AppError("VALIDATION", "Add at most 60 colours at a time")
  const seen = new Set<string>()
  const colors: { color: string; openingQty?: number }[] = []
  for (const c of f.colors) {
    const name = (c.color ?? "").trim().replace(/\s+/g, " ")
    if (!name) throw new AppError("VALIDATION", "A colour name is empty")
    if (name.length > 60) throw new AppError("VALIDATION", `Colour name is too long: ${name.slice(0, 20)}…`)
    if (c.openingQty !== undefined && (!Number.isInteger(c.openingQty) || c.openingQty < 0 || c.openingQty > 1_000_000)) throw new AppError("VALIDATION", `Opening stock for ${name} must be a whole number up to 1,000,000`)
    const key = name.toLowerCase()
    if (seen.has(key)) throw new AppError("VALIDATION", `The colour "${name}" is listed twice`)
    seen.add(key)
    colors.push({ color: name, openingQty: c.openingQty })
  }
  return tx(db, () => {
    const created: number[] = []
    const skipped: string[] = []
    const company = must(f.company, "Company / brand")
    const article = must(f.article, "Article / item name")
    for (const c of colors) {
      const exists = db
        .prepare(
          `SELECT 1 FROM variants v JOIN items i ON i.id = v.item_id JOIN companies co ON co.id = i.company_id
           WHERE co.name = ? AND i.name = ? AND lower(COALESCE(v.color,'')) = lower(?) AND COALESCE(v.size_label,'') = COALESCE(?, '') AND COALESCE(v.design,'') = COALESCE(?, '')`,
        )
        .get(company, article, c.color, f.length === undefined ? clean(f.size) : lengthLabel(toTenths(f.length)), clean(f.design))
      if (exists) {
        skipped.push(c.color)
        continue
      }
      created.push(
        saveProduct(db, actor, {
          company, article, category: f.category, subcategory: f.subcategory, design: f.design, size: f.size, length: f.length, unit: f.unit,
          purchasePrice: f.purchasePrice, salePrice: f.salePrice, wholesalePrice: f.wholesalePrice, minStock: f.minStock,
          color: c.color, openingQty: c.openingQty, openingCost: f.purchasePrice,
        }),
      )
    }
    return { created, skipped }
  })
}

export function addAccount(db: DB, actor: Actor, input: { name: string; type: "cash" | "bank"; opening?: number }): number {
  requirePermission(actor, "settings.manage")
  const name = must(input.name, "Account name")
  return tx(db, () => {
    const id = dup(() => Number(db.prepare("INSERT INTO accounts(name, type) VALUES (?,?)").run(name, input.type).lastInsertRowid), "An account with this name already exists")
    if (input.opening) {
      if (!Number.isSafeInteger(input.opening)) throw new AppError("VALIDATION", "Invalid opening balance")
      addAccountEntry(db, { ts: new Date().toISOString(), accountId: id, amount: input.opening, kind: "opening", description: "Opening balance", userId: actor.userId })
    }
    audit(db, actor.userId, "account.create", "account", id, { name, type: input.type })
    return id
  })
}

export function setAccountActive(db: DB, actor: Actor, id: number, active: boolean): void {
  requirePermission(actor, "settings.manage")
  tx(db, () => {
    if (!db.prepare("SELECT 1 FROM accounts WHERE id = ?").get(id)) throw new AppError("NOT_FOUND", "Account not found")
    if (!active) {
      const bal = (db.prepare("SELECT COALESCE(SUM(amount),0) b FROM account_entries WHERE account_id = ?").get(id) as { b: number }).b
      if (bal !== 0) throw new AppError("INVALID_STATE", "An account with a balance cannot be deactivated. Transfer the money out first.")
      const remaining = db.prepare("SELECT COUNT(*) c FROM accounts WHERE active = 1").get() as { c: number }
      if (remaining.c <= 1) throw new AppError("INVALID_STATE", "At least one account must stay active")
    }
    db.prepare("UPDATE accounts SET active = ? WHERE id = ?").run(active ? 1 : 0, id)
    audit(db, actor.userId, "account.update", "account", id, { active })
  })
}

export function addMaster(db: DB, actor: Actor, kind: "expenseCategory" | "company" | "category" | "subcategory" | "city", name: string, parent?: string): void {
  requirePermission(actor, kind === "city" ? "party.manage" : "catalog.manage")
  const n = must(name, "Name")
  tx(db, () => {
    switch (kind) {
      case "expenseCategory":
        dup(() => db.prepare("INSERT INTO expense_categories(name) VALUES (?)").run(n), "That category already exists")
        break
      case "company":
        dup(() => db.prepare("INSERT INTO companies(name) VALUES (?)").run(n), "That company already exists")
        break
      case "category":
        dup(() => db.prepare("INSERT INTO categories(name, parent_id) VALUES (?, NULL)").run(n), "That category already exists")
        break
      case "subcategory": {
        const p = db.prepare("SELECT id FROM categories WHERE name = ? AND parent_id IS NULL").get(must(parent, "Category")) as { id: number } | undefined
        if (!p) throw new AppError("NOT_FOUND", "Category not found")
        dup(() => db.prepare("INSERT INTO categories(name, parent_id) VALUES (?,?)").run(n, p.id), "That subcategory already exists")
        break
      }
      case "city":
        dup(() => db.prepare("INSERT INTO cities(name) VALUES (?)").run(n), "That city already exists")
        break
    }
    audit(db, actor.userId, `master.${kind}`, "master", n, { parent })
  })
}
