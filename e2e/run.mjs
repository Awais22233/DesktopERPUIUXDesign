import { spawnSync } from "node:child_process"
const which = process.argv[2] ? [process.argv[2]] : ["generator", "cloth", "cosmetics", "print"]
let bad = 0
for (const name of which) {
  console.log(`\n=== ${name} ===`)
  const r = spawnSync(process.execPath, [new URL(`./${name}.mjs`, import.meta.url).pathname], { stdio: "inherit" })
  if (r.status !== 0) bad++
}
process.exit(bad ? 1 : 0)
