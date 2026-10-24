import { _electron as electron } from "playwright-core"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const require = createRequire(import.meta.url)
export const root = resolve(new URL("..", import.meta.url).pathname)

/** Starts the built app with a clean data folder and a license signed by a throw-away key. */
export async function launch(profile, client, opts = {}) {
  const work = mkdtempSync(join(tmpdir(), "erp-e2e-"))
  const data = join(work, opts.dataName || "data")
  const shots = process.env.E2E_SHOTS || join(work, "shots")
  mkdirSync(data, { recursive: true })
  mkdirSync(shots, { recursive: true })
  const cli = (env, ...args) => execFileSync(process.execPath, ["tools/license.mjs", ...args], { cwd: root, env: { ...process.env, ...env } }).toString().trim()
  const pubFile = join(work, "publicKey.ts")
  writeFileSync(pubFile, "x")
  const env = { ERP_LICENSE_DIR: join(work, "keys"), ERP_PUBLIC_KEY_FILE: pubFile }
  cli(env, "init")
  const pem = readFileSync(pubFile, "utf8").match(/`(-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----)\n?`/)[1]

  const app = await electron.launch({
    executablePath: require("electron"),
    args: [root, "--no-sandbox", "--disable-gpu"],
    env: { ...process.env, ERP_DATA_DIR: data, ERP_TEST_PUBLIC_KEY: pem, ERP_FORCE_CSP: "1", ERP_NO_DIALOGS: "1", ...(opts.profitHidden ? {} : { ERP_TEST_PROFIT: "1" }) },
  })
  const page = await app.firstWindow()
  page.setDefaultTimeout(8000)
  const problems = []
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message))
  page.on("console", (m) => {
    if (m.type() === "error") problems.push("console: " + m.text())
  })
  await page.waitForSelector("text=Activate your software", { timeout: 25000 })
  const status = await page.evaluate(() => window.api.invoke("license:status"))
  const issueKey = (o = {}) => cli(env, "issue", "--client", client, "--profile", profile, "--machine", status.data.machineId, ...(o.expires ? ["--expires", o.expires] : []))
  const key = issueKey()
  await page.getByPlaceholder("Paste the license key here").fill(key)
  await page.getByRole("button", { name: "Activate" }).click()

  let n = 0
  let failed = 0
  const shot = (name) => page.screenshot({ path: join(shots, `${String(++n).padStart(2, "0")}-${name}.png`) })
  const step = async (name, fn) => {
    try {
      await fn()
      console.log("OK    " + name)
    } catch (e) {
      failed++
      console.log("FAIL  " + name + " :: " + e.message.split("\n").slice(0, 4).join(" | "))
      await shot("FAIL-" + name.replace(/\W+/g, "_")).catch(() => {})
      if (process.env.E2E_DEBUG) console.log((await page.locator("body").innerText().catch(() => "")).slice(0, 2500))
    }
  }
  const nav = (name) => page.locator("aside, nav").getByText(name, { exact: true }).first().click()
  const finish = async () => {
    for (const p of problems) console.log("PROBLEM " + p)
    await app.close().catch(() => {})
    rmSync(work, { recursive: true, force: true })
    if (failed || problems.length) {
      console.log(`\n${failed} step(s) failed, ${problems.length} page problem(s)`)
      process.exit(1)
    }
    console.log("\nAll steps passed with no page errors")
  }
  return { app, page, step, root, issueKey, machineId: status.data.machineId, shot, nav, finish, data, env: { ...process.env, ERP_DATA_DIR: data, ERP_TEST_PUBLIC_KEY: pem, ERP_NO_DIALOGS: "1" }, work }
}
