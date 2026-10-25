import { spawnSync } from "node:child_process"
const which = process.argv[2] ? [process.argv[2]] : ["generator", "cloth", "cosmetics", "print", "volume", "busyday", "everything", "dailyuse", "environment", "licenseexpiry", "backuprestore", "cosmeticsday", "profithidden", "meters", "renumberdocs", "designs", "crash"]
let bad = 0
for (const name of which) {
  console.log(`\n=== ${name} ===`)
  const r = spawnSync(process.execPath, [new URL(`./${name}.mjs`, import.meta.url).pathname], { stdio: "inherit" })
  if (r.status !== 0) {
    bad++
    // Shows up on the run summary page, so a failed CI run says which suite broke without opening the log.
    console.log(`::error title=e2e ${name} failed::exit ${r.status ?? r.signal}`)
  }
}
process.exit(bad ? 1 : 0)
