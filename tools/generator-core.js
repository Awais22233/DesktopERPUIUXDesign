/* License generator core. Pure functions, no DOM. Runs in the browser page and in the tests. */
(function (root) {
  "use strict"
  const enc = new TextEncoder()
  const toB64u = (bytes) => {
    let s = ""
    for (const b of bytes) s += String.fromCharCode(b)
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  }
  const fromB64 = (b64) => {
    const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/"))
    return Uint8Array.from(bin, (c) => c.charCodeAt(0))
  }
  const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase()

  // An Ed25519 private key in PKCS#8 form is a fixed 16-byte header followed by the 32-byte seed.
  const PKCS8_PREFIX = "302e020100300506032b657004220420"

  function seedFromPem(pem) {
    const body = String(pem).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")
    let der
    try {
      der = fromB64(body)
    } catch {
      throw new Error("This is not a license key file.")
    }
    if (der.length !== 48 || hex(der.subarray(0, 16)).toLowerCase() !== PKCS8_PREFIX) throw new Error("This is not the license private key file.")
    return der.subarray(16)
  }

  function normalizeMachineId(text) {
    const t = String(text).toUpperCase().replace(/[^0-9A-F]/g, "")
    if (t.length !== 20) throw new Error("The Computer ID must have 20 letters/numbers, like 1AD5C-2124E-2806F-028AD.")
    return t.match(/.{5}/g).join("-")
  }

  function issue(nacl, seed, o) {
    const client = String(o.client || "").trim()
    if (!client) throw new Error("Enter the client / shop name.")
    if (!["cloth", "cosmetics"].includes(o.profile)) throw new Error("Choose the business type.")
    const machineId = normalizeMachineId(o.machineId)
    let expiresAt = null
    if (o.expires) {
      const d = new Date(o.expires + "T23:59:59Z")
      if (Number.isNaN(d.getTime())) throw new Error("The expiry date is not valid.")
      expiresAt = d.toISOString()
    }
    const rnd = new Uint8Array(4)
    ;(root.crypto || globalThis.crypto).getRandomValues(rnd)
    const payload = { v: 1, id: "LIC-" + hex(rnd), client, profile: o.profile, machineId, issuedAt: new Date().toISOString(), expiresAt }
    const json = JSON.stringify(payload)
    const secret = nacl.sign.keyPair.fromSeed(seed).secretKey
    const sig = nacl.sign.detached(enc.encode(json), secret)
    return { key: `ERP1.${toB64u(enc.encode(json))}.${toB64u(sig)}`, payload }
  }

  function check(nacl, seed, keyText) {
    const parts = String(keyText).replace(/\s+/g, "").split(".")
    if (parts.length !== 3 || parts[0] !== "ERP1") return { ok: false, reason: "This does not look like a license key." }
    const json = fromB64(parts[1])
    const pub = nacl.sign.keyPair.fromSeed(seed).publicKey
    const valid = nacl.sign.detached.verify(json, fromB64(parts[2]), pub)
    let payload = null
    try {
      payload = JSON.parse(new TextDecoder().decode(json))
    } catch {}
    return valid && payload ? { ok: true, payload } : { ok: false, reason: "The signature does not match your private key." }
  }

  /** Short fingerprint of the public key, to confirm you loaded the right private key file. */
  function fingerprint(nacl, seed) {
    return hex(nacl.sign.keyPair.fromSeed(seed).publicKey).slice(0, 16).match(/.{4}/g).join("-")
  }

  root.LicenseCore = { seedFromPem, normalizeMachineId, issue, check, fingerprint }
})(typeof window !== "undefined" ? window : globalThis)
