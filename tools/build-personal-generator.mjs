#!/usr/bin/env node
// Builds YOUR personal one-file license generator: the private key is inside the file, encrypted with a password,
// so you never have to pick the key file again. The output must stay with you (never commit it or publish it).
//   node tools/build-personal-generator.mjs --key private.pem --out my-generator.html [--password "..."]
// If --password is left out, the environment variable ERP_VAULT_PASSWORD is used.
import { createCipheriv, pbkdf2Sync, randomBytes } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const die = (m) => { console.error("Error: " + m); process.exit(1) }

const keyPath = flag("key") || die("--key <private.pem> is required")
const outPath = flag("out") || die("--out <file.html> is required")
const password = flag("password") ?? process.env.ERP_VAULT_PASSWORD
if (!password || password.length < 8) die("Password must be at least 8 characters (--password or ERP_VAULT_PASSWORD).")

const pem = readFileSync(keyPath, "utf8")
if (!pem.includes("PRIVATE KEY")) die("That file is not a private key.")
const iterations = 600000
const salt = randomBytes(16)
const iv = randomBytes(12)
const key = pbkdf2Sync(password, salt, iterations, 32, "sha256")
const c = createCipheriv("aes-256-gcm", key, iv)
const data = Buffer.concat([c.update(pem, "utf8"), c.final(), c.getAuthTag()]) // WebCrypto expects ciphertext || tag
const vault = { salt: salt.toString("base64"), iv: iv.toString("base64"), iterations, data: data.toString("base64") }

// Start from the standard generator build so the library is always the tested one.
const base = readFileSync(join(here, "license-generator.html"), "utf8")
if (!base.includes("window.ERP_VAULT = null;")) die("Run `node tools/build-generator.mjs` first.")
writeFileSync(outPath, base.replace("window.ERP_VAULT = null;", () => "window.ERP_VAULT = " + JSON.stringify(vault) + ";"))
console.log(`Wrote ${outPath}. Keep it private; it opens only with your password.`)
