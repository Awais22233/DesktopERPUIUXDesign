// The application icon is kept as text (build/icon.png.b64) so it travels through git without binary-file storage.
// This writes build/icon.png, which electron-builder turns into the Windows/Linux icons.
import { readFileSync, writeFileSync } from "node:fs"
const here = new URL("../build/", import.meta.url)
writeFileSync(new URL("icon.png", here), Buffer.from(readFileSync(new URL("icon.png.b64", here), "utf8").trim(), "base64"))
console.log("icon ready")
