import type { Flags, FlagKey, ProfileId } from "./profiles"

export interface AppConfig {
  profile: ProfileId
  flags: Flags
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
  "config:setProfile": { req: { profile: ProfileId }; res: AppConfig }
  "config:setFlag": { req: { flag: FlagKey; enabled: boolean }; res: AppConfig }
  "backup:run": { req: undefined; res: { name: string } }
  "backup:list": { req: undefined; res: BackupInfo[] }
  "health:get": { req: undefined; res: { integrityOk: boolean; lastBackupAt: string | null; problems: string[] } }
}
export type Channel = keyof IpcContract
export const CHANNELS: Channel[] = ["app:info", "config:get", "config:setProfile", "config:setFlag", "backup:run", "backup:list", "health:get"]

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }
