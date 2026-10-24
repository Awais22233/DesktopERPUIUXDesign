/** Cloth is sold by the meter: a than of `length` meters costs length x rate, rounded to the paisa (same rule as the engine). */
export const fmtM = (m: number) => (Number.isInteger(m) ? String(m) : m.toFixed(1))

/** Price of one than from the price of one meter. Mirrors perThan() in the engine. */
export function thanPrice(ratePerMeter: number, length: number): number {
  return Math.round((Math.round(ratePerMeter * 100) * Math.round(length * 10)) / 10) / 100
}

/** Amount of a bill line before its discount. In the cart a line with a length carries its rate per meter. */
export function lineGross(l: { qty: number; rate: number; length?: number | null }): number {
  return l.length != null ? Math.round(l.qty * thanPrice(l.rate, l.length) * 100) / 100 : l.qty * l.rate
}

export const metersOf = (l: { qty: number; length?: number | null }) => (l.length != null ? Math.round(l.qty * l.length * 10) / 10 : 0)

export interface BillRow {
  name: string
  color: string
  size: string
  /** thans in total and the breakdown "(5 × 28) + (4 × 22)" of a product sold by the meter; empty for ordinary lines */
  parts: { qty: number; length: number }[]
  qty: number
  meters: number
  rateM: number
  rate: number
  discount: number
  amount: number
}

/**
 * One row per product (and rate) on a bill: the client's bill book writes "Lawn Blue  12 thans  (5 × 28) + (4 × 22) + (3 × 20)  288 m  @ 300".
 * Saved bill lines carry the rate per than in `rate` and per meter in `rateM`.
 */
export function billRows(lines: { name: string; color: string; size: string; qty: number; rate: number; rateM?: number; length?: number; discount: number }[]): BillRow[] {
  const out: BillRow[] = []
  const at = new Map<string, BillRow>()
  for (const l of lines) {
    const amount = Math.round((l.qty * l.rate - l.discount) * 100) / 100
    if (!l.length) {
      out.push({ name: l.name, color: l.color, size: l.size, parts: [], qty: l.qty, meters: 0, rateM: 0, rate: l.rate, discount: l.discount, amount })
      continue
    }
    const key = `${l.name}|${l.rateM ?? 0}`
    const row = at.get(key)
    if (row) {
      row.parts.push({ qty: l.qty, length: l.length })
      row.qty += l.qty
      row.meters = Math.round((row.meters + l.qty * l.length) * 10) / 10
      row.discount = Math.round((row.discount + l.discount) * 100) / 100
      row.amount = Math.round((row.amount + amount) * 100) / 100
    } else {
      const fresh: BillRow = { name: l.name, color: l.color, size: l.size, parts: [{ qty: l.qty, length: l.length }], qty: l.qty, meters: Math.round(l.qty * l.length * 10) / 10, rateM: l.rateM ?? 0, rate: l.rate, discount: l.discount, amount }
      at.set(key, fresh)
      out.push(fresh)
    }
  }
  return out
}

export const breakdown = (parts: { qty: number; length: number }[]) => parts.map((p) => `(${p.qty} × ${fmtM(p.length)})`).join(" + ")
