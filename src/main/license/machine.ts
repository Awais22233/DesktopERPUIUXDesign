import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import os from "node:os"

/** Best available stable machine identifier, or "" when none can be read. */
function rawMachineId(): string {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("reg", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"], { encoding: "utf8", windowsHide: true, timeout: 5000 })
      const m = out.match(/MachineGuid\s+REG_SZ\s+(\S+)/i)
      if (m?.[1]) return m[1]
    } else if (process.platform === "darwin") {
      const out = execFileSync("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], { encoding: "utf8", timeout: 5000 })
      const m = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)
      if (m?.[1]) return m[1]
    } else {
      for (const f of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
        if (existsSync(f)) {
          const v = readFileSync(f, "utf8").trim()
          if (v) return v
        }
      }
    }
  } catch {
    /* fall through */
  }
  // Last resort (less stable): host name + first real network adapter.
  const nic = Object.values(os.networkInterfaces())
    .flat()
    .find((n) => n && !n.internal && n.mac && n.mac !== "00:00:00:00:00:00")
  return nic ? `${os.hostname()}|${nic.mac}` : ""
}

/** Formatted like AB12C-D34EF-56789-0ABCD. Derived by hashing, so the raw OS identifier is never shown. */
export function getMachineId(): string {
  const raw = rawMachineId() || "unknown-machine"
  const hex = createHash("sha256").update(`erp-machine:v1:${raw}`).digest("hex").toUpperCase().slice(0, 20)
  return hex.match(/.{5}/g)!.join("-")
}
