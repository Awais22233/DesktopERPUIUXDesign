import { useCallback, useEffect, useRef, useState } from "react"
import { useConfig, type FlagKey } from "./config"
import { BrandMark, nameParts, useBusiness } from "./business"
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Database,
  Download,
  FileBarChart,
  FileText,
  HardDrive,
  History,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  PanelLeftClose,
  Plus,
  Printer,
  Receipt,
  RotateCcw,
  Search,
  Settings2,
  Shield,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  SlidersHorizontal,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react"
import Dashboard from "./Dashboard"
import { Backup, Reports, Returns, Settings, Summary } from "./Management"
import {
  EntryForm,
  InvoicePreview,
  PartyDetails,
  SalesWorkspace,
  StockDetails,
} from "./Workflows"
import {
  Select,
  Action,
  Heading,
  Input,
  Textarea,
  Badge,
  Button,
  DataTable,
  ExportButton,
  Field,
  Modal,
  PageHeading,
  Panel,
  SearchBox,
  Tabs,
  Toast,
  downloadFile,
} from "./ui"
import {
  initialCollections,
  initialExpenses,
  initialParties,
  initialProducts,
  initialPurchases,
  initialSales,
  money,
  suppliers as initialSuppliers,
  today,
  type Collection,
  type Expense,
  type Party,
  type Product,
  type Transaction,
} from "./data"

type Movement = {
  id: string
  date: string
  type: string
  quantity: number
  productId: string
  reason: string
}
type AccountEntry = {
  id: string
  date: string
  account: string
  description: string
  incoming: number
  outgoing: number
  type: string
}
type User = {
  id: string
  name: string
  username: string
  role: string
  status: string
  activity: string
}
type Audit = {
  id: string
  date: string
  action: string
  detail: string
  user: string
}
type Store = {
  version: number
  parties: Party[]
  suppliers: Party[]
  products: Product[]
  sales: Transaction[]
  purchases: Transaction[]
  collections: Collection[]
  expenses: Expense[]
  movements: Movement[]
  accounts: Record<string, number>
  entries: AccountEntry[]
  users: User[]
  audits: Audit[]
  returns: {
    id: string
    original: string
    type: string
    total: number
    date: string
  }[]
  permissions: Record<string, boolean>
}
function seedTransactions(rows: Transaction[], ids: string[]) {
  return rows.map((r, i) => {
    const p = initialProducts.find((p) => p.id === ids[i])!
    return {
      ...r,
      lines: [
        {
          productId: p.id,
          name: p.name,
          color: p.color,
          size: p.size,
          qty: r.items,
          rate: r.total / r.items,
          discount: 0,
        },
      ],
    }
  })
}
const initialStore: Store = {
  version: 1,
  parties: initialParties,
  suppliers: initialSuppliers,
  products: initialProducts,
  sales: seedTransactions(initialSales, [
    "GA-1042-NV",
    "NS-2031-WH",
    "NS-2031-WH",
    "GA-1048-BK",
    "AK-3018-BG",
  ]),
  purchases: seedTransactions(initialPurchases, [
    "GA-1042-NV",
    "NS-2031-WH",
    "AK-3018-BG",
  ]),
  collections: initialCollections,
  expenses: initialExpenses,
  movements: initialProducts.map((p) => ({
    id: "OPEN-" + p.article,
    date: "2025-06-01",
    type: "Opening stock",
    quantity: p.stock,
    productId: p.id,
    reason: "Opening inventory",
  })),
  accounts: {
    "Cash in hand": 248650,
    "Meezan Bank": 625000,
    "HBL Business": 185000,
  },
  entries: [
    {
      id: "RCV-0248",
      date: today,
      account: "Cash in hand",
      description: "Al-Madina Fabrics · Collection",
      incoming: 45000,
      outgoing: 0,
      type: "Recovery",
    },
    {
      id: "RCV-0247",
      date: today,
      account: "Meezan Bank",
      description: "Hassan Cloth House · Collection",
      incoming: 30000,
      outgoing: 0,
      type: "Recovery",
    },
    {
      id: "EXP-0184",
      date: today,
      account: "Cash in hand",
      description: "Delivery to Lahore market",
      incoming: 0,
      outgoing: 3500,
      type: "Expense",
    },
    {
      id: "INV-1048",
      date: today,
      account: "Cash in hand",
      description: "Al-Madina Fabrics · Sale",
      incoming: 102000,
      outgoing: 0,
      type: "Sale",
    },
  ],
  users: [
    {
      id: "USR-001",
      name: "Ahmed Ali",
      username: "ahmed.admin",
      role: "Owner / Admin",
      status: "Active",
      activity: "Now",
    },
    {
      id: "USR-002",
      name: "Bilal Khan",
      username: "bilal.sales",
      role: "Sales User",
      status: "Active",
      activity: "10 minutes ago",
    },
    {
      id: "USR-003",
      name: "Usman Raza",
      username: "usman.accounts",
      role: "Accountant",
      status: "Active",
      activity: "1 hour ago",
    },
    {
      id: "USR-004",
      name: "Ali Hassan",
      username: "ali.store",
      role: "Store Manager",
      status: "Active",
      activity: "2 hours ago",
    },
    {
      id: "USR-005",
      name: "Waqas Ahmed",
      username: "waqas.recovery",
      role: "Recovery Staff",
      status: "Inactive",
      activity: "Yesterday",
    },
  ],
  audits: [
    {
      id: "LOG-001",
      date: today + " 09:00",
      action: "Workspace opened",
      detail: "Business day started",
      user: "Ahmed Ali",
    },
  ],
  returns: [],
  permissions: {},
}
const navGroups: {
  label: string
  items: {
    title: string
    icon: LucideIcon
    shortcut?: string
    flag?: FlagKey
  }[]
}[] = [
  {
    label: "WORKSPACE",
    items: [
      { title: "Dashboard", icon: LayoutDashboard },
      { title: "POS / Sales", icon: ShoppingCart, shortcut: "F2" },
      { title: "Customers", icon: Users },
      { title: "Recovery", icon: Wallet, flag: "recovery" },
      { title: "Purchases", icon: ShoppingBag },
      { title: "Suppliers", icon: Building2 },
      { title: "Inventory", icon: Package },
      { title: "Returns", icon: RotateCcw },
    ],
  },
  {
    label: "FINANCE",
    items: [
      { title: "Expenses", icon: Receipt },
      { title: "Cash & Bank", icon: Landmark },
      { title: "Reports", icon: FileBarChart },
    ],
  },
  {
    label: "ADMINISTRATION",
    items: [
      { title: "Users & Permissions", icon: ShieldCheck },
      { title: "Settings", icon: Settings2 },
    ],
  },
]
const roles = [
  "Owner / Admin",
  "Sales User",
  "Accountant",
  "Store Manager",
  "Recovery Staff",
  "Viewer",
]
function isValidStore(value: unknown): value is Store {
  if (!value || typeof value !== "object") return false
  const s = value as Store
  return (
    s.version === 1 &&
    [
      "parties",
      "suppliers",
      "products",
      "sales",
      "purchases",
      "collections",
      "expenses",
      "movements",
      "entries",
      "users",
      "audits",
      "returns",
    ].every((k) =>
      Array.isArray((s as unknown as Record<string, unknown>)[k]),
    ) &&
    !!s.accounts &&
    typeof s.accounts === "object" &&
    Object.values(s.accounts).every(
      (v) => typeof v === "number" && Number.isFinite(v),
    ) &&
    s.products.every(
      (p) =>
        typeof p.id === "string" &&
        typeof p.name === "string" &&
        typeof p.stock === "number",
    ) &&
    s.parties.every(
      (p) => typeof p.name === "string" && typeof p.balance === "number",
    ) &&
    !!s.permissions
  )
}

const pageFlags: Record<string, FlagKey> = { Recovery: "recovery" }

export default function App() {
  const { isEnabled } = useConfig()
  const { business } = useBusiness()
  const [store, setStore] = useState<Store>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("raza-workspace") || "null")
      return isValidStore(saved) ? saved : initialStore
    } catch {
      return initialStore
    }
  })
  const [page, setPage] = useState("Dashboard")
  const [modal, setModal] = useState<{
    type: string
    data?: unknown
  } | null>(null)
  const [toast, setToast] = useState("")
  const [collapsed, setCollapsed] = useState(false)
  const [globalSearch, setGlobalSearch] = useState("")
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState("All statuses")
  const [report, setReport] = useState("")
  const [userTab, setUserTab] = useState("Users")
  const [role, setRole] = useState("Sales User")
  const [accountTab, setAccountTab] = useState("Overview")
  const [lastBackup, setLastBackup] = useState(
    () => localStorage.getItem("raza-last-backup") || "",
  )
  const [loggedIn, setLoggedIn] = useState(true)
  const [pendingRestore, setPendingRestore] = useState<Store | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const notify = useCallback((message: string) => setToast(message), [])
  const closeToast = useCallback(() => setToast(""), [])
  const closeModal = useCallback(() => setModal(null), [])
  const open = (type: string, data?: unknown) => setModal({ type, data })
  const audit = (action: string, detail: string): Audit => ({
    id: "LOG-" + Date.now(),
    date:
      today +
      " " +
      new Date().toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    action,
    detail,
    user: "Ahmed Ali",
  })
  const navigate = (next: string) => {
    if (pageFlags[next] && !isEnabled(pageFlags[next])) return
    if (next === "Sales Report") {
      setReport("Daily Sales")
      setPage("Reports")
    } else {
      setPage(next)
      if (next === "Reports") setReport("")
    }
    setQuery("")
    setFilter("All statuses")
    setGlobalSearch("")
    setModal(null)
    window.scrollTo(0, 0)
  }
  useEffect(() => {
    try {
      localStorage.setItem("raza-workspace", JSON.stringify(store))
    } catch {
      notify(
        "Local storage is unavailable. Download a backup to protect your changes.",
      )
    }
  }, [store, notify])
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault()
        navigate("POS / Sales")
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])
  function saveTransaction(
    transaction: Transaction,
    print: boolean,
    purchase = false,
  ) {
    const account = transaction.account || "Cash in hand"
    if (purchase && transaction.paid > store.accounts[account]) {
      notify("Insufficient balance in the selected account.")
      return false
    }
    setStore((s) => ({
      ...s,
      [purchase ? "purchases" : "sales"]: [
        transaction,
        ...(purchase ? s.purchases : s.sales),
      ],
      [purchase ? "suppliers" : "parties"]: (purchase
        ? s.suppliers
        : s.parties
      ).map((p) =>
        p.name === transaction.party
          ? {
              ...p,
              balance: p.balance + transaction.total - transaction.paid,
              status:
                transaction.total > transaction.paid ? "Outstanding" : p.status,
            }
          : p,
      ),
      products: s.products.map((p) => {
        const line = transaction.lines?.find((l) => l.productId === p.id)
        return line
          ? {
              ...p,
              stock: p.stock + line.qty * (purchase ? 1 : -1),
              cost: purchase
                ? (p.cost * p.stock + line.rate * line.qty) /
                  (p.stock + line.qty)
                : p.cost,
            }
          : p
      }),
      accounts: {
        ...s.accounts,
        [account]: s.accounts[account] + transaction.paid * (purchase ? -1 : 1),
      },
      entries: transaction.paid
        ? [
            {
              id: transaction.id,
              date: transaction.date,
              account,
              description: transaction.party,
              incoming: purchase ? 0 : transaction.paid,
              outgoing: purchase ? transaction.paid : 0,
              type: purchase ? "Purchase" : "Sale",
            },
            ...s.entries,
          ]
        : s.entries,
      movements: [
        ...(transaction.lines || []).map((l) => ({
          id: transaction.id,
          date: transaction.date,
          type: purchase ? "Purchase" : "Sale",
          quantity: l.qty * (purchase ? 1 : -1),
          productId: l.productId,
          reason: transaction.party,
        })),
        ...s.movements,
      ],
      audits: [
        audit(
          purchase ? "Purchase saved" : "Sale saved",
          transaction.id + " · " + money(transaction.total),
        ),
        ...s.audits,
      ],
    }))
    notify(
      `${
        purchase ? "Purchase" : "Sale"
      } ${transaction.id} saved. Stock and balances updated.`,
    )
    if (print) open("invoice", transaction)
    return true
  }
  function submitEntry(data: Record<string, string>) {
    const type = modal?.type
    const id = Date.now().toString().slice(-6)
    if (type === "recovery" || type === "supplier-payment") {
      const supplier = type === "supplier-payment"
      const party = (supplier ? store.suppliers : store.parties).find(
        (p) => p.id === data.partyId,
      )!
      const amount = +data.amount
      if (supplier && store.accounts[data.account] < amount)
        return notify("Insufficient balance in this account.")
      const collection: Collection = {
        id: "RCV-" + id,
        party: party.name,
        amount,
        method: data.method,
        account: data.account,
        date: data.date,
        time: new Date().toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        user: "Ahmed Ali",
        notes: data.notes,
      }
      setStore((s) => ({
        ...s,
        [supplier ? "suppliers" : "parties"]: (supplier
          ? s.suppliers
          : s.parties
        ).map((p) =>
          p.id === party.id
            ? {
                ...p,
                balance: p.balance - amount,
                status: p.balance - amount <= 0 ? "Clear" : "Outstanding",
              }
            : p,
        ),
        collections: supplier ? s.collections : [collection, ...s.collections],
        accounts: {
          ...s.accounts,
          [data.account]:
            s.accounts[data.account] + amount * (supplier ? -1 : 1),
        },
        entries: [
          {
            id: collection.id,
            date: data.date,
            account: data.account,
            description: party.name,
            incoming: supplier ? 0 : amount,
            outgoing: supplier ? amount : 0,
            type: supplier ? "Supplier payment" : "Recovery",
          },
          ...s.entries,
        ],
        audits: [
          audit("Payment saved", party.name + " · " + money(amount)),
          ...s.audits,
        ],
      }))
      notify("Payment saved. Party balance updated.")
      open("receipt", collection)
    } else if (type === "expense") {
      if (+data.amount > store.accounts[data.account])
        return notify("Insufficient balance in this account.")
      const expense: Expense = {
        id: "EXP-" + id,
        category: data.category,
        amount: +data.amount,
        account: data.account,
        date: data.date,
        notes: data.notes,
        user: "Ahmed Ali",
      }
      setStore((s) => ({
        ...s,
        expenses: [expense, ...s.expenses],
        accounts: {
          ...s.accounts,
          [data.account]: s.accounts[data.account] - expense.amount,
        },
        entries: [
          {
            id: expense.id,
            date: data.date,
            account: data.account,
            description: data.notes || data.category,
            incoming: 0,
            outgoing: expense.amount,
            type: "Expense",
          },
          ...s.entries,
        ],
        audits: [
          audit("Expense saved", data.category + " · " + money(expense.amount)),
          ...s.audits,
        ],
      }))
      closeModal()
      notify("Expense saved and account balance updated.")
    } else if (type === "adjust") {
      const product = store.products.find((p) => p.id === data.productId)!
      setStore((s) => ({
        ...s,
        products: s.products.map((p) =>
          p.id === data.productId
            ? { ...p, stock: p.stock + +data.quantity }
            : p,
        ),
        movements: [
          {
            id: "ADJ-" + id,
            date: data.date,
            type: "Adjustment",
            quantity: +data.quantity,
            productId: data.productId,
            reason: data.reason + (data.notes ? " · " + data.notes : ""),
          },
          ...s.movements,
        ],
        audits: [
          audit(
            "Stock adjusted",
            product.name + " · " + data.quantity + " Thans",
          ),
          ...s.audits,
        ],
      }))
      closeModal()
      notify("Stock adjustment saved with an audit record.")
    } else if (type === "party") {
      const supplier = page === "Suppliers"
      const party: Party = {
        id: (supplier ? "SUP-" : "PTY-") + id,
        name: data.name.trim(),
        city: data.city,
        phone: data.phone,
        balance: 0,
        limit: +data.limit,
        status: "Clear",
      }
      setStore((s) => ({
        ...s,
        [supplier ? "suppliers" : "parties"]: [
          ...(supplier ? s.suppliers : s.parties),
          party,
        ],
        audits: [audit("Party added", party.name), ...s.audits],
      }))
      closeModal()
      notify(`${supplier ? "Supplier" : "Party"} added.`)
    } else if (type === "transfer") {
      const amount = +data.amount
      if (amount > store.accounts[data.from])
        return notify("Insufficient balance in the source account.")
      setStore((s) => ({
        ...s,
        accounts: {
          ...s.accounts,
          [data.from]: s.accounts[data.from] - amount,
          [data.to]: s.accounts[data.to] + amount,
        },
        entries: [
          {
            id: "TRF-" + id,
            date: data.date,
            account: data.from,
            description: "Transfer to " + data.to,
            incoming: 0,
            outgoing: amount,
            type: "Transfer",
          },
          {
            id: "TRF-" + id + "-IN",
            date: data.date,
            account: data.to,
            description: "Transfer from " + data.from,
            incoming: amount,
            outgoing: 0,
            type: "Transfer",
          },
          ...s.entries,
        ],
        audits: [
          audit(
            "Account transfer",
            data.from + " → " + data.to + " · " + money(amount),
          ),
          ...s.audits,
        ],
      }))
      closeModal()
      notify("Transfer saved. Both account balances updated.")
    } else if (type === "user") {
      if (store.users.some((u) => u.username === data.username))
        return notify("This username is already in use.")
      setStore((s) => ({
        ...s,
        users: [
          ...s.users,
          {
            id: "USR-" + id,
            name: data.name,
            username: data.username,
            role: data.role,
            status: "Active",
            activity: "Not yet signed in",
          },
        ],
        audits: [audit("User added", data.name), ...s.audits],
      }))
      closeModal()
      notify("Demo user added. Native authentication is not connected.")
    }
  }
  function createBackup() {
    downloadFile(
      "raza-textiles-backup-" + today + ".json",
      JSON.stringify(store, null, 2),
    )
    const label = new Date().toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    })
    setLastBackup(label)
    localStorage.setItem("raza-last-backup", label)
    notify("Backup downloaded. Keep a copy on an external drive.")
  }
  async function restoreFile(file: File) {
    try {
      const data = JSON.parse(await file.text())
      if (!isValidStore(data)) throw new Error("Invalid backup")
      setPendingRestore(data)
      open("restore", file.name)
    } catch {
      notify(
        "This file is not a compatible workspace backup. No data was changed.",
      )
    }
  }
  function processReturn(
    transaction: Transaction,
    quantities: Record<string, number>,
    type: string,
  ) {
    const purchase = type === "Purchase return"
    if (store.returns.some((r) => r.original === transaction.id))
      return notify(
        "A return already exists for this invoice. Review the audit log before making another adjustment.",
      )
    if (
      purchase &&
      transaction.lines?.some(
        (l) =>
          (quantities[l.productId] || 0) >
          (store.products.find((p) => p.id === l.productId)?.stock || 0),
      )
    )
      return notify("The purchase return exceeds available stock.")
    const total =
      transaction.lines?.reduce(
        (s, l) =>
          s + (quantities[l.productId] || 0) * (l.rate - l.discount / l.qty),
        0,
      ) || 0
    const id = "RET-" + Date.now().toString().slice(-6)
    setStore((s) => ({
      ...s,
      products: s.products.map((p) => ({
        ...p,
        stock: p.stock + (quantities[p.id] || 0) * (purchase ? -1 : 1),
      })),
      [purchase ? "suppliers" : "parties"]: (purchase
        ? s.suppliers
        : s.parties
      ).map((p) =>
        p.name === transaction.party
          ? {
              ...p,
              balance: p.balance - total,
              status: p.balance - total <= 0 ? "Clear" : "Outstanding",
            }
          : p,
      ),
      returns: [
        { id, original: transaction.id, type, total, date: today },
        ...s.returns,
      ],
      movements: [
        ...(transaction.lines || [])
          .filter((l) => quantities[l.productId] > 0)
          .map((l) => ({
            id,
            date: today,
            type,
            productId: l.productId,
            quantity: quantities[l.productId] * (purchase ? -1 : 1),
            reason: transaction.id,
          })),
        ...s.movements,
      ],
      audits: [
        audit(type, id + " · " + transaction.id + " · " + money(total)),
        ...s.audits,
      ],
    }))
    notify(
      `${type} saved. Stock and party balance adjusted; no cash refund issued.`,
    )
  }
  const activePage =
    page === "New Purchase"
      ? "Purchases"
      : page === "Sales History"
        ? "POS / Sales"
        : page
  const matchedParties = [...store.parties, ...store.suppliers].filter(
    (p) =>
      p.name.toLowerCase().includes(globalSearch.toLowerCase()) ||
      p.id.toLowerCase().includes(globalSearch.toLowerCase()),
  )
  const matchedProducts = store.products.filter((p) =>
    `${p.name} ${p.id} ${p.article}`
      .toLowerCase()
      .includes(globalSearch.toLowerCase()),
  )
  const matchedInvoices = [...store.sales, ...store.purchases].filter((s) =>
    s.id.toLowerCase().includes(globalSearch.toLowerCase()),
  )
  const title = page === "POS / Sales" ? "Sales workspace" : page
  function historyPage(purchase: boolean) {
    const rows = (purchase ? store.purchases : store.sales).filter(
      (s) =>
        `${s.id} ${s.party}`.toLowerCase().includes(query.toLowerCase()) &&
        (filter === "All statuses" ||
          (filter === "Paid"
            ? s.paid >= s.total
            : filter === "Partial"
              ? s.paid > 0 && s.paid < s.total
              : s.paid === 0)),
    )
    return (
      <>
        <PageHeading
          title={purchase ? "Purchases" : "Sales history"}
          description={
            purchase
              ? "Manage supplier invoices, payments and incoming stock."
              : "Every invoice, payment and outstanding sale in one place."
          }
        >
          <ExportButton name={purchase ? "purchases" : "sales"} rows={rows} />
          <Button
            variant="primary"
            onClick={() => navigate(purchase ? "New Purchase" : "POS / Sales")}
          >
            <Plus size={16} />
            New {purchase ? "purchase" : "sale"}
          </Button>
        </PageHeading>
        <div className="summary-grid three">
          <Summary
            label={purchase ? "Total purchases" : "Total sales"}
            value={money(rows.reduce((s, r) => s + r.total, 0))}
          />
          <Summary
            label="Total paid"
            value={money(rows.reduce((s, r) => s + r.paid, 0))}
            tone="green"
          />
          <Summary
            label={purchase ? "Outstanding payable" : "Outstanding receivable"}
            value={money(rows.reduce((s, r) => s + r.total - r.paid, 0))}
            tone="red"
          />
        </div>
        <Panel>
          <div className="table-toolbar">
            <SearchBox
              value={query}
              onChange={setQuery}
              placeholder="Search invoice or party…"
            />
            <Select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Payment status"
            >
              <option>All statuses</option>
              <option>Paid</option>
              <option>Partial</option>
              <option>Unpaid</option>
            </Select>
          </div>
          <DataTable
            pagination
            rows={rows}
            onRow={(r) => open("invoice", r)}
            columns={[
              {
                key: "id",
                label: "Invoice",
                render: (r) => <span className="reference">{r.id}</span>,
              },
              {
                key: "party",
                label: purchase ? "Supplier" : "Customer / party",
              },
              { key: "date", label: "Date" },
              { key: "items", label: "Thans", right: true },
              {
                key: "total",
                label: "Total",
                right: true,
                render: (r) => <strong>{money(r.total)}</strong>,
              },
              {
                key: "paid",
                label: "Paid",
                right: true,
                render: (r) => (
                  <span className="green-text">{money(r.paid)}</span>
                ),
              },
              {
                key: "remaining",
                label: purchase ? "Payable" : "Remaining",
                right: true,
                render: (r) => money(r.total - r.paid),
              },
              {
                key: "method",
                label: "Status",
                render: (r) => (
                  <Badge>
                    {r.paid >= r.total
                      ? "Paid"
                      : r.paid > 0
                        ? "Partial"
                        : "Unpaid"}
                  </Badge>
                ),
              },
              {
                key: "action",
                label: "",
                render: (r) => (
                  <Action className="row-action" aria-label={`Preview ${r.id}`}>
                    <Printer size={16} />
                  </Action>
                ),
              },
            ]}
          />
        </Panel>
      </>
    )
  }
  function partyPage(supplier: boolean) {
    const parties = supplier ? store.suppliers : store.parties
    const rows = parties.filter(
      (p) =>
        `${p.name} ${p.city} ${p.phone} ${p.id}`
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (filter === "All statuses" || p.status === filter),
    )
    return (
      <>
        <PageHeading
          title={supplier ? "Suppliers" : "Customers & parties"}
          description={
            supplier
              ? "Manage your suppliers, payable balances and purchase ledgers."
              : "Keep party balances clear and relationships in good standing."
          }
        >
          <ExportButton
            name={supplier ? "suppliers" : "customers"}
            rows={rows}
          />
          <Button variant="primary" onClick={() => open("party")}>
            <Plus size={16} />
            Add {supplier ? "supplier" : "party"}
          </Button>
        </PageHeading>
        <div className="summary-grid three">
          <Summary
            label={supplier ? "Total suppliers" : "Total parties"}
            value={String(parties.length)}
          />
          <Summary
            label={
              supplier ? "Outstanding payables" : "Outstanding receivables"
            }
            value={money(parties.reduce((s, p) => s + p.balance, 0))}
            tone="red"
          />
          <Summary
            label={supplier ? "Suppliers with balances" : "Overdue parties"}
            value={String(
              parties.filter((p) =>
                supplier ? p.balance > 0 : p.status === "Overdue",
              ).length,
            )}
          />
        </div>
        <Panel>
          <div className="table-toolbar">
            <SearchBox
              value={query}
              onChange={setQuery}
              placeholder="Search name, city, phone or code…"
            />
            <Select
              aria-label="Party status"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option>All statuses</option>
              <option>Clear</option>
              <option>Outstanding</option>
              <option>Overdue</option>
            </Select>
          </div>
          <DataTable
            rows={rows}
            pagination
            onRow={(p) =>
              open(supplier ? "supplier-detail" : "party-detail", p)
            }
            columns={[
              {
                key: "id",
                label: "Code",
                render: (p) => <span className="reference">{p.id}</span>,
              },
              {
                key: "name",
                label: supplier ? "Supplier name" : "Party name",
                render: (p) => <strong>{p.name}</strong>,
              },
              { key: "city", label: "City" },
              { key: "phone", label: "Phone" },
              {
                key: "balance",
                label: supplier ? "Payable" : "Outstanding",
                right: true,
                render: (p) => (
                  <strong className={p.balance > 0 ? "red-text" : "green-text"}>
                    {money(p.balance)}
                  </strong>
                ),
              },
              ...(!supplier
                ? [
                    {
                      key: "limit",
                      label: "Credit limit",
                      right: true,
                      render: (p: Party) => money(p.limit),
                    },
                    { key: "terms", label: "Terms", render: () => "30 days" },
                  ]
                : []),
              {
                key: "status",
                label: "Status",
                render: (p) => <Badge>{p.status}</Badge>,
              },
              {
                key: "actions",
                label: "",
                render: (p) => (
                  <Action
                    className="row-action"
                    aria-label={`Open ${p.name} ledger`}
                  >
                    <ArrowRight size={16} />
                  </Action>
                ),
              },
            ]}
          />
        </Panel>
        <div className="info-notice report-disclaimer">
          <BookOpen size={16} />
          Click any party to open their Khata, payments and account statement.
        </div>
      </>
    )
  }
  function inventoryPage() {
    const rows = store.products.filter(
      (p) =>
        `${p.name} ${p.company} ${p.category} ${p.article} ${p.color} ${p.id}`
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (filter === "All statuses" ||
          (filter === "Low stock"
            ? p.stock > 0 && p.stock < 10
            : filter === "Out of stock"
              ? p.stock === 0
              : p.stock >= 10)),
    )
    return (
      <>
        <PageHeading
          title="Inventory"
          description="Know exactly what’s on your shelves, by article, variant and Than size."
        >
          <ExportButton name="inventory" rows={rows} />
          <Button onClick={() => open("physical-count")}>
            <ClipboardList size={15} />
            Physical count
          </Button>
          <Button variant="primary" onClick={() => open("adjust")}>
            <Package size={15} />
            Adjust stock
          </Button>
        </PageHeading>
        <div className="summary-grid four">
          <Summary
            label="Total stock value"
            value={money(
              store.products.reduce((s, p) => s + p.stock * p.cost, 0),
            )}
          />
          <Summary
            label="Total available Thans"
            value={String(store.products.reduce((s, p) => s + p.stock, 0))}
          />
          <Summary
            label="Low stock items"
            value={String(
              store.products.filter((p) => p.stock > 0 && p.stock < 10).length,
            )}
            tone="amber"
          />
          <Summary
            label="Out of stock"
            value={String(store.products.filter((p) => !p.stock).length)}
            tone="red"
          />
        </div>
        <Panel>
          <div className="table-toolbar">
            <SearchBox
              value={query}
              onChange={setQuery}
              placeholder="Search product, article, company or SKU…"
            />
            <Select
              aria-label="Stock status"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option>All statuses</option>
              <option>In stock</option>
              <option>Low stock</option>
              <option>Out of stock</option>
            </Select>
          </div>
          <DataTable
            rows={rows}
            pagination
            onRow={(p) => open("stock", p)}
            columns={[
              {
                key: "name",
                label: "Product / article",
                render: (p) => (
                  <div className="cell-two">
                    <strong>{p.name}</strong>
                    <span>
                      {p.article} · {p.category}
                    </span>
                  </div>
                ),
              },
              { key: "company", label: "Company" },
              { key: "color", label: "Variant" },
              { key: "size", label: "Than size", render: (p) => `${p.size}m` },
              {
                key: "stock",
                label: "Qty",
                right: true,
                render: (p) => <strong>{p.stock}</strong>,
              },
              {
                key: "cost",
                label: "Avg. cost",
                right: true,
                render: (p) => money(p.cost),
              },
              {
                key: "rate",
                label: "Sale rate",
                right: true,
                render: (p) => money(p.rate),
              },
              {
                key: "value",
                label: "Stock value",
                right: true,
                render: (p) => money(p.stock * p.cost),
              },
              {
                key: "status",
                label: "Status",
                render: (p) => (
                  <Badge>
                    {p.stock === 0
                      ? "Out of stock"
                      : p.stock < 10
                        ? "Low stock"
                        : "In stock"}
                  </Badge>
                ),
              },
            ]}
          />
        </Panel>
        <div className="dashboard-footnote">
          <span>
            <ShieldCheck size={14} />
            Main warehouse · Quantities in Thans · Rates per Than
          </span>
          <span>Click a product to see stock movement</span>
        </div>
      </>
    )
  }
  function recoveryPage() {
    const rows = store.collections.filter((c) =>
      `${c.party} ${c.user} ${c.method}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    return (
      <>
        <PageHeading
          title="Daily recovery"
          description="Collect payments, update party balances and issue receipts."
        >
          <ExportButton name="recovery" rows={rows} />
          <Button variant="primary" onClick={() => open("recovery")}>
            <Plus size={16} />
            Receive payment
          </Button>
        </PageHeading>
        <div className="summary-grid three">
          <Summary
            label="Collected today"
            value={money(
              store.collections
                .filter((c) => c.date === today)
                .reduce((s, c) => s + c.amount, 0),
            )}
            tone="green"
          />
          <Summary
            label="Payments received"
            value={String(
              store.collections.filter((c) => c.date === today).length,
            )}
          />
          <Summary
            label="Total outstanding"
            value={money(store.parties.reduce((s, p) => s + p.balance, 0))}
            tone="red"
          />
        </div>
        <div className="recovery-layout">
          <Panel
            title="Today’s collections"
            subtitle="Payments recorded by your team"
          >
            <div className="table-toolbar">
              <SearchBox
                value={query}
                onChange={setQuery}
                placeholder="Search party or collector…"
              />
              <Button onClick={() => open("recovery-filters")}>
                <SlidersHorizontal size={15} />
                Filters
              </Button>
            </div>
            <DataTable
              rows={rows}
              pagination
              onRow={(c) => open("receipt", c)}
              columns={[
                {
                  key: "id",
                  label: "Receipt",
                  render: (c) => <span className="reference">{c.id}</span>,
                },
                {
                  key: "party",
                  label: "Party",
                  render: (c) => <strong>{c.party}</strong>,
                },
                {
                  key: "amount",
                  label: "Collected",
                  right: true,
                  render: (c) => (
                    <strong className="green-text">{money(c.amount)}</strong>
                  ),
                },
                {
                  key: "method",
                  label: "Payment",
                  render: (c) => <Badge tone="neutral">{c.method}</Badge>,
                },
                { key: "time", label: "Time" },
                { key: "user", label: "Collected by" },
                {
                  key: "actions",
                  label: "",
                  render: (c) => (
                    <Action className="row-action" aria-label={`Print ${c.id}`}>
                      <Printer size={15} />
                    </Action>
                  ),
                },
              ]}
            />
          </Panel>
          <Panel title="Follow up today" subtitle="Overdue party balances">
            {store.parties
              .filter((p) => p.status === "Overdue")
              .map((p) => (
                <div className="followup-item" key={p.id}>
                  <div>
                    <strong>{p.name}</strong>
                    <span>{p.city} · 30+ days overdue</span>
                  </div>
                  <strong className="red-text">{money(p.balance)}</strong>
                  <Button onClick={() => open("recovery", p)}>
                    Receive payment
                    <ArrowRight size={14} />
                  </Button>
                </div>
              ))}
            <div className="panel-note">
              Collections reduce the party’s Khata balance immediately.
            </div>
          </Panel>
        </div>
      </>
    )
  }
  function expensesPage() {
    const rows = store.expenses.filter((e) =>
      `${e.category} ${e.notes} ${e.account}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    return (
      <>
        <PageHeading
          title="Expenses"
          description="Record everyday business costs without complicated accounting."
        >
          <ExportButton name="expenses" rows={rows} />
          <Button variant="primary" onClick={() => open("expense")}>
            <Plus size={16} />
            Add expense
          </Button>
        </PageHeading>
        <div className="summary-grid four">
          {[
            {
              label: "Today's expenses",
              value: store.expenses.filter((e) => e.date === today),
            },
            { label: "This month", value: store.expenses },
            {
              label: "Cash expenses",
              value: store.expenses.filter((e) => e.account === "Cash in hand"),
            },
            {
              label: "Bank expenses",
              value: store.expenses.filter((e) => e.account !== "Cash in hand"),
            },
          ].map((s) => (
            <Summary
              key={s.label}
              label={s.label}
              value={money(s.value.reduce((a, e) => a + e.amount, 0))}
            />
          ))}
        </div>
        <Panel>
          <div className="table-toolbar">
            <SearchBox
              value={query}
              onChange={setQuery}
              placeholder="Search category, notes or account…"
            />
          </div>
          <DataTable
            rows={rows}
            pagination
            columns={[
              { key: "date", label: "Date" },
              {
                key: "id",
                label: "Reference",
                render: (e) => <span className="reference">{e.id}</span>,
              },
              {
                key: "category",
                label: "Category",
                render: (e) => <strong>{e.category}</strong>,
              },
              {
                key: "amount",
                label: "Amount",
                right: true,
                render: (e) => <strong>{money(e.amount)}</strong>,
              },
              { key: "account", label: "Account" },
              { key: "notes", label: "Notes" },
              { key: "user", label: "Created by" },
            ]}
          />
        </Panel>
      </>
    )
  }
  function cashPage() {
    const entries = store.entries
      .filter((e) =>
        accountTab === "Cash book"
          ? e.account === "Cash in hand"
          : accountTab === "Bank book"
            ? e.account !== "Cash in hand"
            : true,
      )
      .filter((e) =>
        `${e.description} ${e.account} ${e.id}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      )
    return (
      <>
        <PageHeading
          title="Cash & bank"
          description="A clear view of your money, accounts and daily movements."
        >
          <Button onClick={() => open("closing")}>
            <CheckCircle2 size={16} />
            Cash closing
          </Button>
          <Button variant="primary" onClick={() => open("transfer")}>
            <ArrowLeftRight size={16} />
            Transfer funds
          </Button>
        </PageHeading>
        <div className="account-grid">
          {Object.entries(store.accounts).map(([name, balance], i) => (
            <Panel key={name}>
              <div className="account-card">
                <span
                  className={`account-icon ${i === 0 ? "green" : "indigo"}`}
                >
                  {i === 0 ? <Wallet size={22} /> : <Landmark size={22} />}
                </span>
                <Badge tone="neutral">
                  {i === 0 ? "Cash account" : "Bank account"}
                </Badge>
                <Heading level={3}>{name}</Heading>
                <span className="muted">Current balance</span>
                <strong className="account-balance">{money(balance)}</strong>
                <div className="account-flow">
                  <span>
                    <ArrowDownLeft size={14} />
                    In{" "}
                    <strong>
                      {money(
                        store.entries
                          .filter((e) => e.account === name)
                          .reduce((s, e) => s + e.incoming, 0),
                      )}
                    </strong>
                  </span>
                  <span>
                    <ArrowUpRight size={14} />
                    Out{" "}
                    <strong>
                      {money(
                        store.entries
                          .filter((e) => e.account === name)
                          .reduce((s, e) => s + e.outgoing, 0),
                      )}
                    </strong>
                  </span>
                </div>
                <Button
                  onClick={() => {
                    setAccountTab(i === 0 ? "Cash book" : "Bank book")
                    setQuery(name)
                  }}
                >
                  View transactions
                  <ArrowRight size={14} />
                </Button>
              </div>
            </Panel>
          ))}
        </div>
        <Panel>
          <div className="panel-heading">
            <Heading level={2}>Account transactions</Heading>
            <ExportButton name="account-transactions" rows={entries} />
          </div>
          <Tabs
            tabs={["Overview", "Cash book", "Bank book"]}
            active={accountTab}
            onChange={(t) => {
              setAccountTab(t)
              setQuery("")
            }}
          />
          <div className="table-toolbar">
            <SearchBox
              value={query}
              onChange={setQuery}
              placeholder="Search reference, description or account…"
            />
          </div>
          <DataTable
            rows={entries}
            pagination
            columns={[
              { key: "date", label: "Date" },
              {
                key: "id",
                label: "Reference",
                render: (e) => <span className="reference">{e.id}</span>,
              },
              { key: "description", label: "Description" },
              { key: "account", label: "Account" },
              {
                key: "type",
                label: "Type",
                render: (e) => (
                  <Badge tone={e.type === "Transfer" ? "indigo" : "neutral"}>
                    {e.type}
                  </Badge>
                ),
              },
              {
                key: "incoming",
                label: "Money in",
                right: true,
                render: (e) =>
                  e.incoming ? (
                    <strong className="green-text">{money(e.incoming)}</strong>
                  ) : (
                    "—"
                  ),
              },
              {
                key: "outgoing",
                label: "Money out",
                right: true,
                render: (e) => (e.outgoing ? money(e.outgoing) : "—"),
              },
            ]}
          />
        </Panel>
      </>
    )
  }
  function usersPage() {
    return (
      <>
        <PageHeading
          title="Users & permissions"
          description="Give your team the access they need, and protect sensitive actions."
        >
          <Button variant="primary" onClick={() => open("user")}>
            <Plus size={16} />
            Add user
          </Button>
        </PageHeading>
        <Tabs
          tabs={["Users", "Roles & permissions", "Audit log"]}
          active={userTab}
          onChange={setUserTab}
        />
        {userTab === "Users" ? (
          <Panel>
            <div className="table-toolbar">
              <SearchBox
                value={query}
                onChange={setQuery}
                placeholder="Search name, username or role…"
              />
            </div>
            <DataTable
              rows={store.users.filter((u) =>
                `${u.name} ${u.username} ${u.role}`
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              )}
              columns={[
                {
                  key: "name",
                  label: "Name",
                  render: (u) => (
                    <div className="user-cell">
                      <span className="small-avatar">
                        {u.name
                          .split(" ")
                          .map((s) => s[0])
                          .join("")}
                      </span>
                      <strong>{u.name}</strong>
                    </div>
                  ),
                },
                { key: "username", label: "Username" },
                {
                  key: "role",
                  label: "Role",
                  render: (u) => <Badge tone="indigo">{u.role}</Badge>,
                },
                {
                  key: "status",
                  label: "Status",
                  render: (u) => <Badge>{u.status}</Badge>,
                },
                { key: "activity", label: "Last activity" },
                {
                  key: "actions",
                  label: "Actions",
                  render: (u) => (
                    <Button
                      variant="ghost"
                      disabled={u.role === "Owner / Admin"}
                      onClick={() => open("user-status", u)}
                    >
                      {u.status === "Active" ? "Deactivate" : "Activate"}
                    </Button>
                  ),
                },
              ]}
            />
            <div className="panel-note">
              <Shield size={14} />
              Demo users and permissions are UI records. Production
              authentication and access enforcement require a native backend.
            </div>
          </Panel>
        ) : userTab === "Audit log" ? (
          <Panel
            title="Activity & audit log"
            action={<ExportButton name="audit-log" rows={store.audits} />}
          >
            <DataTable
              rows={store.audits}
              pagination
              columns={[
                { key: "date", label: "Date & time" },
                { key: "user", label: "User" },
                {
                  key: "action",
                  label: "Action",
                  render: (a) => <strong>{a.action}</strong>,
                },
                { key: "detail", label: "Details" },
              ]}
            />
          </Panel>
        ) : (
          <div className="settings-layout">
            <Panel className="settings-navigation">
              {roles.map((r) => (
                <Action
                  key={r}
                  className={role === r ? "active" : ""}
                  onClick={() => setRole(r)}
                >
                  {r}
                  <ChevronRight size={15} />
                </Action>
              ))}
            </Panel>
            <Panel
              title={role}
              subtitle="Choose which actions this role can perform."
            >
              <div className="permissions-list">
                {[
                  "Sales",
                  "Customers",
                  "Recovery",
                  "Purchases",
                  "Suppliers",
                  "Inventory",
                  "Expenses",
                  "Cash & bank",
                  "Reports",
                  "Users",
                  "Settings",
                  "Void sale",
                  "High discount",
                  "Stock adjustment",
                  "Financial controls",
                ]
                  .filter((p) => p !== "Recovery" || isEnabled("recovery"))
                  .map((p, i) => (
                    <div className="setting-toggle" key={p}>
                      <div>
                        <strong>{p}</strong>
                        <span>
                          {i > 10
                            ? "Sensitive action · owner approval recommended"
                            : "View and manage " + p.toLowerCase()}
                        </span>
                      </div>
                      <Input
                        aria-label={`Allow ${p} for ${role}`}
                        type="checkbox"
                        checked={
                          store.permissions[role + ":" + p] ??
                          (role === "Owner / Admin" ||
                            (role === "Sales User" && i < 3) ||
                            (role === "Viewer" && i === 8))
                        }
                        disabled={role === "Owner / Admin"}
                        onChange={(e) => {
                          setStore((s) => ({
                            ...s,
                            permissions: {
                              ...s.permissions,
                              [role + ":" + p]: e.target.checked,
                            },
                          }))
                          notify("Permission preference saved.")
                        }}
                      />
                    </div>
                  ))}
              </div>
            </Panel>
          </div>
        )}
      </>
    )
  }
  function renderPage() {
    switch (page) {
      case "Dashboard":
        return (
          <Dashboard
            {...store}
            navigate={navigate}
            open={(type, data) =>
              open(type === "party" ? "party-detail" : type, data)
            }
          />
        )
      case "POS / Sales":
        return (
          <SalesWorkspace
            parties={store.parties}
            products={store.products}
            onSave={(t, p) => saveTransaction(t, p)}
            onHistory={() => navigate("Sales History")}
          />
        )
      case "New Purchase":
        return (
          <SalesWorkspace
            purchase
            parties={store.suppliers}
            products={store.products}
            onSave={(t, p) => saveTransaction(t, p, true)}
            onHistory={() => navigate("Purchases")}
          />
        )
      case "Sales History":
        return historyPage(false)
      case "Purchases":
        return historyPage(true)
      case "Customers":
        return partyPage(false)
      case "Suppliers":
        return partyPage(true)
      case "Inventory":
        return inventoryPage()
      case "Recovery":
        return recoveryPage()
      case "Expenses":
        return expensesPage()
      case "Cash & Bank":
        return cashPage()
      case "Users & Permissions":
        return usersPage()
      case "Settings":
        return <Settings notify={notify} />
      case "Backup & Restore":
        return (
          <Backup
            lastBackup={lastBackup}
            onBackup={createBackup}
            onRestore={restoreFile}
          />
        )
      case "Returns":
        return (
          <Returns
            sales={store.sales}
            purchases={store.purchases}
            onReturn={processReturn}
          />
        )
      case "Reports":
        return <Reports selected={report} onSelect={setReport} {...store} />
      default:
        return null
    }
  }
  function renderModal() {
    if (!modal) return null
    const { type, data } = modal
    const entryTitles: Record<string, [string, string]> = {
      recovery: [
        "Receive payment",
        "Select a party, enter the amount and issue a receipt.",
      ],
      "supplier-payment": [
        "Pay supplier",
        "Record a payment against a supplier balance.",
      ],
      expense: [
        "Add expense",
        "Record the cost and the account it was paid from.",
      ],
      adjust: [
        "Stock adjustment",
        "Correct stock with a reason and authorization.",
      ],
      party: [
        page === "Suppliers" ? "Add supplier" : "Add party",
        "A few details to get started.",
      ],
      transfer: [
        "Transfer between accounts",
        "Move funds without affecting income or expenses.",
      ],
      user: ["Add user", "Create a local demo team member."],
    }
    if (entryTitles[type])
      return (
        <Modal
          title={entryTitles[type][0]}
          description={entryTitles[type][1]}
          onClose={closeModal}
        >
          <EntryForm
            type={type}
            parties={
              type === "supplier-payment" ? store.suppliers : store.parties
            }
            products={store.products}
            initial={data as Party | Product}
            onClose={closeModal}
            onSubmit={submitEntry}
          />
        </Modal>
      )
    if (type === "invoice" || type === "receipt")
      return (
        <Modal
          title={type === "invoice" ? "Invoice preview" : "Recovery receipt"}
          wide
          onClose={closeModal}
        >
          <InvoicePreview
            transaction={type === "invoice" ? data as Transaction : undefined}
            collection={type === "receipt" ? data as Collection : undefined}
            onClose={closeModal}
          />
        </Modal>
      )
    if (type === "party-detail" || type === "supplier-detail") {
      const supplier = type === "supplier-detail"
      const p = data as Party
      const party =
        (supplier ? store.suppliers : store.parties).find(
          (x) => x.id === p.id,
        ) || p
      return (
        <Modal
          title={supplier ? "Supplier ledger" : "Party Khata"}
          wide
          onClose={closeModal}
        >
          <PartyDetails
            party={party}
            supplier={supplier}
            sales={supplier ? store.purchases : store.sales}
            collections={store.collections}
            onAction={(action) =>
              action === "sale"
                ? navigate(supplier ? "New Purchase" : "POS / Sales")
                : open(supplier ? "supplier-payment" : "recovery", party)
            }
          />
        </Modal>
      )
    }
    if (type === "stock") {
      const p = data as Product
      return (
        <Modal title="Stock details & movement" wide onClose={closeModal}>
          <StockDetails
            product={store.products.find((x) => x.id === p.id) || p}
            movements={store.movements}
            onAdjust={() => open("adjust", p)}
          />
        </Modal>
      )
    }
    if (type === "restore")
      return (
        <Modal
          title="Restore this backup?"
          description={String(data)}
          onClose={closeModal}
        >
          <div className="modal-body">
            <div className="confirm-notice">
              <strong>Your current workspace will be replaced.</strong>
              <p>
                The backup contains {pendingRestore?.sales.length} sales,{" "}
                {pendingRestore?.parties.length} parties and{" "}
                {pendingRestore?.products.length} stock items. A safety copy
                will download first.
              </p>
            </div>
          </div>
          <div className="modal-footer">
            <Button onClick={closeModal}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                createBackup()
                if (pendingRestore) setStore(pendingRestore)
                setPendingRestore(null)
                closeModal()
                notify("Backup restored. Your workspace is ready.")
              }}
            >
              <RotateCcw size={15} />
              Confirm restore
            </Button>
          </div>
        </Modal>
      )
    if (type === "user-status") {
      const u = data as User
      return (
        <Modal
          title={`${
            u.status === "Active" ? "Deactivate" : "Activate"
          } ${u.name}?`}
          onClose={closeModal}
        >
          <div className="modal-body">
            <p>
              {u.status === "Active"
                ? "This user will be marked inactive. Their transaction history will be preserved."
                : "This user will be marked active again."}
            </p>
          </div>
          <div className="modal-footer">
            <Button onClick={closeModal}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                setStore((s) => ({
                  ...s,
                  users: s.users.map((x) =>
                    x.id === u.id
                      ? {
                          ...x,
                          status: x.status === "Active" ? "Inactive" : "Active",
                        }
                      : x,
                  ),
                  audits: [audit("User status changed", u.name), ...s.audits],
                }))
                closeModal()
                notify("User status updated.")
              }}
            >
              Confirm
            </Button>
          </div>
        </Modal>
      )
    }
    if (type === "logout")
      return (
        <Modal title="Lock this workspace?" onClose={closeModal}>
          <div className="modal-body">
            <p>
              All changes are saved on this device. You can return using the
              demo login.
            </p>
          </div>
          <div className="modal-footer">
            <Button onClick={closeModal}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                setLoggedIn(false)
                closeModal()
              }}
            >
              Lock workspace
            </Button>
          </div>
        </Modal>
      )
    if (type === "closing")
      return (
        <Modal
          title="Daily cash closing"
          description="Compare cash on hand with the recorded balance."
          onClose={closeModal}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const value = Number(new FormData(e.currentTarget).get("counted"))
              const diff = value - store.accounts["Cash in hand"]
              setStore((s) => ({
                ...s,
                audits: [
                  audit(
                    "Cash closing",
                    `Counted ${money(value)} · Difference ${money(diff)}`,
                  ),
                  ...s.audits,
                ],
              }))
              closeModal()
              notify(
                "Cash closing recorded. " +
                  (diff
                    ? `Difference: ${money(diff)}. No automatic balance adjustment made.`
                    : "Cash is balanced."),
              )
            }}
          >
            <div className="modal-body">
              <div className="form-balance">
                <span>Expected cash balance</span>
                <strong>{money(store.accounts["Cash in hand"])}</strong>
              </div>
              <Field label="Counted cash (Rs.)" required>
                <Input name="counted" type="number" min="0" required />
              </Field>
              <Field label="Closing notes">
                <Textarea rows={2} />
              </Field>
            </div>
            <div className="modal-footer">
              <Button onClick={closeModal} type="button">
                Cancel
              </Button>
              <Button variant="primary" type="submit">
                <Check size={15} />
                Record closing
              </Button>
            </div>
          </form>
        </Modal>
      )
    if (type === "physical-count")
      return (
        <Modal
          title="Physical stock count"
          description="Count your shelf stock, then record any differences."
          wide
          onClose={closeModal}
        >
          <DataTable
            rows={store.products}
            columns={[
              { key: "name", label: "Product" },
              { key: "color", label: "Variant" },
              { key: "size", label: "Size", render: (p) => `${p.size}m` },
              { key: "stock", label: "Recorded qty", right: true },
              {
                key: "action",
                label: "Adjustment",
                render: (p) => (
                  <Button onClick={() => open("adjust", p)}>
                    Record difference
                  </Button>
                ),
              },
            ]}
          />
          <div className="modal-footer">
            <Button onClick={() => window.print()}>
              <Printer size={15} />
              Print count sheet
            </Button>
            <Button onClick={closeModal}>Close</Button>
          </div>
        </Modal>
      )
    if (type === "recovery-filters")
      return (
        <Modal title="Filter collections" onClose={closeModal}>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const d = new FormData(e.currentTarget)
              setQuery(String(d.get("search") || ""))
              closeModal()
            }}
          >
            <div className="modal-body">
              <Field label="Party, payment method or collector">
                <Input
                  name="search"
                  defaultValue={query}
                  placeholder="e.g. Lahore party name or Ahmed"
                />
              </Field>
            </div>
            <div className="modal-footer">
              <Button
                type="button"
                onClick={() => {
                  setQuery("")
                  closeModal()
                }}
              >
                Clear filters
              </Button>
              <Button variant="primary">Apply filters</Button>
            </div>
          </form>
        </Modal>
      )
    if (type === "date")
      return (
        <Modal title="Business date" onClose={closeModal}>
          <div className="modal-body">
            <div className="info-notice">
              <CalendarDays size={19} />
              This sample business day is Wednesday, 18 June 2025.
            </div>
            <p className="muted">
              Open a sales report to choose a custom date range and view
              invoices for that period.
            </p>
          </div>
          <div className="modal-footer">
            <Button onClick={closeModal}>Close</Button>
            <Button variant="primary" onClick={() => navigate("Sales Report")}>
              Open sales report
              <ArrowRight size={15} />
            </Button>
          </div>
        </Modal>
      )
    if (type === "notifications")
      return (
        <Modal title="Business notifications" onClose={closeModal}>
          <div className="notification-item">
            <Package size={20} />
            <div>
              <strong>
                {store.products.filter((p) => p.stock < 10).length} items need
                restocking
              </strong>
              <p>Check low and out-of-stock products.</p>
              <Button onClick={() => navigate("Inventory")}>
                View inventory
                <ArrowRight size={14} />
              </Button>
            </div>
          </div>
          <div className="notification-item">
            <Wallet size={20} />
            <div>
              <strong>2 parties have overdue balances</strong>
              <p>Follow up with Al-Madina Fabrics and Hassan Cloth House.</p>
              {isEnabled("recovery") && (
                <Button onClick={() => navigate("Recovery")}>
                  Open recovery
                  <ArrowRight size={14} />
                </Button>
              )}
            </div>
          </div>
        </Modal>
      )
    if (type === "help")
      return (
        <Modal title="Your daily workspace" onClose={closeModal}>
          <div className="modal-body">
            <div className="help-row">
              <kbd>F2</kbd>
              <span>Open a new sale</span>
            </div>
            <div className="help-row">
              <kbd>F8</kbd>
              <span>Save the current sale or purchase</span>
            </div>
            <div className="help-row">
              <kbd>F9</kbd>
              <span>Save and open print preview</span>
            </div>
            <div className="help-row">
              <kbd>Ctrl K</kbd>
              <span>Find a party, product or invoice</span>
            </div>
            <div className="help-row">
              <kbd>Esc</kbd>
              <span>Close a dialog</span>
            </div>
            <div className="info-notice">
              <Database size={16} />
              Sample records are stored locally in your browser. Download
              regular backups. This is an interactive UI prototype, not a
              certified accounting system.
            </div>
          </div>
        </Modal>
      )
    return null
  }
  if (!loggedIn)
    return (
      <Login
        onLogin={() => {
          setLoggedIn(true)
          notify("Welcome back. Your local workspace is ready.")
        }}
      />
    )
  return (
    <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <Action className="brand" onClick={() => navigate("Dashboard")}>
          <BrandMark logo={business.logo} />
          <div>
            <strong>
              {nameParts(business.name)[0]}
              {nameParts(business.name)[1] && <span>{nameParts(business.name)[1]}</span>}
            </strong>
            {business.tagline && <small>{business.tagline.toUpperCase()}</small>}
          </div>
        </Action>
        <div className="workspace-switch">
          <span className="workspace-icon">
            <Building2 size={17} />
          </span>
          <div>
            <strong>{business.name}</strong>
            <span>{business.city ? `${business.city} · ` : ""}Main warehouse</span>
          </div>
          <ShieldCheck size={14} className="muted" />
        </div>
        <nav className="main-navigation">
          {navGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-label">{group.label}</div>
              {group.items
                .filter((item) => !item.flag || isEnabled(item.flag))
                .map((item) => (
                  <Action
                    key={item.title}
                    title={collapsed ? item.title : undefined}
                    className={`nav-item ${
                      activePage === item.title ? "active" : ""
                    }`}
                    onClick={() => navigate(item.title)}
                  >
                    <item.icon size={18} strokeWidth={1.7} />
                    <span>{item.title}</span>
                    {item.shortcut && <kbd>{item.shortcut}</kbd>}
                    {activePage === item.title && (
                      <span className="nav-active-dot" />
                    )}
                  </Action>
                ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <Action
            className={`nav-item ${
              page === "Backup & Restore" ? "active" : ""
            }`}
            onClick={() => navigate("Backup & Restore")}
          >
            <Database size={18} />
            <span>Backup & restore</span>
            <span className="tiny-dot green-dot" />
          </Action>
          <div className="local-status">
            <span className="tiny-dot green-dot" />
            <span>Local workspace · Ready</span>
            <ShieldCheck size={13} />
          </div>
          <div className="sidebar-user">
            <span className="avatar">AA</span>
            <div>
              <strong>Ahmed Ali</strong>
              <span>Owner / Admin</span>
            </div>
            <Action
              title="Lock workspace"
              aria-label="Lock workspace"
              onClick={() => open("logout")}
            >
              <LogOut size={16} />
            </Action>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="top-header">
          <div className="header-context">
            <Action
              className="header-icon"
              aria-label="Toggle sidebar"
              onClick={() => setCollapsed(!collapsed)}
            >
              <PanelLeftClose size={18} />
            </Action>
            <span className="header-divider" />
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{title}</strong>
          </div>
          <div className="global-search">
            <Search size={15} />
            <Input
              ref={searchRef}
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              placeholder="Search anything…"
              aria-label="Search parties, products and invoices"
            />
            <kbd>Ctrl K</kbd>
            {globalSearch && (
              <div className="global-results">
                {matchedParties.slice(0, 3).map((p) => (
                  <Action
                    key={p.id}
                    onClick={() => {
                      open(
                        p.id.startsWith("SUP")
                          ? "supplier-detail"
                          : "party-detail",
                        p,
                      )
                      setGlobalSearch("")
                    }}
                  >
                    <Users size={16} />
                    <span>
                      <strong>{p.name}</strong>
                      <small>
                        {p.id} · {p.city}
                      </small>
                    </span>
                    <ArrowRight size={14} />
                  </Action>
                ))}
                {matchedProducts.slice(0, 3).map((p) => (
                  <Action
                    key={p.id}
                    onClick={() => {
                      open("stock", p)
                      setGlobalSearch("")
                    }}
                  >
                    <Package size={16} />
                    <span>
                      <strong>{p.name}</strong>
                      <small>
                        {p.id} · {p.color}
                      </small>
                    </span>
                    <ArrowRight size={14} />
                  </Action>
                ))}
                {matchedInvoices.slice(0, 3).map((s) => (
                  <Action
                    key={s.id}
                    onClick={() => {
                      open("invoice", s)
                      setGlobalSearch("")
                    }}
                  >
                    <FileText size={16} />
                    <span>
                      <strong>{s.id}</strong>
                      <small>{s.party}</small>
                    </span>
                    <ArrowRight size={14} />
                  </Action>
                ))}
                {!matchedParties.length &&
                  !matchedProducts.length &&
                  !matchedInvoices.length && (
                    <p>No matching parties, products or invoices.</p>
                  )}
              </div>
            )}
          </div>
          <div className="header-actions">
            <span className="header-saved">
              <CheckCircle2 size={14} />
              All changes saved
            </span>
            <Action
              className="header-icon notification-button"
              aria-label="View notifications"
              onClick={() => open("notifications")}
            >
              <Bell size={18} />
              <i />
            </Action>
            <Action
              className="header-icon"
              aria-label="Help and keyboard shortcuts"
              onClick={() => open("help")}
            >
              <CircleHelp size={18} />
            </Action>
            <span className="header-divider" />
            <Action className="header-user" onClick={() => open("logout")}>
              <span className="avatar small">AA</span>
              <ChevronDown size={13} />
            </Action>
          </div>
        </header>
        <main className="main-content" key={page}>
          {renderPage()}
        </main>
      </div>
      {renderModal()}
      {toast && <Toast message={toast} onClose={closeToast} />}
    </div>
  )
}

function Login({ onLogin }: { onLogin: () => void }) {
  const { business } = useBusiness()
  const [error, setError] = useState("")
  return (
    <div className="login-screen">
      <div className="login-brand">
        <BrandMark logo={business.logo} />
        <strong>{business.name.toUpperCase()}</strong>
      </div>
      <div className="login-card">
        <span className="login-icon">
          <ShieldCheck size={26} />
        </span>
        <Heading level={1}>Welcome back</Heading>
        <p>Sign in to your local business workspace.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const data = new FormData(e.currentTarget)
            if (
              data.get("username") !== "ahmed.admin" ||
              data.get("password") !== "demo1234"
            ) {
              setError("Use the demo username and password shown below.")
              return
            }
            onLogin()
          }}
        >
          <Field label="Username" required>
            <Input
              name="username"
              defaultValue="ahmed.admin"
              required
              autoFocus
            />
          </Field>
          <Field label="Password" required>
            <Input
              name="password"
              type="password"
              defaultValue="demo1234"
              required
            />
          </Field>
          {error && <div className="form-error">{error}</div>}
          <Button variant="primary" className="full-width" type="submit">
            Open workspace
            <ArrowRight size={16} />
          </Button>
        </form>
        <div className="demo-login">
          Demo: ahmed.admin / demo1234
          <br />
          UI demonstration only · No production authentication
        </div>
      </div>
      <div className="login-footer">
        <HardDrive size={15} />
        Your records stay on this device. No internet connection required.
      </div>
    </div>
  )
}
