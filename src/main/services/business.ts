import { z } from "zod"
import type { DB } from "../db/connection"
import { audit, getSetting, setSetting, tx } from "../db/util"
import type { Business } from "@shared/ipc"

const LOGO = /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/

export const businessSchema = z.object({
  name: z.string().trim().min(1, "Business name is required").max(80, "Business name is too long"),
  tagline: z.string().trim().max(80, "Tagline is too long"),
  owner: z.string().trim().max(60),
  phone: z.string().trim().max(40),
  email: z.string().trim().max(80),
  address: z.string().trim().max(200),
  city: z.string().trim().max(60),
  logo: z.string().max(400_000, "The logo image is too large (maximum about 300 KB)").refine((v) => v === "" || LOGO.test(v), "The logo must be a PNG, JPG, WebP or SVG image"),
  invoiceFooter: z.string().trim().max(200),
  accent: z.enum(["navy", "green", "teal", "purple", "maroon"], { message: "Choose one of the listed colours" }).optional(),
})

const KEYS = ["name", "tagline", "owner", "phone", "email", "address", "city", "logo", "invoiceFooter", "accent"] as const

export function getBusiness(db: DB): Business {
  const out = {} as Business
  for (const k of KEYS) (out as unknown as Record<string, string>)[k] = getSetting(db, `business.${k}`, "")
  if (!businessSchema.shape.accent.safeParse(out.accent).success) out.accent = "navy"
  return out
}

export function setBusiness(db: DB, userId: number | null, input: Business): Business {
  const clean = businessSchema.parse(input)
  const accent = clean.accent ?? getBusiness(db).accent // a caller that does not send a colour keeps the current one
  tx(db, () => {
    for (const k of KEYS) setSetting(db, `business.${k}`, k === "accent" ? accent : clean[k] ?? "")
    audit(db, userId, "business.update", "settings", "business", { name: clean.name })
  })
  return getBusiness(db)
}

/** First activation: use the licensed client name until the owner chooses their own. */
export function ensureBusinessName(db: DB, fallback: string): void {
  if (!getSetting(db, "business.name", "")) setSetting(db, "business.name", fallback)
}
