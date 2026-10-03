import { sql as m001 } from "./001_foundation"
import { sql as m002 } from "./002_core_business"

export interface Migration {
  id: number
  name: string
  sql: string
}

/** Append-only. Never edit a released migration; add a new one. */
export const migrations: Migration[] = [
  { id: 1, name: "foundation", sql: m001 },
  { id: 2, name: "core_business", sql: m002 },
]
