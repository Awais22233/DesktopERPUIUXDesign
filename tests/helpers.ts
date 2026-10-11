import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase, type DB } from "../src/main/db/connection"
import { migrate } from "../src/main/db/migrate"
import { migrations } from "../src/main/db/migrations"
import { createUser, loadActor, seedRoles } from "../src/main/services/auth"
import { ensureConfig } from "../src/main/services/config"
import { createAccount, createCity, createCompany, createExpenseCategory, createItem, createParty, createSupplier, createVariant, ensureWalkInParty } from "../src/main/services/masterData"
import { ALL_PERMISSIONS, type Actor } from "../src/core/permissions"
import type { ProfileId } from "../src/shared/profiles"

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "erp-test-"))
}

export async function setup(profile: ProfileId = "cloth", file = ":memory:") {
  const db: DB = openDatabase(file)
  await migrate(db, migrations)
  seedRoles(db)
  ensureConfig(db, profile)
  const ownerId = createUser(db, { username: "owner", displayName: "Owner", password: "secret1", role: "Owner / Admin" })
  const owner = loadActor(db, ownerId)
  const limited: Actor = { userId: ownerId, permissions: new Set(["sale.create", "payment.create", "report.view"]) }

  const adminActor: Actor = { userId: ownerId, permissions: ALL_PERMISSIONS }
  const cash = createAccount(db, "Main Cash", "cash")
  const bank = createAccount(db, "Meezan Bank", "bank")
  const ghotki = createCity(db, "Ghotki")
  const company = createCompany(db, adminActor, "Faraz Company")
  const item = createItem(db, { companyId: company, name: "Article A" })
  const blue = createVariant(db, { itemId: item, color: "Blue", sizeLabel: "40 meter", purchasePrice: 100_000, salePrice: 150_000 })
  const black = createVariant(db, { itemId: item, color: "Black", sizeLabel: "40 meter", purchasePrice: 100_000, salePrice: 150_000 })
  const party = createParty(db, { name: "Ali Traders", cityId: ghotki, creditLimit: 0 })
  const walkIn = ensureWalkInParty(db)
  const supplier = createSupplier(db, { name: "ABC Textile" })
  const rent = createExpenseCategory(db, "Rent")
  return { db, owner, limited, ownerId, cash, bank, ghotki, company, item, blue, black, party, walkIn, supplier, rent }
}
export type Ctx = Awaited<ReturnType<typeof setup>>

export const count = (db: DB, table: string): number => (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c
