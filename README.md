# Wholesale ERP

Configurable, offline-first desktop ERP / POS for wholesale and retail businesses.
First two configurations: **Cloth Wholesale** and **Cosmetics**. One codebase, one installer per client.

Specification: `docs/SRS_v2_2_Configurable_ERP_POS.pdf`. Architecture: `docs/ARCHITECTURE.md`.

## Commands

| Command | Purpose |
|---|---|
| `pnpm install` | Install dependencies (also rebuilds SQLite for Electron) |
| `pnpm dev` | Run the desktop app with hot reload |
| `pnpm test` | Run the test suite (inside Electron's runtime) |
| `pnpm run typecheck` | Type-check main and renderer |
| `pnpm run build` | Production build into `out/` |
| `pnpm run pack:win` | Build the Windows installer into `release/` (run on Windows or in CI) |

Requires Node 22 and pnpm.
