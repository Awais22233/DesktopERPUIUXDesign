import type { DB } from "../db/connection"
import { tx } from "../db/util"

/** Starting configuration for a new installation (not business data). Runs once, only into empty tables. */
export function seedDefaults(db: DB): void {
  tx(db, () => {
    const accounts = db.prepare("SELECT COUNT(*) c FROM accounts").get() as { c: number }
    if (accounts.c === 0) db.prepare("INSERT INTO accounts(name, type) VALUES ('Cash in hand', 'cash')").run()
    const cats = db.prepare("SELECT COUNT(*) c FROM expense_categories").get() as { c: number }
    if (cats.c === 0) {
      for (const name of ["Electricity", "Rent", "Transport", "Salary", "Tea / Food", "Internet", "Repair", "Other"]) {
        db.prepare("INSERT INTO expense_categories(name) VALUES (?)").run(name)
      }
    }
  })
}
