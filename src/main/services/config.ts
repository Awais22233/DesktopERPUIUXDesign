import type { DB } from "../db/connection"
import { AppError } from "@core/errors"
import { audit, getSetting, setSetting, tx } from "../db/util"
import { FLAG_KEYS, isProfileId, profiles, type FlagKey, type Flags, type ProfileId } from "@shared/profiles"

export interface AppConfig {
  profile: ProfileId
  flags: Flags
}

export function getConfig(db: DB): AppConfig {
  const profile = getSetting(db, "profile", "cloth")
  const id: ProfileId = isProfileId(profile) ? profile : "cloth"
  const flags = { ...profiles[id].flags }
  for (const r of db.prepare("SELECT key, enabled FROM feature_flags").all() as { key: string; enabled: number }[]) {
    if ((FLAG_KEYS as string[]).includes(r.key)) flags[r.key as FlagKey] = r.enabled === 1
  }
  return { profile: id, flags }
}

function writeFlags(db: DB, flags: Flags): void {
  for (const k of FLAG_KEYS) {
    db.prepare("INSERT INTO feature_flags(key, enabled) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET enabled = excluded.enabled").run(k, flags[k] ? 1 : 0)
  }
}

/** First run: choose the profile and write its flag presets. Does nothing if already configured. */
export function ensureConfig(db: DB, defaultProfile: ProfileId = "cloth"): AppConfig {
  tx(db, () => {
    if (!db.prepare("SELECT 1 FROM settings WHERE key = 'profile'").get()) {
      setSetting(db, "profile", defaultProfile)
      writeFlags(db, profiles[defaultProfile].flags)
    }
  })
  return getConfig(db)
}

/** Is any data present that depends on this feature? Such a feature cannot be switched off. */
export function featureInUse(db: DB, flag: FlagKey): boolean {
  const has = (sql: string) => db.prepare(sql).get() !== undefined
  switch (flag) {
    case "recovery":
      return has("SELECT 1 FROM payments WHERE kind='customer_receipt' LIMIT 1")
    case "than":
      return has("SELECT 1 FROM variants WHERE size_label IS NOT NULL LIMIT 1")
    case "barcode":
      return has("SELECT 1 FROM variants WHERE barcode IS NOT NULL LIMIT 1")
    case "batch":
    case "expiry":
      return has("SELECT 1 FROM batches LIMIT 1")
    case "wholesalePrice":
      return has("SELECT 1 FROM variants WHERE wholesale_price IS NOT NULL LIMIT 1")
    case "cityWise":
      return has("SELECT 1 FROM parties WHERE city_id IS NOT NULL LIMIT 1")
    default:
      return false
  }
}

export function setFlag(db: DB, userId: number | null, flag: FlagKey, enabled: boolean): AppConfig {
  tx(db, () => {
    if (!enabled && featureInUse(db, flag)) {
      throw new AppError("INVALID_STATE", `"${flag}" cannot be turned off because records already use it`)
    }
    db.prepare("INSERT INTO feature_flags(key, enabled) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET enabled = excluded.enabled").run(flag, enabled ? 1 : 0)
    audit(db, userId, "config.flag", "feature_flag", flag, { enabled })
  })
  return getConfig(db)
}

/** Changing profile re-applies presets, so it is only allowed on an installation with no business data yet. */
export function setProfile(db: DB, userId: number | null, profile: ProfileId): AppConfig {
  tx(db, () => {
    const used = db.prepare("SELECT 1 FROM sales LIMIT 1").get() || db.prepare("SELECT 1 FROM purchases LIMIT 1").get() || db.prepare("SELECT 1 FROM stock_movements LIMIT 1").get()
    if (used) throw new AppError("INVALID_STATE", "The business profile cannot be changed after transactions exist")
    setSetting(db, "profile", profile)
    writeFlags(db, profiles[profile].flags)
    audit(db, userId, "config.profile", "settings", "profile", { profile })
  })
  return getConfig(db)
}
