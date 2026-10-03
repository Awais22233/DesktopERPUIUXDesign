# Roadmap and quality plan

Status legend: DONE, NEXT, LATER. Order is chosen so the risky financial logic is proven first and every screen is wired to
the real engine (no demo data) before it counts as finished.

## Done
- Engine: SQLite (WAL, full sync), migrations, ledger / stock / cash as transactions, weighted-average costing, void, audit.
- Users, roles, permissions (engine). Profiles and backend-enforced feature flags.
- Backups (daily, on close, second location, verified single file), integrity check at start, safe restore.
- Secure Electron shell, offline fonts, installer pipeline in CI.
- Dynamic business settings (name, tagline, owner, address, logo, invoice footer) stored in the database.
- License system: machine-bound, signed, offline; profile set by license; tamper-hardened build.

## Next (in order)
1. **Real login and first-run setup.** Replace the demo login. After activation: create the owner account. Roles and users
   screen. Every action runs as the logged-in user (audit shows who).
2. **Products and inventory.** Company / Item / Variant screens, than-size label, optional barcode and category, opening
   stock entry, stock adjustment, physical stock count, low-stock.
3. **Parties and suppliers.** Cities, credit limit, WhatsApp, opening balances, ledger statements.
4. **Sales / POS.** Walk-in customer, credit limit modes, discounts, void, invoice.
5. **Purchases and supplier payments.**
6. **Recovery, expenses, cash and bank, daily cash closing.**
7. **Returns and exchange** (rules to be confirmed with each client).
8. **Dashboard and reports** from real data (profit, aging, city-wise, stock valuation).
9. **Printing**: A4 and thermal from one document source; test on the client's actual printer.
10. **Backup and restore screen, health screen, log export, safe update flow.**
11. **Cosmetics profile**: barcode POS, batch and expiry alerts, cosmetics dashboard and reports.
12. **Release hardening**: clean-Windows install test, power-cut drill, large-data performance test, user acceptance test.

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
