import { _electron as electron } from "playwright-core"
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { root } from "./lib.mjs"

const require = createRequire(import.meta.url)
const work = mkdtempSync(join(tmpdir(), "erp-gen-"))
// a throw-away keypair made by the command-line tool
const env = { ...process.env, ERP_LICENSE_DIR: join(work, "keys"), ERP_PUBLIC_KEY_FILE: join(work, "pub.ts") }
writeFileSync(env.ERP_PUBLIC_KEY_FILE, "x")
execFileSync(process.execPath, ["tools/license.mjs", "init"], { cwd: root, env })
const pem = join(work, "keys", "private.pem")

const app = await electron.launch({ executablePath: require("electron"), args: [join(root, "e2e/htmlmain.cjs"), "--no-sandbox", "--disable-gpu"], env: { ...process.env, HTML_FILE: join(root, "tools/license-generator.html") } })
const page = await app.firstWindow()
page.setDefaultTimeout(8000)
const errors = []
page.on("pageerror", (e) => errors.push(e.message))
let failed = 0
const step = async (n, f) => { try { await f(); console.log("OK    " + n) } catch (e) { failed++; console.log("FAIL  " + n + " :: " + e.message.split("\n")[0]) } }

await step("a wrong file is refused", async () => {
  const bad = join(work, "bad.pem"); writeFileSync(bad, "not a key")
  await page.setInputFiles("#pem", bad)
  await page.waitForSelector("text=/not a license key|not the license private key/")
})
await step("the real key file is accepted and shows a fingerprint", async () => {
  await page.setInputFiles("#pem", pem)
  await page.waitForSelector("text=Fingerprint")
})
await step("the Computer ID is formatted as you type", async () => {
  await page.fill("#machine", "1ad5c2124e2806f028ad")
  if ((await page.inputValue("#machine")) !== "1AD5C-2124E-2806F-028AD") throw new Error("not formatted")
})
await step("generate a key", async () => {
  await page.fill("#client", "Faraz Cloth House")
  await page.selectOption("#profile", "cloth")
  await page.click("#generate")
  await page.waitForSelector("text=Key ban gayi")
})
await step("the generated key is accepted by the real application's checker", async () => {
  const key = await page.inputValue("#key")
  const out = execFileSync(process.execPath, ["tools/license.mjs", "inspect", key], { cwd: root, env }).toString()
  const j = JSON.parse(out)
  if (!j.signatureValid || j.payload.client !== "Faraz Cloth House" || j.payload.machineId !== "1AD5C-2124E-2806F-028AD") throw new Error("key not accepted: " + out)
})
await step("it appears in the issued list and can be checked", async () => {
  await page.waitForSelector("#history >> text=Faraz Cloth House")
  await page.locator("summary").click()
  await page.fill("#checkKey", await page.inputValue("#key"))
  await page.click("#checkBtn")
  await page.waitForSelector("text=/Theek hai: Faraz Cloth House/")
})
await step("bad input shows a plain message and no key", async () => {
  await page.fill("#machine", "123")
  await page.click("#generate")
  await page.waitForSelector("text=/20 letters/")
})

// ---- the personal, password-locked build (key inside the file) ----
const personal = join(work, "personal.html")
execFileSync(process.execPath, ["tools/build-personal-generator.mjs", "--key", pem, "--out", personal, "--password", "correct horse 42"], { cwd: root, env })
await step("the personal file contains no readable private key", async () => {
  const html = readFileSync(personal, "utf8")
  const seedB64 = readFileSync(pem, "utf8").split("\n").filter((l) => l && !l.includes("-----"))[0]
  if (html.includes(seedB64) || html.includes("PRIVATE KEY-----\n")) throw new Error("key is readable inside the file")
})
const app2 = await electron.launch({ executablePath: require("electron"), args: [join(root, "e2e/htmlmain.cjs"), "--no-sandbox", "--disable-gpu"], env: { ...process.env, HTML_FILE: personal } })
const p2 = await app2.firstWindow()
p2.setDefaultTimeout(8000)
p2.on("pageerror", (e) => { console.log("PAGE ERROR " + e.message); failed++ })
await step("personal: asks for a password, no file picker", async () => {
  await p2.waitForSelector("#vaultPass")
  if (await p2.locator("#pem").isVisible()) throw new Error("file picker is visible")
})
await step("personal: wrong password is refused and the form stays locked", async () => {
  await p2.fill("#vaultPass", "wrong password")
  await p2.click("#unlock")
  await p2.waitForSelector("text=Password galat hai")
  if ((await p2.locator("#formCard").evaluate((e) => e.style.pointerEvents)) !== "none") throw new Error("form unlocked")
})
await step("personal: right password unlocks with the same fingerprint", async () => {
  await p2.fill("#vaultPass", "correct horse 42")
  await p2.click("#unlock")
  await p2.waitForSelector("text=Fingerprint")
  const f1 = (await page.locator("#keyStatus").innerText()).match(/Fingerprint: (\S+)/)[1]
  const f2 = (await p2.locator("#keyStatus").innerText()).match(/Fingerprint: (\S+)/)[1]
  if (f1 !== f2) throw new Error("fingerprint differs: " + f1 + " vs " + f2)
})
await step("personal: generated key is accepted by the real checker", async () => {
  await p2.fill("#machine", "1ad5c2124e2806f028ad")
  await p2.fill("#client", "Personal Test")
  await p2.click("#generate")
  await p2.waitForSelector("text=Key ban gayi")
  const out = execFileSync(process.execPath, ["tools/license.mjs", "inspect", await p2.inputValue("#key")], { cwd: root, env }).toString()
  if (!JSON.parse(out).signatureValid) throw new Error("not valid: " + out)
})
await app2.close()
for (const e of errors) { console.log("PAGE ERROR " + e); failed++ }
await page.screenshot({ path: join(work, "page.png") })
console.log("screenshot " + join(work, "page.png"))
await app.close()
process.exit(failed ? 1 : 0)
