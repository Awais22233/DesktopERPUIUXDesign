// Builds ONE self-contained html file (library + logic + page) that works offline by double-click.
import { readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const nacl = readFileSync(join(dirname(require.resolve("tweetnacl/package.json")), "nacl-fast.min.js"), "utf8")
const core = readFileSync(join(here, "generator-core.js"), "utf8")
const html = readFileSync(join(here, "license-generator.template.html"), "utf8")
// tweetnacl exposes itself on `self`/`window` when loaded in a page
const out = html.replace("/*NACL*/", () => nacl.replace(/<\/script/gi, "<\\/script")).replace("/*CORE*/", () => core)
writeFileSync(join(here, "license-generator.html"), out)
console.log("Wrote tools/license-generator.html (" + Math.round(out.length / 1024) + " KB)")
