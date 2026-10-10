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
import { money, today, setToday, L, type Collection, type Party, type Product, type Transaction } from "./data"
import type { Snapshot, AppUser as User } from "@shared/models"
import { api } from "./backend"
import { useSession } from "./Auth"
import { bumpData, useDebounced, useRemote } from "./remote"
import type { Product as CountProduct } from "@shared/models"

type Store = Snapshot
const emptyStore: Store = {
  today: today,
  historyFrom: today.slice(0, 8) + "01",
  walkInId: "",
  parties: [],
  suppliers: [],
  collections: [],
  expenses: [],
  accounts: {},
  entries: [],
  users: [],
  audits: [],
  returns: [],
  closings: [],
  dashboard: { todaySales: 0, todaySalesCount: 0, todayRecovery: 0, todayRecoveryCount: 0, todayPurchases: 0, todayPurchaseCount: 0, todayExpenses: 0, grossProfit: 0, margin: null, receivables: 0, payables: 0, stockValue: 0, receivedCash: 0, receivedBank: 0, salesReceived: 0, week: [], weekPrev: 0, month: [], monthPrev: 0, inventory: { items: 0, units: 0, value: 0, low: 0, out: 0, reorder: 0 }, lowStock: [], recentSales: [], recentPurchases: [], expiring: [], cities: [] },
  masters: { accounts: [], expenseCategories: [], companies: [], categories: [], cities: [], thanSizes: [], paymentMethods: [], roles: [], sequences: [], settings: {} },
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
const pageFlags: Record<string, FlagKey> = { Recovery: "recovery" }

/**
 * The count sheet for a physical stock count. It shows one page of the catalogue at a time, searchable,
 * and remembers every quantity typed on any page: the fields are submitted with the form as count:<id>.
 */
function CountSheet() {
  const [q, setQ] = useState("")
  const dq = useDebounced(q)
  const [pg, setPg] = useState(1)
  const [typed, setTyped] = useState<Record<string, string>>({})
  const names = useRef(new Map<string, string>())
  const { data, loading } = useRemote("products:list", { query: dq, activeOnly: true, page: pg, pageSize: 15 })
  const rows: CountProduct[] = data?.rows ?? []
  for (const p of rows) names.current.set(p.id, p.name)
  const entered = Object.entries(typed).filter(([, v]) => v.trim() !== "")
  return (
    <>
      <div className="padded-search">
        <SearchBox
          value={q}
          onChange={(v) => {
            setQ(v)
            setPg(1)
          }}
          placeholder="Find an item to count…"
        />
      </div>
      {entered.map(([id, v]) => (
        <input key={id} type="hidden" name={`count:${id}`} value={v} />
      ))}
      <DataTable
        rows={rows}
        server={{ total: data?.total ?? 0, page: pg, pageSize: 15, onPage: setPg, loading }}
        columns={[
          { key: "name", label: "Product" },
          { key: "size", label: L.size },
          { key: "stock", label: "Recorded qty", right: true },
          {
            key: "count",
            label: "Counted qty",
            render: (p) => (
              <Input
                type="number"
                min="0"
                step="1"
                value={typed[p.id] ?? ""}
                onChange={(e) => setTyped({ ...typed, [p.id]: e.target.value })}
                aria-label={`Counted quantity for ${p.name}`}
              />
            ),
          },
        ]}
      />
      <p className="muted">{entered.length} item{entered.length === 1 ? "" : "s"} counted so far. Items you leave blank are not changed.</p>
    </>
  )
}

export default function App() {
  const { isEnabled } = useConfig()
  const { business } = useBusiness()
  const session = useSession()
  const [store, setStore] = useState<Store>(emptyStore)
  const [ready, setReady] = useState(false)
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
  const searchRef = useRef<HTMLInputElement>(null)
  // Big lists are paged by the engine: this screen only ever holds the page it is showing.
  const [pageNo, setPageNo] = useState(1)
  const dQuery = useDebounced(query)
  const dGlobal = useDebounced(globalSearch.trim())
  const globalOn = dGlobal.length > 0
  const gProducts = useRemote("products:list", { query: dGlobal, pageSize: 3 }, globalOn)
  const gSales = useRemote("docs:list", { kind: "sale", query: dGlobal, pageSize: 3 }, globalOn)
  const gPurchases = useRemote("docs:list", { kind: "purchase", query: dGlobal, pageSize: 3 }, globalOn)
  const invStatus = filter === "Low stock" ? "low" : filter === "Out of stock" ? "out" : filter === "In stock" ? "in" : "all"
  const inventory = useRemote("products:list", { query: dQuery, status: invStatus, page: pageNo, pageSize: 25 }, page === "Inventory")
  const historyKind = page === "Purchases" ? "purchase" : "sale"
  const historyPay = filter === "Paid" ? "paid" : filter === "Partial" ? "partial" : filter === "Unpaid" ? "unpaid" : undefined
  const history = useRemote("docs:list", { kind: historyKind, query: dQuery, payment: historyPay, page: pageNo, pageSize: 25 }, page === "Sales History" || page === "Purchases")
  const notify = useCallback((message: string) => setToast(message), [])
  const closeToast = useCallback(() => setToast(""), [])
  const closeModal = useCallback(() => setModal(null), [])
  const open = (type: string, data?: unknown) => setModal({ type, data })
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
    setPageNo(1)
    setFilter("All statuses")
    setGlobalSearch("")
    setModal(null)
    window.scrollTo(0, 0)
  }
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
  const refresh = useCallback(async () => {
    try {
      const snap = await api("snapshot:get")
      setToday(snap.today)
      setStore(snap)
      bumpData()
    } catch (e) {
      notify((e as Error).message)
    } finally {
      setReady(true)
    }
  }, [notify])
  useEffect(() => {
    void refresh()
  }, [refresh])

  /** Runs one engine command. A refusal is shown as a plain message; success reloads the screen data. */
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try {
      const result = await fn()
      await refresh()
      // Commands with nothing to report resolve to null; success must still be distinguishable from failure (undefined).
      return (result ?? true) as T
    } catch (e) {
      notify((e as Error).message)
      return undefined
    }
  }
  const cashAccount = store.masters.accounts.find((a) => a.active && a.type === "cash")?.name ?? store.masters.accounts.find((a) => a.active)?.name ?? ""
  const methodFor = (account?: string) => (store.masters.accounts.find((a) => a.name === account)?.type === "bank" ? "Bank transfer" : "Cash")

  async function saveTransaction(t: Transaction, print: boolean, purchase = false): Promise<boolean> {
    const account = t.account || cashAccount
    const payments = t.paid > 0 ? [{ account, method: methodFor(account), amount: t.paid }] : []
    const lines = (t.lines ?? []).map((l) => ({ productId: l.productId, qty: l.qty, rate: l.rate, discount: l.discount, batchNo: l.batchNo, mfgDate: l.mfgDate, expiryDate: l.expiryDate }))
    const res = await run(() =>
      purchase
        ? api("purchase:create", { supplierId: t.partyId!, supplierInvoice: t.supplierInvoice, lines, discount: t.invoiceDiscount, payments, date: t.date })
        : api("sale:create", { partyId: t.partyId!, lines, discount: t.invoiceDiscount, payments }),
    )
    if (!res) return false
    const warning = (res as { warnings?: string[] }).warnings?.[0]
    notify(warning ?? (purchase ? `Purchase ${res.id} saved.` : `Sale ${res.id} saved.`))
    if (print) open("invoice", { ...t, id: res.id, kind: purchase ? "purchase" : "sale", user: session.user.name })
    return true
  }

  async function submitEntry(data: Record<string, string>) {
    const type = modal?.type
    const n = (k: string) => Number(data[k])
    const initial = modal?.data as { id?: string } | undefined
    if (type === "recovery" || type === "supplier-payment") {
      const supplier = type === "supplier-payment"
      const party = (supplier ? store.suppliers : store.parties).find((p) => p.id === data.partyId)
      const res = await run(() => api(supplier ? "supplierPayment:create" : "receipt:create", { partyId: data.partyId!, account: data.account!, method: data.method!, amount: n("amount"), date: data.date, notes: data.notes, receivedBy: session.user.name }))
      if (!res) return
      closeModal()
      if (supplier) return notify("Supplier payment recorded.")
      notify(`Payment ${res.id} received.`)
      open("receipt", { id: res.id, party: party?.name ?? "", amount: n("amount"), method: data.method!, account: data.account!, date: data.date || today, time: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }), user: session.user.name, notes: data.notes || "" } satisfies Collection)
      return
    }
    if (type === "expense") {
      if (await run(() => api("expense:create", { category: data.category!, amount: n("amount"), account: data.account!, date: data.date, notes: data.notes }))) {
        closeModal()
        notify("Expense saved.")
      }
      return
    }
    if (type === "transfer") {
      if (await run(() => api("transfer:create", { from: data.from!, to: data.to!, amount: n("amount"), date: data.date, notes: data.notes }))) {
        closeModal()
        notify("Transfer recorded. It is not counted as income or expense.")
      }
      return
    }
    if (type === "adjust") {
      if (await run(() => api("stock:adjust", { productId: data.productId!, quantity: n("quantity"), reason: data.reason!, notes: data.notes, damage: data.reason === "Damaged stock" && n("quantity") < 0 }))) {
        closeModal()
        notify("Stock adjustment saved.")
      }
      return
    }
    if (type === "physical-count") {
      const lines = Object.entries(data).filter(([k, v]) => k.startsWith("count:") && v.trim() !== "").map(([k, v]) => ({ productId: k.slice(6), counted: Number(v) }))
      if (lines.length === 0) return notify("Enter the counted quantity for at least one item.")
      const res = await run(() => api("stock:count", { lines, note: data.notes }))
      if (res) {
        closeModal()
        notify(res.adjusted ? `Stock count saved. ${res.adjusted} item(s) adjusted.` : "Stock count saved. Everything matched.")
      }
      return
    }
    if (type === "party") {
      const kind = page === "Suppliers" ? "supplier" : "customer"
      const res = await run(() =>
        api("party:save", { kind, id: initial?.id, name: data.name!, city: data.city, phone: data.phone, whatsapp: data.whatsapp, area: data.area, address: data.address, notes: data.notes, limit: data.limit === undefined || data.limit === "" ? undefined : n("limit"), terms: data.terms === undefined || data.terms === "" ? null : n("terms"), active: data.active === undefined ? undefined : data.active === "Active", openingBalance: data.opening ? n("opening") : undefined }),
      )
      if (res) {
        closeModal()
        notify(initial?.id ? "Details updated." : kind === "supplier" ? "Supplier added." : "Party added.")
      }
      return
    }
    if (type === "product") {
      const res = await run(() =>
        api("product:save", { id: initial?.id, company: data.company!, article: data.article!, category: data.category, subcategory: data.subcategory, color: data.color, design: data.design, size: data.size, unit: data.unit, barcode: data.barcode, sku: data.sku, cost: n("cost"), rate: n("rate"), wholesale: data.wholesale ? n("wholesale") : null, minStock: data.minStock ? n("minStock") : 0, active: data.active === undefined ? undefined : data.active === "Active", openingQty: data.openingQty ? n("openingQty") : undefined }),
      )
      if (res) {
        closeModal()
        notify(initial?.id ? "Product updated." : "Product added.")
      }
      return
    }
    if (type === "account") {
      if (await run(() => api("account:add", { name: data.name!, type: data.type === "Bank" ? "bank" : "cash", opening: data.opening ? n("opening") : undefined }))) {
        closeModal()
        notify("Account added.")
      }
      return
    }
    if (type === "user") {
      if (await run(() => api("user:create", { name: data.name!, username: data.username!, password: data.password!, role: data.role! }))) {
        closeModal()
        notify("User added.")
      }
    }
  }

  async function processReturn(t: Transaction, quantities: Record<string, number>, type: string, opts: { settlement: "balance" | "cash"; account?: string; refund?: number; damaged?: boolean; reason?: string }): Promise<boolean> {
    const purchase = type === "Purchase return"
    const res = await run(() =>
      purchase
        ? api("return:purchase", { purchase: t.id, quantities, refund: opts.refund, account: opts.account, reason: opts.reason })
        : api("return:sale", { invoice: t.id, quantities, settlement: opts.settlement, account: opts.account, refund: opts.refund, damaged: opts.damaged, reason: opts.reason }),
    )
    if (!res) return false
    notify(`${type} ${res.id} recorded for ${money(res.total)}.`)
    return true
  }

  async function processExchange(t: Transaction, quantities: Record<string, number>, lines: { productId: string; qty: number; rate: number; discount: number }[], paid: number, account: string): Promise<boolean> {
    const res = await run(() => api("exchange:create", { invoice: t.id, quantities, partyId: t.partyId!, lines, payments: paid > 0 ? [{ account, method: methodFor(account), amount: paid }] : [] }))
    if (!res) return false
    notify(`Exchange done: return ${res.returnId}, new invoice ${res.invoice}.`)
    return true
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
  const matchedProducts = globalOn ? (gProducts.data?.rows ?? []) : []
  const matchedInvoices = globalOn ? [...(gSales.data?.rows ?? []), ...(gPurchases.data?.rows ?? [])] : []
  const title = page === "POS / Sales" ? "Sales workspace" : page
  function historyPage(purchase: boolean) {
    const rows = history.data?.rows ?? []
    const sum = history.data?.summary ?? { count: 0, total: 0, paid: 0 }
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
            value={money(sum.total)}
          />
          <Summary
            label="Total paid"
            value={money(sum.paid)}
            tone="green"
          />
          <Summary
            label={purchase ? "Outstanding payable" : "Outstanding receivable"}
            value={money(sum.total - sum.paid)}
            tone="red"
          />
        </div>
        <Panel>
          <div className="table-toolbar">
            <SearchBox
              value={query}
              onChange={(v) => {
                setQuery(v)
                setPageNo(1)
              }}
              placeholder="Search invoice or party…"
            />
            <Select
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value)
                setPageNo(1)
              }}
              aria-label="Payment status"
            >
              <option>All statuses</option>
              <option>Paid</option>
              <option>Partial</option>
              <option>Unpaid</option>
            </Select>
          </div>
          <DataTable
            server={{ total: history.data?.total ?? 0, page: pageNo, pageSize: 25, onPage: setPageNo, loading: history.loading }}
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
              { key: "items", label: L.units, right: true },
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
                    {r.status === "void"
                      ? "Cancelled"
                      : r.paid >= r.total
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
                    { key: "terms", label: "Terms", render: (p: Party) => (p.terms ? `${p.terms} days` : "—") },
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
    const rows = inventory.data?.rows ?? []
    const sum = inventory.data?.summary ?? { items: 0, units: 0, value: 0, low: 0, out: 0, reorder: 0 }
    return (
      <>
        <PageHeading
          title="Inventory"
          description={`Know exactly what’s on your shelves, by item, variant and ${L.size.toLowerCase()}.`}
        >
          <ExportButton name="inventory" rows={rows} />
          <Button onClick={() => open("product")} disabled={!session.can("catalog.manage")}>
            <Plus size={15} />
            Add product
          </Button>
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
            value={money(sum.value)}
          />
          <Summary
            label={`Total available ${L.units}`}
            value={sum.units.toLocaleString()}
          />
          <Summary
            label="Low stock items"
            value={sum.low.toLocaleString()}
            tone="amber"
          />
          <Summary
            label="Out of stock"
            value={sum.out.toLocaleString()}
            tone="red"
          />
        </div>
        <Panel>
          <div className="table-toolbar">
            <SearchBox
              value={query}
              onChange={(v) => {
                setQuery(v)
                setPageNo(1)
              }}
              placeholder="Search product, company, SKU or barcode…"
            />
            <Select
              aria-label="Stock status"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value)
                setPageNo(1)
              }}
            >
              <option>All statuses</option>
              <option>In stock</option>
              <option>Low stock</option>
              <option>Out of stock</option>
            </Select>
          </div>
          <DataTable
            rows={rows}
            server={{ total: inventory.data?.total ?? 0, page: pageNo, pageSize: 25, onPage: setPageNo, loading: inventory.loading }}
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
              { key: "size", label: L.size, render: (p) => p.size || "—" },
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
                      : p.stock <= p.minStock
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
            Quantities in {L.units.toLowerCase()} · Rates {L.perUnit}
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
    const cashNames = new Set(store.masters.accounts.filter((a) => a.type === "cash").map((a) => a.name))
    const entries = store.entries
      .filter((e) =>
        accountTab === "Cash book"
          ? cashNames.has(e.account)
          : accountTab === "Bank book"
            ? !cashNames.has(e.account)
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
          <Button onClick={() => open("account")} disabled={!session.can("settings.manage")}>
            <Plus size={16} />
            Add account
          </Button>
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
          {Object.entries(store.accounts).map(([name, balance]) => {
            const isCash = cashNames.has(name)
            const i = isCash ? 0 : 1
            return (
            <Panel key={name}>
              <div className="account-card">
                <span
                  className={`account-icon ${isCash ? "green" : "indigo"}`}
                >
                  {isCash ? <Wallet size={22} /> : <Landmark size={22} />}
                </span>
                <Badge tone="neutral">
                  {isCash ? "Cash account" : "Bank account"}
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
            )
          })}
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
                    <div className="row-actions">
                      <Button variant="ghost" disabled={!session.can("users.manage")} onClick={() => open("user-password", u)}>
                        Reset password
                      </Button>
                      <Button variant="ghost" disabled={!session.can("users.manage")} onClick={() => open("user-status", u)}>
                        {u.status === "Active" ? "Deactivate" : "Activate"}
                      </Button>
                    </div>
                  ),
                },
              ]}
            />
            <div className="panel-note">
              <Shield size={14} />
              Access is enforced by the program itself. Changes to roles apply the next time a person performs an action.
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
              {store.masters.roles.map((r) => (
                <Action
                  key={r.name}
                  className={role === r.name ? "active" : ""}
                  onClick={() => setRole(r.name)}
                >
                  {r.name}
                  <ChevronRight size={15} />
                </Action>
              ))}
            </Panel>
            <Panel
              title={role}
              subtitle="Choose which actions this role can perform."
            >
              <div className="permissions-list">
                {PERMISSION_LABELS.filter(([key]) => key !== "payment.create" || true).map(([key, label, sensitive]) => {
                  const current = store.masters.roles.find((r) => r.name === role)
                  const owner = role === "Owner / Admin"
                  return (
                    <div className="setting-toggle" key={key}>
                      <div>
                        <strong>{label}</strong>
                        <span>{sensitive ? "Sensitive action · give only to people you trust" : "Allows this action"}</span>
                      </div>
                      <Input
                        aria-label={`Allow ${label} for ${role}`}
                        type="checkbox"
                        checked={owner || !!current?.permissions.includes(key)}
                        disabled={owner || !session.can("users.manage")}
                        onChange={async (e) => {
                          await run(() => api("role:setPermission", { role, permission: key, allowed: e.target.checked }))
                        }}
                      />
                    </div>
                  )
                })}
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
            userName={session.user.name}
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
            walkInId={store.walkInId}
            accounts={store.masters.accounts.filter((a) => a.active)}
            onSave={(t, p) => saveTransaction(t, p)}
            onHistory={() => navigate("Sales History")}
          />
        )
      case "New Purchase":
        return (
          <SalesWorkspace
            purchase
            parties={store.suppliers}
            accounts={store.masters.accounts.filter((a) => a.active)}
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
        return <Settings notify={notify} masters={store.masters} run={run} canManage={session.can("settings.manage")} />
      case "Backup & Restore":
        return <Backup notify={notify} canRestore={session.can("backup.restore")} secondaryDir={store.masters.settings["backup.secondary_dir"] ?? ""} onChanged={() => void refresh()} />
      case "Returns":
        return (
          <Returns
            returns={store.returns}
            accounts={store.masters.accounts.filter((a) => a.active).map((a) => a.name)}
            onReturn={processReturn}
            onExchange={processExchange}
          />
        )
      case "Reports":
        return (
          <Reports
            selected={report}
            onSelect={setReport}
            historyFrom={store.historyFrom}
            parties={store.parties}
            suppliers={store.suppliers}
            companies={store.masters.companies}
            cities={store.masters.cities}
            accounts={store.masters.accounts}
            canExport={session.can("report.export")}
          />
        )
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
        (data as Party | undefined)?.id ? "Edit details" : page === "Suppliers" ? "Add supplier" : "Add party",
        "A few details to get started.",
      ],
      transfer: [
        "Transfer between accounts",
        "Move funds without affecting income or expenses.",
      ],
      user: ["Add user", "Create a team member and choose what they can do."],
      product: [(data as Product | undefined)?.id ? "Edit product" : "Add product", "Items are kept per variant, with their own price and stock."],
      account: ["Add account", "A cash drawer or a bank account."],
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
            masters={store.masters}
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
            transaction={type === "invoice" ? (data as Transaction) : undefined}
            collection={type === "receipt" ? (data as Collection) : undefined}
            onClose={closeModal}
            defaultLayout={store.masters.settings["invoice.layout"]}
            thermalWidth={store.masters.settings["print.thermal_width"]}
            purchase={(data as Transaction | undefined)?.kind === "purchase"}
            canVoid={type === "invoice" && session.can((data as Transaction)?.kind === "purchase" ? "purchase.void" : "sale.void")}
            onVoid={async (reason) => {
              const t = data as Transaction
              const purchase = t.kind === "purchase"
              if (await run(() => api(purchase ? "purchase:void" : "sale:void", { id: t.id, reason }))) {
                closeModal()
                notify(`${t.id} cancelled. Stock, balances and cash were reversed.`)
              }
            }}
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
            onAction={(action) =>
              action === "sale"
                ? navigate(supplier ? "New Purchase" : "POS / Sales")
                : action === "edit"
                  ? open("party", party)
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
            product={p}
            onAdjust={() => open("adjust", p)}
            onEdit={session.can("catalog.manage") ? () => open("product", p) : undefined}
          />
        </Modal>
      )
    }
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
              onClick={async () => {
                if (await run(() => api("user:setActive", { id: u.id, active: u.status !== "Active" }))) {
                  closeModal()
                  notify("User status updated.")
                }
              }}
            >
              Confirm
            </Button>
          </div>
        </Modal>
      )
    }
    if (type === "user-password") {
      const u = data as User
      return (
        <Modal title={`Reset password for ${u.name}`} onClose={closeModal}>
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              const password = String(new FormData(e.currentTarget).get("password"))
              if (await run(() => api("user:resetPassword", { id: u.id, password }))) {
                closeModal()
                notify("Password changed.")
              }
            }}
          >
            <div className="modal-body">
              <Field label="New password" required hint="At least 6 characters. Tell the person privately.">
                <Input name="password" type="password" minLength={6} required autoFocus />
              </Field>
            </div>
            <div className="modal-footer">
              <Button type="button" onClick={closeModal}>Cancel</Button>
              <Button variant="primary" type="submit">Change password</Button>
            </div>
          </form>
        </Modal>
      )
    }
    if (type === "logout")
      return (
        <Modal title="Lock this workspace?" onClose={closeModal}>
          <div className="modal-body">
            <p>
              Everything is saved on this computer. Sign in again to continue.
            </p>
          </div>
          <div className="modal-footer">
            <Button onClick={closeModal}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                closeModal()
                void session.logout()
              }}
            >
              Lock workspace
            </Button>
          </div>
        </Modal>
      )
    if (type === "closing")
      return (
        <Modal title="Daily cash closing" description="Compare the money you counted with the recorded balance." onClose={closeModal}>
          <ClosingForm
            accounts={store.masters.accounts.filter((a) => a.active)}
            onClose={closeModal}
            onSubmit={async (v) => {
              const res = await run(() => api("closing:create", v))
              if (res) {
                closeModal()
                notify(res.variance ? `Closing recorded. Difference: ${money(res.variance)}.` : "Closing recorded. The cash is balanced.")
              }
            }}
          />
        </Modal>
      )
    if (type === "physical-count")
      return (
        <Modal title="Physical stock count" description="Enter the quantity you counted. Leave blank for items you did not count. Differences are adjusted and recorded." wide onClose={closeModal}>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const d: Record<string, string> = {}
              new FormData(e.currentTarget).forEach((v, k) => {
                d[k] = String(v)
              })
              void submitEntry(d)
            }}
          >
            <div className="modal-body">
              <CountSheet />
              <Field label="Notes">
                <Textarea name="notes" rows={2} placeholder="e.g. Monthly count" />
              </Field>
            </div>
            <div className="modal-footer">
              <Button type="button" onClick={closeModal}>Cancel</Button>
              <Button variant="primary" type="submit"><Check size={15} />Save count</Button>
            </div>
          </form>
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
                  placeholder="Party name or phone number"
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
              Today is {new Date(`${today}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}.
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
                {store.dashboard.inventory.reorder.toLocaleString()} items need
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
              <strong>
                {store.parties.filter((x) => x.balance > 0).length} parties have an outstanding balance
              </strong>
              <p>
                {store.parties.filter((x) => x.balance > 0).sort((x, y) => y.balance - x.balance).slice(0, 2).map((x) => x.name).join(" and ") || "Nobody owes you anything right now."}
              </p>
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
              Everything is stored on this computer. A backup is made every
              day and when you close the program.
            </div>
          </div>
        </Modal>
      )
    return null
  }
  if (!ready) return null
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
            <span className="avatar">{session.user.name.split(" ").map((x) => x[0]).join("").slice(0, 2).toUpperCase()}</span>
            <div>
              <strong>{session.user.name}</strong>
              <span>{session.user.role}</span>
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
              <span className="avatar small">{session.user.name.split(" ").map((x) => x[0]).join("").slice(0, 2).toUpperCase()}</span>
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

const PERMISSION_LABELS: [string, string, boolean][] = [
  ["sale.create", "Create sales", false],
  ["sale.void", "Cancel sales", true],
  ["sale.price_override", "Change the price of an item", true],
  ["sale.discount_override", "Give discounts above the limit", true],
  ["sale.credit_limit_override", "Sell beyond a party's credit limit", true],
  ["sale.backdate", "Enter back-dated transactions", true],
  ["purchase.create", "Create purchases", false],
  ["purchase.void", "Cancel purchases", true],
  ["payment.create", "Receive and make payments, transfer money", false],
  ["expense.create", "Record expenses", false],
  ["return.create", "Record returns and exchanges", false],
  ["return.no_invoice", "Accept a return without an invoice", true],
  ["stock.adjust", "Adjust stock and do stock counts", true],
  ["cash.close", "Close the daily cash", false],
  ["ledger.adjust", "Enter opening balances and ledger adjustments", true],
  ["catalog.manage", "Add and edit products", false],
  ["party.manage", "Add and edit parties and suppliers", false],
  ["report.view", "View reports", false],
  ["report.export", "Export reports", false],
  ["settings.manage", "Change settings", true],
  ["users.manage", "Manage users and roles", true],
  ["backup.restore", "Restore a backup", true],
]

function ClosingForm({ accounts, onClose, onSubmit }: { accounts: { name: string; balance: number }[]; onClose: () => void; onSubmit: (v: { account: string; date: string; counted: number; notes?: string }) => void | Promise<void> }) {
  const [account, setAccount] = useState(accounts[0]?.name ?? "")
  const balance = accounts.find((a) => a.name === account)?.balance ?? 0
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        void onSubmit({ account, date: String(f.get("date")), counted: Number(f.get("counted")), notes: String(f.get("notes") || "") })
      }}
    >
      <div className="modal-body">
        <Field label="Account" required>
          <Select value={account} onChange={(e) => setAccount(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.name}>{a.name}</option>
            ))}
          </Select>
        </Field>
        <div className="form-balance">
          <span>Recorded balance now</span>
          <strong>{money(balance)}</strong>
        </div>
        <div className="form-grid">
          <Field label="Closing date" required>
            <Input name="date" type="date" defaultValue={today} required />
          </Field>
          <Field label="Counted cash (Rs.)" required>
            <Input name="counted" type="number" min="0" required />
          </Field>
        </div>
        <Field label="Closing notes">
          <Textarea name="notes" rows={2} />
        </Field>
      </div>
      <div className="modal-footer">
        <Button type="button" onClick={onClose}>Cancel</Button>
        <Button variant="primary" type="submit"><Check size={15} />Record closing</Button>
      </div>
    </form>
  )
}
