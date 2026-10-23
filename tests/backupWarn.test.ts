import { describe, expect, it } from "vitest"
import { backupWarnings } from "../src/shared/backupWarn"
import type { BackupStatus } from "../src/shared/ipc"

const NOW = Date.parse("2026-10-23T10:00:00Z")
const ago = (d: number) => new Date(NOW - d * 86_400_000).toISOString()
const t = (over: Partial<BackupStatus["targets"][number]> = {}) => ({ slot: 1 as const, dir: "E:\\ERP", available: true, lastOkAt: ago(1), error: null, files: 3, bytes: 1, ...over })
const st = (over: Partial<BackupStatus> = {}): BackupStatus => ({ targets: [t()], lastExternalOkAt: ago(1), firstBackupAt: ago(100), lastTestAt: ago(5), ...over })

describe("backup warnings on the dashboard", () => {
  it("says nothing when an outside copy is recent and the check was done", () => {
    expect(backupWarnings(st(), NOW)).toEqual([])
  })
  it("warns when no outside folder is chosen after the shop has used the program for a few days, but not on day one", () => {
    expect(backupWarnings(st({ targets: [], lastExternalOkAt: null, firstBackupAt: ago(1) }), NOW)).toEqual([])
    const w = backupWarnings(st({ targets: [], lastExternalOkAt: null, firstBackupAt: ago(10) }), NOW)
    expect(w[0]!.level).toBe("warn")
    expect(w[0]!.text).toMatch(/only on this computer/)
  })
  it("warns after 3 days without an outside copy and names the reason", () => {
    const w = backupWarnings(st({ lastExternalOkAt: ago(4), targets: [t({ available: false, lastOkAt: ago(4) })] }), NOW)
    expect(w[0]!.text).toMatch(/for 4 days/)
    expect(w[0]!.text).toMatch(/not connected/)
    expect(backupWarnings(st({ lastExternalOkAt: ago(2.5) }), NOW).filter((x) => x.level === "warn")).toEqual([])
  })
  it("a drive that was never used is reported as 'yet'", () => {
    const w = backupWarnings(st({ lastExternalOkAt: null, targets: [t({ lastOkAt: null, error: "The drive is full" })] }), NOW)
    expect(w[0]!.text).toMatch(/yet/)
    expect(w[0]!.text).toMatch(/full/)
  })
  it("reminds about the monthly check only for shops older than a month", () => {
    expect(backupWarnings(st({ lastTestAt: null, firstBackupAt: ago(10) }), NOW)).toEqual([])
    expect(backupWarnings(st({ lastTestAt: ago(40) }), NOW).map((x) => x.level)).toEqual(["info"])
  })
})
