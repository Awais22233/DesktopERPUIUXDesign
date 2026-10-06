# Roadmap and quality plan

Status legend: DONE, NEXT, LATER. Order is chosen so the risky financial logic is proven first and every screen is wired to
the real engine (no demo data) before it counts as finished.

## Done
- Engine: SQLite (WAL, full sync), migrations, ledger / stock / cash as transactions, weighted-average costing, void (blocked when a
  return exists), returns and exchange, cash closing, physical stock count, batches with first-expiry-first-out, audit log.
- Real sign-in and first-run owner setup; users, roles and per-role permissions enforced by the engine.
- Every screen is wired to real data (no demo data): Dashboard, Sales/POS (walk-in, barcode, credit limit modes), Purchases (batch and
  expiry), Customers and Suppliers (city, WhatsApp, opening balance, statements, aging), Recovery, Expenses, Cash and Bank (accounts,
  transfers, daily closing), Inventory (add/edit product, count, adjust), Returns and Exchange, Reports (41 reports computed in the
  engine), Users and Permissions, Settings (all sections stored in the database), Backup and Restore.
- Cloth Wholesale and Cosmetics profiles, backend-enforced feature flags, dynamic business identity, per-machine license.
- Backups (daily, on close, second location, verified single file), integrity check at start, safe restore, pre-upgrade backup.
- Tests: 71 engine tests plus UI end-to-end runs that click through the real application window for both profiles (`pnpm e2e`).
- CI builds the Windows installer and the Linux AppImage, and runs all tests on every push.

## Next
1. **Printing on real hardware.** A4 and thermal layouts exist in the invoice preview and use the system print dialog. They must be
   checked on each client's actual printers (and silent thermal printing added if the client wants it).
2. **Windows acceptance run.** Install the CI-built setup on a clean Windows PC, activate, repeat the e2e script by hand, test a
   power cut and a restore.
3. **Client data entry.** Opening stock and balances are entered through the product and party forms; add a faster bulk-entry screen
   if a client has hundreds of items (Excel import was deferred by decision).
4. **Application icon and installer artwork** (currently the default Electron icon).
5. **Code signing certificate** to avoid the Windows SmartScreen warning (optional).
6. **Refinements from the first client's trial week.**

## Definition of done for every module
1. Business rules in the service layer with tests (including failure and permission cases).
2. Inputs validated at the IPC boundary; errors shown as plain messages, never stack traces.
3. Screen wired to real data. No demo data left on it.
4. Disabled features fully hidden and backend-rejected.
5. Audit entries for money and stock changes.
6. Works with the app offline, after a restart, and after a backup restore.
7. Typecheck, tests and the Windows installer build pass in CI.

## Safeguards against client complaints
- Money and stock can only change through transactional services; balances are derived and reconciled by tests.
- Nothing is deleted: mistakes are voided with a reason and an audit trail.
- A backup is taken automatically every day and on close, and before every upgrade.
- Power-loss safety: committed work survives; unfinished work leaves no partial record.
- Clear messages when something cannot be done (for example "Only 5 in stock"), instead of silent failures.
- Support tools: log file with export, health screen, versioned database upgrades.
- Hardware advice given to the client up front (SSD, UPS, USB drive for backups).

## Release checklist (before each client installation)
- [ ] Installer built by CI from a tagged commit; tests passed.
- [ ] Installed on a clean Windows machine; activation works; data survives restart.
- [ ] Backup, restore and a simulated power cut tested on that machine.
- [ ] A4 and thermal prints checked on the client's printers.
- [ ] Opening stock and balances entered and cross-checked against the client's paper records.
- [ ] Client trained; first-week support plan agreed.
