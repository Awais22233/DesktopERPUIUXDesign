import type { Flags, FlagKey, ProfileId } from "./profiles"

export interface AppConfig {
  profile: ProfileId
  flags: Flags
}
export interface Business {
  name: string
  tagline: string
  owner: string
  phone: string
  email: string
  address: string
  city: string
  /** data: URL of a small PNG/JPG/WebP/SVG, or "" for the default mark. */
  logo: string
  invoiceFooter: string
}

export type LicenseState = "valid" | "missing" | "invalid" | "expired" | "wrong_machine" | "clock_tampered" | "wrong_profile"
export interface LicenseStatus {
  state: LicenseState
  machineId: string
  message: string
  client?: string
  profile?: ProfileId
  licenseId?: string
  issuedAt?: string
  expiresAt?: string | null
}

export interface BackupInfo {
  name: string
  size: number
  modified: string
}

/** Single source of truth for the renderer <-> main contract. */
export interface IpcContract {
  "app:info": { req: undefined; res: { version: string; dataDir: string; schemaVersion: number; packaged: boolean } }
  "config:get": { req: undefined; res: AppConfig }
  "license:status": { req: undefined; res: LicenseStatus }
  "license:activate": { req: { key: string }; res: LicenseStatus }
  "business:get": { req: undefined; res: Business }
  "business:set": { req: Business; res: Business }
  "config:setFlag": { req: { flag: FlagKey; enabled: boolean }; res: AppConfig }
  "backup:run": { req: undefined; res: { name: string } }
  "backup:list": { req: undefined; res: BackupInfo[] }
  "health:get": { req: undefined; res: { integrityOk: boolean; lastBackupAt: string | null; problems: string[] } }
}
export type Channel = keyof IpcContract
export const CHANNELS: Channel[] = ["app:info", "license:status", "license:activate", "business:get", "business:set", "config:get", "config:setFlag", "backup:run", "backup:list", "health:get"]

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }
