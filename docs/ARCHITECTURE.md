# Architecture

```
src/
  core/      Pure TypeScript domain rules: money, errors, permissions. No Electron or database imports.
  shared/    Types shared by UI and main: profiles/feature flags, the IPC contract.
  main/      Electron main process
    db/        connection (WAL, synchronous=FULL), migrations, backup engine, helpers
    services/  business operations (sales, purchases, payments, stock, config, auth). Each is one transaction.
    index.ts   startup safety, window, IPC registration, automatic backups
  preload/   The only bridge: a typed, allow-listed `invoke`. No Node access in the UI.
  renderer/  React UI (the approved design). Never touches the database.
tests/       Business-rule tests, run inside Electron's runtime
```

## Rules the code enforces

1. **Transactions are the source of truth.** Balances (customer, supplier, account) are derived with SUM; stock has a cache
   (`stock_levels`) that `stockReconcile()` proves equals the movement history.
2. **One business action = one database transaction.** A failure or power loss leaves no partial record.
3. **Money is integer paisa.** No floating point.
4. **No destructive deletes.** Sales and purchases are voided; every effect is reversed by new entries.
5. **Audit log is append-only** (database triggers reject UPDATE/DELETE).
6. **Feature flags are enforced in the backend**, not only hidden in the UI.
7. **Sensitive actions need explicit permissions** (void, price/discount override, credit-limit override, backdating, stock adjustment).

## Data safety

- SQLite in WAL mode with `synchronous=FULL`.
- Integrity check at every start. Only genuine corruption offers a restore; other errors never touch the data.
- Automatic backup daily and on close, optional second location, 30 kept. A backup is one verified file.
- A backup is always taken before a schema upgrade; failed migrations roll back; databases from a newer version are refused.
- Data lives in the user data folder, outside the install folder.

## Migrations

Append-only list in `src/main/db/migrations`. Never edit a released migration (checksums detect it).

## Not built yet

Sale/purchase returns and exchange, cash closing, stock count, printing (A4 and thermal), city/party reports, the
login screen, and wiring each screen of the UI to these services. See the phase list in the SRS.
