import { createPublicKey, sign, verify, createPrivateKey } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { isProfileId, type ProfileId } from "@shared/profiles"
import type { LicenseState, LicenseStatus } from "@shared/ipc"

/**
 * A license is `ERP1.<payload>.<signature>` (base64url). The payload is signed with an
 * Ed25519 private key that only the vendor holds; the application contains only the public
 * key, so it can verify licenses but can never create one.
 */
export interface LicensePayload {
  v: 1
  id: string
  client: string
  profile: ProfileId
  machineId: string
  issuedAt: string
  expiresAt: string | null
}

export type { LicenseState, LicenseStatus }

const PREFIX = "ERP1"
const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url")

export function normalizeKey(text: string): string {
  return text.replace(/\s+/g, "")
}

/** Used by tests and mirrored by tools/license.mjs. */
export function signLicense(payload: LicensePayload, privateKeyPem: string): string {
  const json = JSON.stringify(payload)
  const sig = sign(null, Buffer.from(json), createPrivateKey(privateKeyPem))
  return `${PREFIX}.${b64u(json)}.${b64u(sig)}`
}

export function parseLicense(keyText: string, publicKeyPem: string): { ok: true; payload: LicensePayload } | { ok: false } {
  try {
    const parts = normalizeKey(keyText).split(".")
    if (parts.length !== 3 || parts[0] !== PREFIX) return { ok: false }
    const json = Buffer.from(parts[1]!, "base64url")
    const sig = Buffer.from(parts[2]!, "base64url")
    if (!verify(null, json, createPublicKey(publicKeyPem), sig)) return { ok: false }
    const p = JSON.parse(json.toString("utf8")) as LicensePayload
    if (p.v !== 1 || typeof p.machineId !== "string" || typeof p.client !== "string" || !isProfileId(p.profile)) return { ok: false }
    return { ok: true, payload: p }
  } catch {
    return { ok: false }
  }
}

export interface EvaluateOptions {
  publicKey: string
  machineId: string
  now: Date
  lastSeen?: Date | null
}

export function evaluateLicense(keyText: string | null, o: EvaluateOptions): LicenseStatus {
  const base = { machineId: o.machineId }
  if (!keyText || !normalizeKey(keyText)) return { ...base, state: "missing", message: "This copy has not been activated yet." }
  const parsed = parseLicense(keyText, o.publicKey)
  if (!parsed.ok) return { ...base, state: "invalid", message: "This license key is not valid. Please check it and try again." }
  const p = parsed.payload
  const info = { client: p.client, profile: p.profile, licenseId: p.id, issuedAt: p.issuedAt, expiresAt: p.expiresAt }
  if (p.machineId !== o.machineId) {
    return { ...base, ...info, state: "wrong_machine", message: "This license was issued for a different computer. Contact your software provider." }
  }
  if (p.expiresAt) {
    if (o.lastSeen && o.now.getTime() < o.lastSeen.getTime() - 24 * 3600 * 1000) {
      return { ...base, ...info, state: "clock_tampered", message: "The computer date looks wrong. Please correct the date and time." }
    }
    if (o.now.getTime() > new Date(p.expiresAt).getTime()) {
      return { ...base, ...info, state: "expired", message: `This license expired on ${p.expiresAt.slice(0, 10)}. Contact your software provider.` }
    }
  }
  return { ...base, ...info, state: "valid", message: "Activated" }
}

const KEY_FILE = "license.key"
const SEEN_FILE = "license.seen"

export function readStoredKey(dir: string): string | null {
  const f = join(dir, KEY_FILE)
  return existsSync(f) ? readFileSync(f, "utf8") : null
}
export function storeKey(dir: string, key: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, KEY_FILE), normalizeKey(key))
}
export function readLastSeen(dir: string): Date | null {
  const f = join(dir, SEEN_FILE)
  if (!existsSync(f)) return null
  const d = new Date(readFileSync(f, "utf8").trim())
  return Number.isNaN(d.getTime()) ? null : d
}
export function touchLastSeen(dir: string, now: Date): void {
  const prev = readLastSeen(dir)
  if (!prev || now > prev) writeFileSync(join(dir, SEEN_FILE), now.toISOString())
}
