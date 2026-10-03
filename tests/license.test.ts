import { generateKeyPairSync } from "node:crypto"
import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { evaluateLicense, normalizeKey, readLastSeen, readStoredKey, signLicense, storeKey, touchLastSeen, type LicensePayload } from "../src/main/license/license"
import { getMachineId } from "../src/main/license/machine"
import { tempDir } from "./helpers"

const pair = () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519")
  return { pub: publicKey.export({ type: "spki", format: "pem" }).toString(), priv: privateKey.export({ type: "pkcs8", format: "pem" }).toString() }
}
const MID = "AAAAA-BBBBB-CCCCC-DDDDD"
const payload = (o: Partial<LicensePayload> = {}): LicensePayload => ({ v: 1, id: "LIC-1", client: "Raza Textiles", profile: "cloth", machineId: MID, issuedAt: "2026-10-01T00:00:00Z", expiresAt: null, ...o })
const now = new Date("2026-10-03T00:00:00Z")

describe("license verification", () => {
  const k = pair()
  const opts = { publicKey: k.pub, machineId: MID, now }

  it("accepts a correctly signed license for this machine and carries client + profile", () => {
    const s = evaluateLicense(signLicense(payload(), k.priv), opts)
    expect(s).toMatchObject({ state: "valid", client: "Raza Textiles", profile: "cloth" })
  })
  it("tolerates whitespace and line breaks from copy and paste", () => {
    const key = signLicense(payload(), k.priv)
    const messy = `  ${key.slice(0, 40)}\n${key.slice(40, 90)} \r\n${key.slice(90)}  `
    expect(normalizeKey(messy)).toBe(key)
    expect(evaluateLicense(messy, opts).state).toBe("valid")
  })
  it("rejects a license issued for another computer (cannot be shared)", () => {
    const key = signLicense(payload({ machineId: "11111-22222-33333-44444" }), k.priv)
    expect(evaluateLicense(key, opts).state).toBe("wrong_machine")
  })
  it("rejects edited payloads and signatures from a different key", () => {
    const key = signLicense(payload({ profile: "cloth" }), k.priv)
    const [pre, body, sig] = key.split(".")
    const edited = Buffer.from(JSON.stringify({ ...payload(), profile: "cosmetics" })).toString("base64url")
    expect(evaluateLicense(`${pre}.${edited}.${sig}`, opts).state).toBe("invalid")
    expect(evaluateLicense(signLicense(payload(), pair().priv), opts).state).toBe("invalid")
    expect(evaluateLicense("garbage", opts).state).toBe("invalid")
    expect(evaluateLicense(null, opts).state).toBe("missing")
    expect(evaluateLicense("  ", opts).state).toBe("missing")
    void body
  })
  it("supports an optional expiry and notices the clock being turned back", () => {
    const key = signLicense(payload({ expiresAt: "2026-12-31T23:59:59Z" }), k.priv)
    expect(evaluateLicense(key, opts).state).toBe("valid")
    expect(evaluateLicense(key, { ...opts, now: new Date("2027-01-02T00:00:00Z") }).state).toBe("expired")
    expect(evaluateLicense(key, { ...opts, lastSeen: new Date("2026-12-20T00:00:00Z") }).state).toBe("clock_tampered")
    // a perpetual license is not affected by the clock
    expect(evaluateLicense(signLicense(payload(), k.priv), { ...opts, lastSeen: new Date("2030-01-01T00:00:00Z") }).state).toBe("valid")
  })
})

describe("storage and machine id", () => {
  it("stores the key and only ever moves the last-seen time forward", () => {
    const dir = join(tempDir(), "x")
    expect(readStoredKey(dir)).toBeNull()
    storeKey(dir, "ERP1.a b\n.c")
    expect(readStoredKey(dir)).toBe("ERP1.a.b.c".replace("a.b", "ab").replace("ab.c", "ab.c"))
    mkdirSync(dir, { recursive: true })
    touchLastSeen(dir, new Date("2026-10-05T00:00:00Z"))
    touchLastSeen(dir, new Date("2026-10-01T00:00:00Z"))
    expect(readLastSeen(dir)?.toISOString()).toBe("2026-10-05T00:00:00.000Z")
  })
  it("machine id is stable and well-formed", () => {
    expect(getMachineId()).toMatch(/^[0-9A-F]{5}(-[0-9A-F]{5}){3}$/)
    expect(getMachineId()).toBe(getMachineId())
  })
})

describe("vendor CLI", () => {
  it("issues keys that the application verifies, and refuses to overwrite the private key", () => {
    const dir = tempDir()
    const pubFile = join(dir, "publicKey.ts")
    writeFileSync(pubFile, "x")
    const env = { ...process.env, ERP_LICENSE_DIR: join(dir, "keys"), ERP_PUBLIC_KEY_FILE: pubFile, ELECTRON_RUN_AS_NODE: "1" }
    const run = (...a: string[]) => spawnSync(process.execPath, ["tools/license.mjs", ...a], { env, encoding: "utf8" })

    expect(run("init").status).toBe(0)
    expect(run("init").status).toBe(1) // protection against invalidating all licenses
    const pem = readFileSync(pubFile, "utf8").match(/`(-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----)\n?`/)![1]!

    const r = run("issue", "--client", "Glow Cosmetics", "--profile", "cosmetics", "--machine", MID, "--expires", "2030-01-01")
    expect(r.status).toBe(0)
    const s = evaluateLicense(r.stdout.trim(), { publicKey: pem, machineId: MID, now })
    expect(s).toMatchObject({ state: "valid", client: "Glow Cosmetics", profile: "cosmetics" })
    expect(readFileSync(join(dir, "keys", "issued.log"), "utf8")).toContain("Glow Cosmetics")
    expect(run("issue", "--client", "X", "--profile", "cloth", "--machine", "bad").status).toBe(1)
    expect(JSON.parse(run("inspect", r.stdout.trim()).stdout).signatureValid).toBe(true)
  })
})
