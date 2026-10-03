export const money = (n: number) =>
  "Rs. " + n.toLocaleString("en-PK", { maximumFractionDigits: 0 })
export const today = "2025-06-18"
export type Party = {
  id: string
  name: string
  city: string
  phone: string
  balance: number
  limit: number
  status: string
}
export const initialParties: Party[] = [
  {
    id: "PTY-001",
    name: "Al-Madina Fabrics",
    city: "Lahore",
    phone: "0300 4567890",
    balance: 185000,
    limit: 300000,
    status: "Overdue",
  },
  {
    id: "PTY-002",
    name: "Hassan Cloth House",
    city: "Faisalabad",
    phone: "0321 7654321",
    balance: 142500,
    limit: 250000,
    status: "Overdue",
  },
  {
    id: "PTY-003",
    name: "Rehman Traders",
    city: "Multan",
    phone: "0302 1234567",
    balance: 98000,
    limit: 200000,
    status: "Outstanding",
  },
  {
    id: "PTY-004",
    name: "Bismillah Textiles",
    city: "Gujranwala",
    phone: "0333 9876543",
    balance: 76500,
    limit: 150000,
    status: "Outstanding",
  },
  {
    id: "PTY-005",
    name: "Usman Fabric Store",
    city: "Lahore",
    phone: "0301 5556789",
    balance: 0,
    limit: 100000,
    status: "Clear",
  },
  {
    id: "PTY-006",
    name: "New City Cloth",
    city: "Sialkot",
    phone: "0322 4567812",
    balance: 48500,
    limit: 120000,
    status: "Outstanding",
  },
]
export const suppliers: Party[] = [
  {
    id: "SUP-001",
    name: "Gul Ahmed Textile Mills",
    city: "Karachi",
    phone: "021 34567890",
    balance: 285000,
    limit: 500000,
    status: "Outstanding",
  },
  {
    id: "SUP-002",
    name: "Nishat Mills Limited",
    city: "Faisalabad",
    phone: "041 8765432",
    balance: 165000,
    limit: 400000,
    status: "Outstanding",
  },
  {
    id: "SUP-003",
    name: "Al-Karam Textile Mills",
    city: "Karachi",
    phone: "021 33456789",
    balance: 120000,
    limit: 300000,
    status: "Outstanding",
  },
  {
    id: "SUP-004",
    name: "Sapphire Finishing Mills",
    city: "Lahore",
    phone: "042 35789123",
    balance: 0,
    limit: 350000,
    status: "Clear",
  },
]
export type Product = {
  id: string
  name: string
  company: string
  category: string
  article: string
  color: string
  size: number
  stock: number
  cost: number
  rate: number
}
export const initialProducts: Product[] = [
  {
    id: "GA-1042-NV",
    name: "Premium Cotton",
    company: "Gul Ahmed",
    category: "Cotton",
    article: "GA-1042",
    color: "Navy blue",
    size: 30,
    stock: 42,
    cost: 7200,
    rate: 8500,
  },
  {
    id: "NS-2031-WH",
    name: "Wash & Wear",
    company: "Nishat",
    category: "Wash & Wear",
    article: "NS-2031",
    color: "Off white",
    size: 30,
    stock: 8,
    cost: 6500,
    rate: 7800,
  },
  {
    id: "AK-3018-BG",
    name: "Summer Lawn",
    company: "Al-Karam",
    category: "Lawn",
    article: "AK-3018",
    color: "Beige",
    size: 25,
    stock: 5,
    cost: 4900,
    rate: 6200,
  },
  {
    id: "SP-4025-GR",
    name: "Blended Suiting",
    company: "Sapphire",
    category: "Suiting",
    article: "SP-4025",
    color: "Slate gray",
    size: 30,
    stock: 3,
    cost: 8200,
    rate: 9800,
  },
  {
    id: "GA-1048-BK",
    name: "Classic Cotton",
    company: "Gul Ahmed",
    category: "Cotton",
    article: "GA-1048",
    color: "Black",
    size: 30,
    stock: 65,
    cost: 5800,
    rate: 7000,
  },
  {
    id: "NS-2040-BL",
    name: "Royal Dobby",
    company: "Nishat",
    category: "Dobby",
    article: "NS-2040",
    color: "Sky blue",
    size: 25,
    stock: 26,
    cost: 7600,
    rate: 9200,
  },
  {
    id: "AK-3022-PK",
    name: "Printed Lawn",
    company: "Al-Karam",
    category: "Lawn",
    article: "AK-3022",
    color: "Dusty rose",
    size: 25,
    stock: 0,
    cost: 4100,
    rate: 5300,
  },
  {
    id: "SP-4032-BR",
    name: "Winter Khaddar",
    company: "Sapphire",
    category: "Khaddar",
    article: "SP-4032",
    color: "Brown",
    size: 30,
    stock: 32,
    cost: 6200,
    rate: 7500,
  },
]
export type CartItem = {
  productId: string
  name: string
  color: string
  size: number
  qty: number
  rate: number
  discount: number
}
export type Transaction = {
  id: string
  party: string
  date: string
  items: number
  total: number
  paid: number
  method: string
  lines?: CartItem[]
  account?: string
  supplierInvoice?: string
  invoiceDiscount?: number
}
export const initialSales: Transaction[] = [
  {
    id: "INV-1048",
    party: "Al-Madina Fabrics",
    date: today,
    items: 12,
    total: 102000,
    paid: 102000,
    method: "Cash",
  },
  {
    id: "INV-1047",
    party: "Hassan Cloth House",
    date: today,
    items: 8,
    total: 62400,
    paid: 25000,
    method: "Partial",
  },
  {
    id: "INV-1046",
    party: "Rehman Traders",
    date: today,
    items: 6,
    total: 46800,
    paid: 0,
    method: "Credit",
  },
  {
    id: "INV-1045",
    party: "Usman Fabric Store",
    date: today,
    items: 10,
    total: 70000,
    paid: 70000,
    method: "Cash",
  },
  {
    id: "INV-1044",
    party: "Bismillah Textiles",
    date: today,
    items: 4,
    total: 24800,
    paid: 15000,
    method: "Partial",
  },
]
export const initialPurchases: Transaction[] = [
  {
    id: "PUR-0321",
    party: "Gul Ahmed Textile Mills",
    date: today,
    items: 30,
    total: 216000,
    paid: 100000,
    method: "Partial",
  },
  {
    id: "PUR-0320",
    party: "Nishat Mills Limited",
    date: today,
    items: 20,
    total: 130000,
    paid: 130000,
    method: "Bank",
  },
  {
    id: "PUR-0319",
    party: "Al-Karam Textile Mills",
    date: "2025-06-17",
    items: 25,
    total: 122500,
    paid: 0,
    method: "Credit",
  },
]
export type Collection = {
  id: string
  party: string
  amount: number
  method: string
  account: string
  date: string
  time: string
  user: string
  notes: string
}
export const initialCollections: Collection[] = [
  {
    id: "RCV-0248",
    party: "Al-Madina Fabrics",
    amount: 45000,
    method: "Cash",
    account: "Cash in hand",
    date: today,
    time: "11:42 AM",
    user: "Ahmed Ali",
    notes: "Against previous balance",
  },
  {
    id: "RCV-0247",
    party: "Hassan Cloth House",
    amount: 30000,
    method: "Bank",
    account: "Meezan Bank",
    date: today,
    time: "10:35 AM",
    user: "Ahmed Ali",
    notes: "Bank transfer",
  },
  {
    id: "RCV-0246",
    party: "New City Cloth",
    amount: 20000,
    method: "Cash",
    account: "Cash in hand",
    date: today,
    time: "09:50 AM",
    user: "Bilal Khan",
    notes: "",
  },
]
export type Expense = {
  id: string
  category: string
  amount: number
  account: string
  date: string
  notes: string
  user: string
}
export const initialExpenses: Expense[] = [
  {
    id: "EXP-0184",
    category: "Transportation",
    amount: 3500,
    account: "Cash in hand",
    date: today,
    notes: "Delivery to Lahore market",
    user: "Ahmed Ali",
  },
  {
    id: "EXP-0183",
    category: "Utilities",
    amount: 5200,
    account: "Meezan Bank",
    date: today,
    notes: "Electricity bill",
    user: "Ahmed Ali",
  },
  {
    id: "EXP-0182",
    category: "Office supplies",
    amount: 850,
    account: "Cash in hand",
    date: today,
    notes: "Invoice paper and stationery",
    user: "Bilal Khan",
  },
]
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
