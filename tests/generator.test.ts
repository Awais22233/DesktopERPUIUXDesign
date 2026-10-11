import { generateKeyPairSync } from "node:crypto"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { describe, expect, it } from "vitest"
import { evaluateLicense } from "../src/main/license/license"

const require = createRequire(import.meta.url)
const nacl = require("tweetnacl")
// Load the page's core exactly as the browser does (it attaches LicenseCore to the global object).
new Function(readFileSync("tools/generator-core.js", "utf8"))()
const Core = (globalThis as unknown as { LicenseCore: any }).LicenseCore

const pair = () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519")
  return { pub: publicKey.export({ type: "spki", format: "pem" }).toString(), pem: privateKey.export({ type: "pkcs8", format: "pem" }).toString() }
}
const MID = "1AD5C-2124E-2806F-028AD"
const now = new Date()

describe("license generator page", () => {
  it("makes keys the application accepts (same format as the command-line tool)", () => {
    const k = pair()
    const seed = Core.seedFromPem(k.pem)
    const { key, payload } = Core.issue(nacl, seed, { machineId: "1ad5c 2124e-2806f 028ad", client: " Faraz Cloth House ", profile: "cloth", expires: "" })
    expect(payload.machineId).toBe(MID)
    const s = evaluateLicense(key, { publicKey: k.pub, machineId: MID, now })
    expect(s).toMatchObject({ state: "valid", client: "Faraz Cloth House", profile: "cloth", expiresAt: null })
  })
  it("expiry and cosmetics profile carry through; other computers are refused", () => {
    const k = pair()
    const { key } = Core.issue(nacl, Core.seedFromPem(k.pem), { machineId: MID, client: "Glow", profile: "cosmetics", expires: "2030-01-01" })
    expect(evaluateLicense(key, { publicKey: k.pub, machineId: MID, now })).toMatchObject({ state: "valid", profile: "cosmetics" })
    expect(evaluateLicense(key, { publicKey: k.pub, machineId: "AAAAA-BBBBB-CCCCC-DDDDD", now }).state).toBe("wrong_machine")
    expect(evaluateLicense(key, { publicKey: k.pub, machineId: MID, now: new Date("2031-01-01") }).state).toBe("expired")
  })
  it("rejects wrong input with plain messages", () => {
    const k = pair()
    const seed = Core.seedFromPem(k.pem)
    expect(() => Core.issue(nacl, seed, { machineId: "123", client: "x", profile: "cloth" })).toThrow(/20 letters/)
    expect(() => Core.issue(nacl, seed, { machineId: MID, client: "  ", profile: "cloth" })).toThrow(/shop name/)
    expect(() => Core.issue(nacl, seed, { machineId: MID, client: "x", profile: "bad" })).toThrow(/business type/)
    expect(() => Core.seedFromPem("hello")).toThrow(/not/)
    expect(() => Core.seedFromPem(k.pub)).toThrow(/not the license private key/) // a public key file is refused
  })
  it("check() recognises its own keys and rejects keys from another private key", () => {
    const a = pair()
    const b = pair()
    const seedA = Core.seedFromPem(a.pem)
    const { key } = Core.issue(nacl, seedA, { machineId: MID, client: "X", profile: "cloth" })
    expect(Core.check(nacl, seedA, key).ok).toBe(true)
    expect(Core.check(nacl, Core.seedFromPem(b.pem), key).ok).toBe(false)
    expect(Core.check(nacl, seedA, "nonsense").ok).toBe(false)
  })
})
