import { sql as m001 } from "./001_foundation"
import { sql as m002 } from "./002_core_business"
import { sql as m003 } from "./003_returns_closing_count"
import { sql as m004 } from "./004_product_image"
import { sql as m005 } from "./005_colour_library"
import { sql as m006 } from "./006_meter_thans"

export interface Migration {
  id: number
  name: string
  sql: string
}

/** Append-only. Never edit a released migration; add a new one. */
export const migrations: Migration[] = [
  { id: 1, name: "foundation", sql: m001 },
  { id: 2, name: "core_business", sql: m002 },
  { id: 3, name: "returns_closing_count", sql: m003 },
  { id: 4, name: "product_image", sql: m004 },
  { id: 5, name: "colour_library", sql: m005 },
  { id: 6, name: "meter_thans", sql: m006 },
]
