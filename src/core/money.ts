/**
 * Money is always an integer number of minor units (paisa). 1 PKR = 100.
 * Floating point is never used for stored or computed amounts.
 */
export type Minor = number

export function assertMinor(value: number, label = "amount"): Minor {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a safe integer (minor units), got ${value}`)
  return value
}

/** Parse a user-entered rupee amount like "1,500", "1500.5" into paisa. */
export function parseRupees(input: string | number): Minor {
  const text = String(input).replace(/[,\s]/g, "")
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) throw new RangeError(`Invalid amount: "${input}"`)
  const negative = text.startsWith("-")
  const [whole, frac = ""] = text.replace("-", "").split(".")
  const minor = Number(whole) * 100 + Number(frac.padEnd(2, "0"))
  return assertMinor(negative ? -minor : minor)
}

export function formatRupees(minor: Minor): string {
  assertMinor(minor)
  const negative = minor < 0
  const abs = Math.abs(minor)
  const whole = Math.floor(abs / 100)
  const frac = abs % 100
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  return `${negative ? "-" : ""}${grouped}${frac ? "." + String(frac).padStart(2, "0") : ""}`
}

/** rate (minor per unit) x whole-unit quantity, overflow-checked. */
export function lineAmount(rate: Minor, qty: number): Minor {
  if (!Number.isInteger(qty)) throw new RangeError(`Quantity must be a whole number, got ${qty}`)
  return assertMinor(rate * qty, "line amount")
}

/**
 * Weighted-average cost after adding stock.
 * Result is rounded to the nearest minor unit (half away from zero).
 */
export function weightedAverage(oldQty: number, oldAvg: Minor, addQty: number, addUnitCost: Minor): Minor {
  const totalQty = oldQty + addQty
  if (totalQty <= 0) return addUnitCost
  if (oldQty <= 0) return addUnitCost
  return Math.round((oldQty * oldAvg + addQty * addUnitCost) / totalQty)
}
