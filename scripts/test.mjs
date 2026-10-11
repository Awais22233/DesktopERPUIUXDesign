// Runs the test-suite inside Electron's own Node runtime, so the native SQLite module
// is the exact binary the shipped application uses (one ABI, no rebuild juggling).
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
const electron = require("electron")
const vitest = require.resolve("vitest/vitest.mjs")
const r = spawnSync(electron, [vitest, "run", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
})
process.exit(r.status ?? 1)
