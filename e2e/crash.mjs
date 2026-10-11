// Power-cut test: the application is killed (SIGKILL, no chance to clean up) in the middle of a burst of sales,
// the data file is then inspected with raw SQL, and the application is started again on the same data.
import { _electron as electron } from "playwright-core"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { launch, root } from "./lib.mjs"

const require = createRequire(import.meta.url)
const { app, page, step, data, env, work, finish } = await launch("cloth", "Crash Test House")
const api = (pg, channel, payload) =>
  pg.evaluate(async ([c, p]) => {
    const r = await window.api.invoke(c, p)
    if (!r.ok) throw new Error(r.error.message)
    return r.data
  }, [channel, payload])
const must = (c, m) => { if (!c) throw new Error(m) }

let kills = 0
for (let round = 1; round <= 3; round++) {
  // (round 1 uses the app that launch() started; later rounds restart on the same data)
  let pg = page
  let cur = app
  if (round > 1) {
    cur = await electron.launch({ executablePath: require("electron"), args: [root, "--no-sandbox", "--disable-gpu"], env })
    pg = await cur.firstWindow()
    await step(`round ${round}: the app starts again on the damaged-by-kill data and asks for sign-in`, async () => {
      await pg.waitForSelector("text=Sign in", { timeout: 25000 })
      await pg.locator("input[name=username]").fill("owner")
      await pg.locator("input[name=password]").fill("secret1")
      await pg.getByRole("button", { name: /Sign in/ }).click()
      await pg.waitForSelector("text=Business overview")
      const h = await api(pg, "health:get")
      must(h.integrityOk, "integrity check failed after a kill: " + h.problems.join("; "))
    })
  } else {
    await step("set up: owner, customer, supplier, stock", async () => {
      await pg.waitForSelector("text=Create the owner account")
      await pg.locator("input[name=name]").fill("Owner")
      await pg.locator("input[name=username]").fill("owner")
      await pg.locator("input[name=password]").fill("secret1")
      await pg.locator("input[name=again]").fill("secret1")
      await pg.getByRole("button", { name: "Create account" }).click()
      await pg.waitForSelector("text=Business overview")
      const sup = await api(pg, "party:save", { kind: "supplier", name: "S" })
      await api(pg, "party:save", { kind: "customer", name: "Ali", limit: 0 })
      for (let i = 1; i <= 5; i++) await api(pg, "product:save", { company: "C", article: `A${i}`, cost: 1000, rate: 1500, openingQty: 0 })
      const prods = (await api(pg, "products:list", { pageSize: 10 })).rows
      await api(pg, "purchase:create", { supplierId: sup.id, lines: prods.map((p) => ({ productId: p.id, qty: 100000, rate: 1000 })), payments: [] })
    })
  }

  await step(`round ${round}: kill the application in the middle of a burst of sales, receipts and purchases`, async () => {
    const prods = (await api(pg, "products:list", { pageSize: 10 })).rows
    const party = (await api(pg, "snapshot:get")).parties[0].id
    await pg.evaluate(async ([ids, party]) => {
      window.__done = 0
      void (async () => {
        for (let i = 0; i < 100000; i++) {
          const r = await window.api.invoke("sale:create", { partyId: party, lines: ids.map((id, k) => ({ productId: id, qty: 1 + ((i + k) % 3) })), discount: 1, payments: i % 2 ? [{ account: "Cash in hand", method: "Cash", amount: 100 }] : [] })
          if (r.ok) window.__done++
          if (i % 7 === 0) await window.api.invoke("receipt:create", { partyId: party, account: "Cash in hand", method: "Cash", amount: 1 })
        }
      })()
    }, [prods.map((p) => p.id), party])
    await pg.waitForFunction(() => window.__done > 150, null, { timeout: 30000 })
    cur.process().kill("SIGKILL")
    kills++
    await new Promise((r) => setTimeout(r, 800))
  })

  await step(`round ${round}: after the kill the data file is intact and every document is complete (raw SQL)`, async () => {
    const script = join(work, "inspect.cjs")
    writeFileSync(script, `
const Database = require(${JSON.stringify(require.resolve("better-sqlite3", { paths: [root] }))})
const db = new Database(${JSON.stringify(join(data, "erp.db"))})
const one = (q) => db.prepare(q).get()
const out = {
  integrity: db.pragma("integrity_check", { simple: true }),
  sales: one("SELECT COUNT(*) n FROM sales").n,
  salesWithoutLedger: one("SELECT COUNT(*) n FROM sales s WHERE NOT EXISTS (SELECT 1 FROM ledger_entries e WHERE e.source_type='sale' AND e.source_id=s.id AND e.kind='sale')").n,
  salesWithoutLines: one("SELECT COUNT(*) n FROM sales s WHERE NOT EXISTS (SELECT 1 FROM sale_lines l WHERE l.sale_id=s.id)").n,
  salesWithoutStock: one("SELECT COUNT(*) n FROM sales s WHERE (SELECT COUNT(*) FROM stock_movements m WHERE m.source_type='sale' AND m.source_id=s.id AND m.type='sale') <> (SELECT COUNT(*) FROM sale_lines l WHERE l.sale_id=s.id)").n,
  paidMismatch: one("SELECT COUNT(*) n FROM sales s WHERE s.paid <> (SELECT COALESCE(SUM(amount),0) FROM sale_payments p WHERE p.sale_id=s.id) OR s.paid <> (SELECT COALESCE(SUM(amount),0) FROM account_entries a WHERE a.source_type='sale' AND a.source_id=s.id AND a.kind='sale_receipt')").n,
  stockDrift: one("SELECT COUNT(*) n FROM stock_levels l WHERE l.qty <> COALESCE((SELECT SUM(qty_delta) FROM stock_movements m WHERE m.variant_id=l.variant_id),0) OR l.value <> COALESCE((SELECT SUM(value) FROM stock_movements m WHERE m.variant_id=l.variant_id),0)").n,
  receiptsWithoutCash: one("SELECT COUNT(*) n FROM payments p WHERE p.kind='customer_receipt' AND NOT EXISTS (SELECT 1 FROM account_entries a WHERE a.source_type='payment' AND a.source_id=p.id)").n,
  receiptsWithoutLedger: one("SELECT COUNT(*) n FROM payments p WHERE p.kind='customer_receipt' AND NOT EXISTS (SELECT 1 FROM ledger_entries e WHERE e.source_type='payment' AND e.source_id=p.id)").n,
  ledgerVsDocs: one("SELECT (SELECT COALESCE(SUM(debit)-SUM(credit),0) FROM ledger_entries WHERE party_kind='customer') - ((SELECT COALESCE(SUM(total-paid),0) FROM sales WHERE status='completed') - (SELECT COALESCE(SUM(amount),0) FROM payments WHERE kind='customer_receipt')) d").d,
}
console.log(JSON.stringify(out))
`)
    // better-sqlite3 here is built for Electron, so run the inspection with Electron acting as plain Node
    const res = JSON.parse(execFileSync(require("electron"), [script], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } }).toString().trim().split("\n").pop())
    console.log("      " + JSON.stringify(res))
    must(res.integrity === "ok", "integrity_check: " + res.integrity)
    for (const k of ["salesWithoutLedger", "salesWithoutLines", "salesWithoutStock", "paidMismatch", "stockDrift", "receiptsWithoutCash", "receiptsWithoutLedger"]) must(res[k] === 0, `${k} = ${res[k]}`)
    must(res.ledgerVsDocs === 0, `customer ledger differs from documents by ${res.ledgerVsDocs}`)
    must(res.sales > 100, "the burst did not create sales")
  })
}

// the final restart: everything still works
const last = await electron.launch({ executablePath: require("electron"), args: [root, "--no-sandbox", "--disable-gpu"], env })
const lp = await last.firstWindow()
await step("final restart: sign in, books are readable, a new sale can be made", async () => {
  await lp.waitForSelector("text=Sign in", { timeout: 25000 })
  await lp.locator("input[name=username]").fill("owner")
  await lp.locator("input[name=password]").fill("secret1")
  await lp.getByRole("button", { name: /Sign in/ }).click()
  await lp.waitForSelector("text=Business overview")
  const prods = (await api(lp, "products:list", { pageSize: 1 })).rows
  const party = (await api(lp, "snapshot:get")).parties[0].id
  const s = await api(lp, "sale:create", { partyId: party, lines: [{ productId: prods[0].id, qty: 1 }], payments: [] })
  must(!!s.id, "no new sale")
})
await last.close()
console.log(`      killed ${kills} times`)
await finish().catch(() => {})
