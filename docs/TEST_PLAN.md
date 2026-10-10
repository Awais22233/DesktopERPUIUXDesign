# Test plan and results

Everything below runs with `pnpm test` (engine, 99 tests), `STRESS=1 pnpm test tests/stress.test.ts` (volume) and `pnpm e2e` (the real application driven through its screens).

## What is proven, and how

| Area | How it is checked |
|---|---|
| Money is exact | Integer paisa everywhere. Stock carries an exact `value`; each sale/return line carries an exact `cost_total`. Invoice-level purchase discounts are shared across lines to the paisa. |
| The books balance | `bookChecks` recomputes every customer, supplier and cash/bank balance from the documents and compares with the ledgers. `accountingIdentity` proves cash + bank + receivables + stock − payables = opening position + net profit, to the paisa. |
| Random business | Seeded fuzz: 4 seeds x 1,200 mixed operations (sales, purchases, receipts, supplier payments, expenses, transfers, returns, exchanges, voids, adjustments, counts, closings) with a check every 150 operations, plus per-operation runs. Zero drift. The checks themselves are proven able to fail (tamper test). |
| Volume | 20,000 items, 3,000 customers, 300 suppliers, 90 trading days (5,400 sales, 2,250 recoveries): all books exact; backup 0.2 s; integrity check 0.2 s; snapshot 1.6 MB; reports under 60 ms. |
| Screens at volume | 10,000 items through the real UI: app opens in ~0.2 s, inventory page ~0.15 s, search ~0.3 s, barcode scan to cart ~0.1 s. Lists are paged by the engine; the renderer never holds the whole catalogue. |
| Printing | Invoices are printed to PDF in A4, thermal 80 mm and thermal 58 mm and read back: page size, every line present, totals, repeated column titles on later pages, no screen controls, black text, roll-length pages. Also the recovery receipt. |
| Power cut | The application is killed (SIGKILL) three times in the middle of a burst of sales and receipts. After each kill the data file passes `integrity_check`, no document is half-written, stock and ledgers still tie, and the app starts again. |
| Licensing | Valid / missing / invalid / expired / wrong machine / clock rollback / wrong profile; the offline key generator page produces keys the real checker accepts. |
| Backups | Single self-contained file, verified after creation; restore only on real corruption. |

## Not testable from the build machine (must be done on site)

1. A real thermal and a real A4 printer (paper size, margins and the printer's own driver).
2. The Windows installer on a real Windows PC (built by CI, never executed by us).
3. A real power cut / unplugging the machine (the SIGKILL test is the closest we can do).
4. Antivirus behaviour on the installer.
