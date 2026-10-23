import type { BackupStatus } from "./ipc"

const DAY = 86_400_000

export interface BackupWarning {
  level: "warn" | "info"
  text: string
}

/** Days after which an outside copy is considered missing. */
export const STALE_DAYS = 3

/** What the owner should be told about backups on the dashboard. Pure, so it can be tested. */
export function backupWarnings(st: BackupStatus, now = Date.now()): BackupWarning[] {
  const out: BackupWarning[] = []
  const age = (iso: string | null) => (iso ? (now - new Date(iso).getTime()) / DAY : Infinity)
  const inUseDays = age(st.firstBackupAt)
  if (st.targets.length === 0) {
    if (inUseDays > STALE_DAYS) out.push({ level: "warn", text: "Your backups are only on this computer. If this computer is lost or damaged, the records are lost too. Choose a USB drive or a Google Drive folder for an extra copy." })
  } else {
    const days = age(st.lastExternalOkAt)
    if (days > STALE_DAYS) {
      const where = st.targets.map((t) => t.dir).join(" and ")
      const reason = st.targets.every((t) => !t.available) ? "The drive is not connected." : st.targets.find((t) => t.error)?.error ?? ""
      out.push({ level: "warn", text: `No extra backup copy has been made ${Number.isFinite(days) ? `for ${Math.floor(days)} days` : "yet"} (${where}). ${reason} Connect the drive and press Backup now.`.replace(/\s+/g, " ").trim() })
    }
  }
  if (inUseDays > 30 && age(st.lastTestAt) > 35) out.push({ level: "info", text: "Please check your backups once a month: open Backup & restore and press \"Check my backups now\"." })
  return out
}
