import type { Party, Product, CartItem, Transaction, Collection, Expense } from "@shared/models"

export type { Party, Product, CartItem, Transaction, Collection, Expense }

/** Whole rupees when the amount is whole; otherwise exactly two decimals, so paisa are never rounded away on screen or on a bill. */
export const money = (n: number) => {
  const whole = Math.round(n * 100) % 100 === 0
  return "Rs. " + n.toLocaleString("en-PK", whole ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const localDate = () => new Date().toLocaleDateString("en-CA")
/** The current business date. Replaced by the engine's date as soon as data loads. */
export let today = localDate()
export const setToday = (v: string) => {
  today = v
}

/** Words for the unit of sale. "Than" in a cloth business; "piece" otherwise. Set from the feature flags. */
export const L = { unit: "Than", units: "Thans", size: "Than size", rate: "Rate / Than", perUnit: "per Than" }
export function applyLabels(thanOn: boolean): void {
  if (thanOn) Object.assign(L, { unit: "Than", units: "Thans", size: "Than size", rate: "Rate / Than", perUnit: "per Than" })
  else Object.assign(L, { unit: "Piece", units: "Pieces", size: "Size", rate: "Rate / piece", perUnit: "per piece" })
}

export const reportGroups: Record<string, string[]> = {
  Sales: [
    "Daily Sales",
    "Sales by Customer",
    "Sales by City",
    "Sales by Company",
    "Sales by Article",
    "Sales by User",
  ],
  Purchases: [
    "Purchase Report",
    "Supplier Purchase",
    "Company Purchase",
    "Article Purchase",
  ],
  Inventory: [
    "Current Stock",
    "Stock Movement",
    "Stock Valuation",
    "Low Stock",
    "Out of Stock",
    "Stock Adjustments",
    "Batch Stock",
    "Near Expiry",
    "Expired Items",
  ],
  Parties: [
    "Outstanding Report",
    "Party Statements",
    "Receivable Aging",
    "Party Payments",
    "City-wise Analysis",
  ],
  Suppliers: [
    "Supplier Payables",
    "Supplier Statements",
    "Payable Aging",
    "Supplier Payments",
  ],
  Finance: ["Cash Book", "Bank Book", "Transfers", "Expenses", "Daily Closing"],
  Profitability: [
    "Profit & Loss",
    "Daily Profit",
    "Monthly Profit",
    "Company Profitability",
    "Category Profitability",
    "Customer Profitability",
    "City Profitability",
  ],
}
