import { useConfig, profiles, featureMeta, type ProfileId } from "./config"
import { BrandMark, useBusiness } from "./business"
import { useRef, useState } from "react"
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Database,
  Download,
  FileBarChart,
  FileText,
  FolderOpen,
  HardDrive,
  Landmark,
  LockKeyhole,
  Package,
  Plus,
  Printer,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Upload,
  Wallet,
} from "lucide-react"
import {
  Action,
  Heading,
  Input,
  Select,
  Textarea,
  Badge,
  Button,
  DataTable,
  ExportButton,
  Field,
  Loading,
  PageHeading,
  Panel,
  SearchBox,
  Tabs,
  downloadFile,
} from "./ui"
import {
  money,
  reportGroups,
  today,
  type Collection,
  type Expense,
  type Party,
  type Product,
  type Transaction,
} from "./data"

export function Reports({
  selected,
  onSelect,
  sales,
  purchases,
  parties,
  products,
  expenses,
  collections,
}: {
  selected?: string
  onSelect: (report: string) => void
  sales: Transaction[]
  purchases: Transaction[]
  parties: Party[]
  products: Product[]
  expenses: Expense[]
  collections: Collection[]
}) {
  const { business } = useBusiness()
  const [group, setGroup] = useState("Sales")
  const [query, setQuery] = useState("")
  const [from, setFrom] = useState("2025-06-01")
  const [to, setTo] = useState(today)
  const [range, setRange] = useState({ from: "2025-06-01", to: today })
  const [loading, setLoading] = useState(false)
  if (!selected)
    return (
      <>
        <PageHeading
          title="Reports"
          description="Clear answers to the questions that matter to your business."
        />
        <div className="report-featured">
          {[
            {
              title: "Daily Sales",
              subtitle: "Invoices, payments and sales totals",
              icon: FileBarChart,
            },
            {
              title: "Outstanding Report",
              subtitle: "See who owes you and how much",
              icon: Wallet,
            },
            {
              title: "Profit & Loss",
              subtitle: "Understand your business profitability",
              icon: TrendingIcon,
            },
          ].map((r) => (
            <Action onClick={() => onSelect(r.title)} key={r.title}>
              <span className="report-icon">
                <r.icon size={21} />
              </span>
              <div>
                <Heading level={3}>{r.title}</Heading>
                <p>{r.subtitle}</p>
              </div>
              <ArrowRight size={17} />
            </Action>
          ))}
        </div>
        <Panel>
          <div className="report-browser">
            <div className="report-categories">
              <Heading level={3}>REPORT CATEGORIES</Heading>
              {Object.keys(reportGroups).map((g) => (
                <Action
                  key={g}
                  onClick={() => setGroup(g)}
                  className={group === g ? "active" : ""}
                >
                  {g}
                  <span>{reportGroups[g].length}</span>
                </Action>
              ))}
            </div>
            <div className="report-list">
              <div className="report-list-header">
                <Heading level={2}>{group} reports</Heading>
                <SearchBox
                  value={query}
                  onChange={setQuery}
                  placeholder="Find a report…"
                />
              </div>
              {reportGroups[group]
                .filter((r) => r.toLowerCase().includes(query.toLowerCase()))
                .map((r, i) => (
                  <Action
                    className="report-list-item"
                    key={r}
                    onClick={() => onSelect(r)}
                  >
                    <FileText size={19} />
                    <div>
                      <strong>{r}</strong>
                      <span>
                        {i === 0
                          ? "Detailed summary with date filters and export"
                          : "Explore your business data by " +
                            r
                              .toLowerCase()
                              .replace("sales by ", "")
                              .replace("profitability", "")}
                      </span>
                    </div>
                    <ChevronRight size={17} />
                  </Action>
                ))}
            </div>
          </div>
        </Panel>
      </>
    )
  const isStock = /stock|inventory/i.test(selected)
  const isOutstanding =
    /outstanding|party|receivable|payable|aging|statement/i.test(selected)
  const isProfit = /profit/i.test(selected)
  const isPurchase = /purchase|supplier/i.test(selected) && !isOutstanding
  const isExpense = selected === "Expenses"
  const isCollection = /payments/i.test(selected)
  const filteredSales = (isPurchase ? purchases : sales).filter(
    (s) => s.date >= range.from && s.date <= range.to,
  )
  const total = filteredSales.reduce((s, r) => s + r.total, 0)
  const received = filteredSales.reduce((s, r) => s + r.paid, 0)
  const expenseTotal = expenses
    .filter((e) => e.date >= range.from && e.date <= range.to)
    .reduce((s, r) => s + r.amount, 0)
  const profitRows = [
    { id: "1", name: "Sales revenue", amount: total },
    {
      id: "2",
      name: "Cost of goods sold (sample weighted cost)",
      amount: -Math.round(total * 0.814),
    },
    { id: "3", name: "Gross profit", amount: Math.round(total * 0.186) },
    { id: "4", name: "Operating expenses", amount: -expenseTotal },
    {
      id: "5",
      name: "Net profit",
      amount: Math.round(total * 0.186) - expenseTotal,
    },
  ]
  const stockRows = products.filter((p) =>
    selected === "Low Stock"
      ? p.stock > 0 && p.stock < 10
      : selected === "Out of Stock"
        ? p.stock === 0
        : true,
  )
  const exportRows = isStock
    ? stockRows
    : isOutstanding
      ? parties
      : isProfit
        ? profitRows
        : isExpense
          ? expenses
          : isCollection
            ? collections
            : filteredSales
  const generate = () => {
    setLoading(true)
    setTimeout(() => {
      setRange({ from, to })
      setLoading(false)
    }, 400)
  }
  return (
    <>
      <PageHeading
        title={selected}
        description="Review, export or print your business report."
      >
        <Button onClick={() => onSelect("")}>
          <ArrowRight size={15} className="rotate-180" />
          All reports
        </Button>
        <ExportButton name={selected} rows={exportRows} />
        <Button onClick={() => window.print()}>
          <Printer size={15} />
          Print
        </Button>
      </PageHeading>
      <Panel>
        <div className="report-filters">
          <Field label="From date">
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label="To date">
            <Input
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
          <Field label="Business context">
            <Select>
              <option>
                All{" "}
                {isPurchase ? "suppliers" : isStock ? "companies" : "parties"}
              </option>
              {(isStock
                ? [...new Set(products.map((p) => p.company))]
                : parties.map((p) => p.name)
              ).map((p) => (
                <option key={p}>{p}</option>
              ))}
            </Select>
          </Field>
          <Button variant="primary" onClick={generate}>
            <FileBarChart size={15} />
            Generate report
          </Button>
        </div>
      </Panel>
      <div className="summary-grid three">
        <Summary
          label={
            isStock
              ? "Stock value"
              : isOutstanding
                ? "Total outstanding"
                : isProfit
                  ? "Sales revenue"
                  : "Total amount"
          }
          value={money(
            isStock
              ? products.reduce((s, p) => s + p.stock * p.cost, 0)
              : isOutstanding
                ? parties.reduce((s, p) => s + p.balance, 0)
                : total,
          )}
        />
        <Summary
          label={
            isStock
              ? "Total Thans"
              : isOutstanding
                ? "Parties with balances"
                : "Total received"
          }
          value={
            isStock
              ? String(products.reduce((s, p) => s + p.stock, 0))
              : isOutstanding
                ? String(parties.filter((p) => p.balance > 0).length)
                : money(received)
          }
        />
        <Summary
          label={
            isProfit
              ? "Net profit"
              : isStock
                ? "Low stock products"
                : "Remaining balance"
          }
          value={
            isProfit
              ? money(Math.round(total * 0.186) - expenseTotal)
              : isStock
                ? String(products.filter((p) => p.stock < 10).length)
                : money(total - received)
          }
          tone={isProfit ? "green" : ""}
        />
      </div>
      <Panel
        title="Report details"
        subtitle={`${range.from} to ${range.to} · ${business.name}`}
      >
        {loading ? (
          <Loading />
        ) : isStock ? (
          <DataTable
            rows={stockRows}
            pagination
            columns={[
              { key: "name", label: "Product" },
              { key: "company", label: "Company" },
              { key: "color", label: "Variant" },
              { key: "size", label: "Than size", render: (p) => `${p.size}m` },
              { key: "stock", label: "Available Thans", right: true },
              {
                key: "cost",
                label: "Avg. cost",
                right: true,
                render: (p) => money(p.cost),
              },
              {
                key: "value",
                label: "Stock value",
                right: true,
                render: (p) => money(p.stock * p.cost),
              },
            ]}
          />
        ) : isOutstanding ? (
          <DataTable
            rows={parties.filter((p) => p.balance > 0)}
            pagination
            columns={[
              { key: "id", label: "Code" },
              { key: "name", label: "Party" },
              { key: "city", label: "City" },
              { key: "phone", label: "Phone" },
              {
                key: "balance",
                label: "Outstanding",
                right: true,
                render: (p) => (
                  <strong className="red-text">{money(p.balance)}</strong>
                ),
              },
              {
                key: "status",
                label: "Status",
                render: (p) => <Badge>{p.status}</Badge>,
              },
            ]}
          />
        ) : isProfit ? (
          <DataTable
            rows={profitRows}
            columns={[
              {
                key: "name",
                label: "Particulars",
                render: (r) => <strong>{r.name}</strong>,
              },
              {
                key: "amount",
                label: "Amount (PKR)",
                right: true,
                render: (r) => (
                  <strong
                    className={
                      r.amount < 0
                        ? "red-text"
                        : r.name.includes("profit")
                          ? "green-text"
                          : ""
                    }
                  >
                    {money(r.amount)}
                  </strong>
                ),
              },
            ]}
          />
        ) : isExpense ? (
          <DataTable
            rows={expenses.filter(
              (e) => e.date >= range.from && e.date <= range.to,
            )}
            columns={[
              { key: "date", label: "Date" },
              { key: "category", label: "Category" },
              { key: "notes", label: "Notes" },
              { key: "account", label: "Account" },
              {
                key: "amount",
                label: "Amount",
                right: true,
                render: (e) => money(e.amount),
              },
            ]}
          />
        ) : isCollection ? (
          <DataTable
            rows={collections.filter(
              (c) => c.date >= range.from && c.date <= range.to,
            )}
            columns={[
              { key: "date", label: "Date" },
              { key: "party", label: "Party" },
              { key: "method", label: "Payment" },
              {
                key: "amount",
                label: "Amount",
                right: true,
                render: (c) => money(c.amount),
              },
            ]}
          />
        ) : (
          <DataTable
            rows={filteredSales}
            pagination
            columns={[
              { key: "date", label: "Date" },
              {
                key: "id",
                label: "Invoice",
                render: (r) => <span className="reference">{r.id}</span>,
              },
              { key: "party", label: isPurchase ? "Supplier" : "Party" },
              { key: "items", label: "Thans", right: true },
              {
                key: "total",
                label: "Total",
                right: true,
                render: (r) => money(r.total),
              },
              {
                key: "paid",
                label: "Paid",
                right: true,
                render: (r) => money(r.paid),
              },
              {
                key: "remaining",
                label: "Remaining",
                right: true,
                render: (r) => money(r.total - r.paid),
              },
            ]}
          />
        )}
      </Panel>
      {isProfit && (
        <div className="info-notice report-disclaimer">
          <ShieldCheck size={16} />
          Sample profitability uses an 18.6% gross margin. A production ledger
          requires transaction-level weighted costs.
        </div>
      )}
    </>
  )
}
function TrendingIcon() {
  return <FileBarChart size={21} />
}
export function Summary({
  label,
  value,
  tone = "",
}: {
  label: string
  value: string
  tone?: string
}) {
  return (
    <div className="summary-card">
      <span>{label}</span>
      <strong className={tone ? `${tone}-text` : ""}>{value}</strong>
    </div>
  )
}

export function Settings({ notify }: { notify: (message: string) => void }) {
  const { profile, flags, setProfile, setFlag } = useConfig()
  const sections = [
    "Business setup",
    "Features",
    "Sales settings",
    "Purchase settings",
    "Payment methods",
    "Cash / bank accounts",
    "Product categories",
    "Expense categories",
    "Than sizes",
    "Invoice numbering",
    "Return rules",
    "Backup settings",
    "Security",
  ].filter((name) => name !== "Than sizes" || flags.than)
  const [section, setSection] = useState("Business setup")
  const { business, saveBusiness } = useBusiness()
  const [logoDraft, setLogoDraft] = useState(business.logo)
  const logoInput = useRef<HTMLInputElement>(null)
  const pickLogo = (file: File | undefined) => {
    if (!file) return
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) return notify("Please choose a PNG, JPG, WebP or SVG image.")
    if (file.size > 300_000) return notify("The logo is too large. Please use an image under 300 KB.")
    const reader = new FileReader()
    reader.onload = () => setLogoDraft(String(reader.result))
    reader.readAsDataURL(file)
  }
  const [settings, setSettings] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem("raza-settings") || "{}")
    } catch {
      return {}
    }
  })
  const save = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (section === "Business setup") {
      const f = new FormData(e.currentTarget)
      const text = (k: string) => String(f.get(k) ?? "")
      void saveBusiness({
        name: text("businessName"),
        tagline: text("tagline"),
        owner: text("owner"),
        phone: text("phone"),
        email: text("email"),
        address: text("address"),
        city: text("city"),
        logo: logoDraft,
        invoiceFooter: text("invoiceFooter"),
      }).then((error) => notify(error ?? "Business details saved."))
      return
    }
    const next = {
      ...settings,
      ...Object.fromEntries(
        Array.from(new FormData(e.currentTarget), ([key, value]) => [
          key,
          String(value),
        ]),
      ),
    }
    e.currentTarget
      .querySelectorAll<HTMLInputElement>('input[type="checkbox"][name]')
      .forEach((input) => {
        next[input.name] = input.checked ? "on" : "off"
      })
    setSettings(next)
    localStorage.setItem("raza-settings", JSON.stringify(next))
    notify("Settings saved on this device.")
  }
  return (
    <>
      <PageHeading
        title="Settings"
        description="Make the application work the way your business does."
      />
      <div className="settings-layout">
        <Panel className="settings-navigation">
          {sections.map((s) => (
            <Action
              key={s}
              onClick={() => setSection(s)}
              className={section === s ? "active" : ""}
            >
              {s}
              <ChevronRight size={15} />
            </Action>
          ))}
        </Panel>
        <Panel
          title={section}
          subtitle="Changes apply to this local business workspace."
        >
          <form key={section} onSubmit={save}>
            <div className="settings-form">
              {section === "Business setup" ? (
                <>
                  <div className="business-logo-edit">
                    <BrandMark logo={logoDraft} />
                    <div>
                      <strong>{business.name}</strong>
                      <span>Business identity used on invoices and statements</span>
                      <div className="logo-actions">
                        <Button type="button" onClick={() => logoInput.current?.click()}>
                          Upload logo
                        </Button>
                        {logoDraft && (
                          <Button type="button" onClick={() => setLogoDraft("")}>
                            Remove
                          </Button>
                        )}
                      </div>
                      <input
                        ref={logoInput}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        hidden
                        onChange={(e) => {
                          pickLogo(e.target.files?.[0])
                          e.target.value = ""
                        }}
                      />
                    </div>
                  </div>
                  <Field label="Business name" required>
                    <Input name="businessName" required maxLength={80} defaultValue={business.name} />
                  </Field>
                  <Field label="Tagline (shown under the name)">
                    <Input name="tagline" maxLength={80} placeholder="e.g. Wholesale cloth merchants" defaultValue={business.tagline} />
                  </Field>
                  <div className="form-grid">
                    <Field label="Owner name">
                      <Input name="owner" defaultValue={business.owner} />
                    </Field>
                    <Field label="Contact number">
                      <Input name="phone" defaultValue={business.phone} />
                    </Field>
                  </div>
                  <Field label="Email">
                    <Input name="email" type="email" defaultValue={business.email} />
                  </Field>
                  <Field label="Business address">
                    <Textarea name="address" rows={2} defaultValue={business.address} />
                  </Field>
                  <div className="form-grid">
                    <Field label="City">
                      <Input name="city" defaultValue={business.city} />
                    </Field>
                    <Field label="Currency">
                      <Select name="currency">
                        <option>PKR — Pakistani Rupee</option>
                      </Select>
                    </Field>
                  </div>
                  <Field label="Invoice footer note">
                    <Input name="invoiceFooter" maxLength={200} placeholder="e.g. Goods once sold will not be returned" defaultValue={business.invoiceFooter} />
                  </Field>
                </>
              ) : section === "Features" ? (
                <>
{window.api ? (
                    <Field label="Business type">
                      <Input value={profiles[profile].name} readOnly />
                      <small className="muted">Set by your license. Contact your software provider to change it.</small>
                    </Field>
                  ) : (
                                      <Field label="Business profile">
                    <Select
                      value={profile}
                      onChange={async (e) => {
                        const next = e.target.value as ProfileId
                        const error = await setProfile(next)
                        notify(error ?? `Profile changed to ${profiles[next].name}.`)
                      }}
                    >
                      {(Object.keys(profiles) as ProfileId[]).map((id) => (
                        <option key={id} value={id}>
                          {profiles[id].name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  )}
                  <div className="info-notice">
                    <Package size={17} />
                    Turning a feature off hides its screens and fields. Existing
                    records are kept.
                  </div>
                  {featureMeta
                    .filter((f) => f.wired)
                    .map((f) => (
                      <div className="setting-toggle" key={f.key}>
                        <div>
                          <strong>{f.title}</strong>
                          <span>{f.description}</span>
                        </div>
                        <Input
                          type="checkbox"
                          checked={flags[f.key]}
                          onChange={async (e) => {
                            const error = await setFlag(f.key, e.target.checked)
                            if (error) notify(error)
                          }}
                        />
                      </div>
                    ))}
                </>
              ) : section === "Than sizes" ? (
                <>
                  <div className="info-notice">
                    <Package size={17} />
                    Common Than sizes offered as suggestions when adding items.
                    You can always type any size.
                  </div>
                  {["25", "30", "40", "50"].map((size) => (
                    <div className="setting-toggle" key={size}>
                      <div>
                        <strong>{size} meters</strong>
                        <span>Available product Than size</span>
                      </div>
                      <Input
                        type="checkbox"
                        name={`than-${size}`}
                        defaultChecked={size === "25" || size === "30"}
                      />
                    </div>
                  ))}
                </>
              ) : /categories|methods|accounts/i.test(section) ? (
                <>
                  <Field label={section}>
                    <Textarea
                      name={section}
                      rows={7}
                      defaultValue={
                        settings[section] ||
                        (section === "Product categories"
                          ? "Cotton\nWash & Wear\nLawn\nSuiting\nKhaddar\nDobby"
                          : section === "Expense categories"
                            ? "Transportation\nUtilities\nRent\nSalaries\nOffice supplies"
                            : section === "Payment methods"
                              ? "Cash\nBank transfer\nCheque"
                              : "Cash in hand\nMeezan Bank\nHBL Business")
                      }
                    />
                  </Field>
                  <p className="muted">
                    One entry per line. Existing transaction history is
                    preserved.
                  </p>
                </>
              ) : section === "Invoice numbering" ? (
                <>
                  <Field label="Sales invoice prefix">
                    <Input
                      name="salePrefix"
                      defaultValue={settings.salePrefix || "INV-"}
                    />
                  </Field>
                  <Field label="Purchase invoice prefix">
                    <Input
                      name="purchasePrefix"
                      defaultValue={settings.purchasePrefix || "PUR-"}
                    />
                  </Field>
                  <Field label="Next sales invoice number">
                    <Input
                      name="nextInvoice"
                      type="number"
                      min="1049"
                      defaultValue="1049"
                    />
                  </Field>
                  <div className="info-notice">
                    <FileText size={17} />
                    Invoice references must remain unique.
                  </div>
                </>
              ) : (
                <>
                  {(section === "Security"
                    ? [
                        "Require password for financial actions",
                        "Lock application after inactivity",
                        "Record all sensitive actions in audit log",
                      ]
                    : section === "Backup settings"
                      ? [
                          "Enable automatic daily backup",
                          "Create a backup before restoring",
                          "Keep the last 30 backups",
                        ]
                      : section === "Return rules"
                        ? [
                            "Require original invoice for returns",
                            "Require owner approval",
                            "Allow refunds to the original payment account",
                          ]
                        : [
                            "Allow credit transactions",
                            "Show balance before saving",
                            "Print after saving",
                          ]
                  ).map((s, i) => (
                    <div className="setting-toggle" key={s}>
                      <div>
                        <strong>{s}</strong>
                        <span>
                          {i === 0
                            ? "Recommended for your business"
                            : "Applies to all users on this device"}
                        </span>
                      </div>
                      <Input
                        type="checkbox"
                        name={`${section}-${i}`}
                        defaultChecked={
                          settings[`${section}-${i}`] === undefined
                            ? i < 2
                            : settings[`${section}-${i}`] === "on"
                        }
                      />
                    </div>
                  ))}
                  <Field
                    label={
                      section === "Security"
                        ? "Auto-lock after (minutes)"
                        : "Default payment terms (days)"
                    }
                  >
                    <Input
                      name={`${section}-period`}
                      type="number"
                      min="1"
                      defaultValue={
                        settings[`${section}-period`] ||
                        (section === "Security" ? "15" : "30")
                      }
                    />
                  </Field>
                </>
              )}
            </div>
            <div className="modal-footer">
              <Button type="reset">Reset changes</Button>
              <Button type="submit" variant="primary">
                <Save size={16} />
                Save settings
              </Button>
            </div>
          </form>
        </Panel>
      </div>
    </>
  )
}

export function Backup({
  lastBackup,
  onBackup,
  onRestore,
}: {
  lastBackup: string
  onBackup: () => void
  onRestore: (file: File) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [automatic, setAutomatic] = useState(true)
  return (
    <>
      <PageHeading
        title="Backup & restore"
        description="Keep a safe copy of your business records."
      />
      <div className="backup-banner">
        <span className="backup-shield">
          <ShieldCheck size={28} />
        </span>
        <div>
          <Heading level={2}>Your business data, safely in your hands</Heading>
          <p>
            Your workspace is stored on this device. Download a backup regularly
            and keep a second copy on an external drive.
          </p>
        </div>
        <Badge tone="green">Local data available</Badge>
      </div>
      <div className="summary-grid three">
        <Summary
          label="Last downloaded backup"
          value={lastBackup || "Not created yet"}
        />
        <Summary label="Backup format" value="JSON · Local workspace" />
        <Summary label="Storage" value="This browser / device" />
      </div>
      <div className="backup-grid">
        <Panel
          title="Create a backup"
          subtitle="Export a copy of all workspace records"
        >
          <div className="backup-content">
            <div className="backup-big-icon">
              <Database size={31} />
            </div>
            <Heading level={3}>Back up your business</Heading>
            <p>
              Includes sales, purchases, parties, stock, collections, expenses
              and movement history.
            </p>
            <div className="backup-location">
              <FolderOpen size={19} />
              <div>
                <strong>Device downloads folder</strong>
                <span>
                  Choose a destination in your browser’s download dialog
                </span>
              </div>
            </div>
            <Button variant="primary" onClick={onBackup}>
              <Download size={16} />
              Backup now
            </Button>
          </div>
        </Panel>
        <Panel
          title="Restore a backup"
          subtitle="Recover records from an existing backup file"
        >
          <div className="backup-content">
            <div className="backup-big-icon">
              <RotateCcw size={31} />
            </div>
            <Heading level={3}>Restore your workspace</Heading>
            <p>
              Select a workspace backup. You’ll review a confirmation before
              current records are replaced.
            </p>
            <div className="info-notice">
              <ShieldCheck size={17} />A safety copy of your current records
              will be downloaded before restoring.
            </div>
            <Input
              type="file"
              accept=".json,application/json"
              ref={ref}
              hidden
              onChange={(e) => {
                if (e.target.files?.[0]) onRestore(e.target.files[0])
                e.target.value = ""
              }}
            />
            <Button onClick={() => ref.current?.click()}>
              <Upload size={16} />
              Choose backup to restore
            </Button>
          </div>
        </Panel>
      </div>
      <Panel title="Backup recommendations">
        <div className="backup-recommendations">
          {[
            "Download a backup at the end of every business day.",
            "Keep a second copy on a USB drive or a different device.",
            "Check the backup date before restoring.",
          ].map((t) => (
            <div key={t}>
              <CheckCircle2 size={17} />
              <span>{t}</span>
            </div>
          ))}
        </div>
        <div className="panel-note">
          <Clock3 size={14} />
          Scheduled background backups require a native desktop service and are
          not enabled in this web prototype.
        </div>
      </Panel>
    </>
  )
}

export function Returns({
  sales,
  purchases,
  onReturn,
}: {
  sales: Transaction[]
  purchases: Transaction[]
  onReturn: (
    transaction: Transaction,
    quantities: Record<string, number>,
    type: string,
  ) => void
}) {
  const [tab, setTab] = useState("Sales return")
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<Transaction | null>(null)
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState("")
  const transactions = tab === "Sales return" ? sales : purchases
  const total =
    selected?.lines?.reduce(
      (sum, line) =>
        sum +
        (quantities[line.productId] || 0) *
          (line.rate - line.discount / line.qty),
      0,
    ) || 0
  function proceed() {
    if (!selected || total <= 0)
      return setError("Select at least one item to return.")
    if (
      selected.lines?.some(
        (line) =>
          !Number.isInteger(quantities[line.productId] || 0) ||
          (quantities[line.productId] || 0) > line.qty ||
          (quantities[line.productId] || 0) < 0,
      )
    )
      return setError(
        "Return quantities must be whole numbers within the original quantity.",
      )
    if (!confirm) return setConfirm(true)
    onReturn(selected, quantities, tab)
    setSelected(null)
    setQuantities({})
    setConfirm(false)
    setError("")
  }
  return (
    <>
      <PageHeading
        title="Returns"
        description="Return against an original invoice, with a clear stock and balance adjustment."
      />
      <Tabs
        tabs={["Sales return", "Purchase return"]}
        active={tab}
        onChange={(t) => {
          setTab(t)
          setSelected(null)
          setConfirm(false)
        }}
      />
      <div className="returns-steps">
        <span className="active">
          <i>1</i>Find invoice
        </span>
        <ChevronRight size={16} />
        <span className={selected ? "active" : ""}>
          <i>2</i>Select items
        </span>
        <ChevronRight size={16} />
        <span className={confirm ? "active" : ""}>
          <i>3</i>Review & confirm
        </span>
      </div>
      <Panel
        title="Find original transaction"
        subtitle="Search an invoice number, party or supplier"
      >
        <div className="padded-search">
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder="Search invoice or party…"
          />
        </div>
        <DataTable
          rows={transactions
            .filter((s) =>
              `${s.id} ${s.party}`.toLowerCase().includes(query.toLowerCase()),
            )
            .slice(0, 6)}
          onRow={(s) => {
            setSelected(s)
            setQuantities({})
            setConfirm(false)
            setError("")
          }}
          columns={[
            {
              key: "id",
              label: "Invoice",
              render: (s) => <span className="reference">{s.id}</span>,
            },
            {
              key: "party",
              label: tab === "Sales return" ? "Party" : "Supplier",
            },
            { key: "date", label: "Date" },
            { key: "items", label: "Thans", right: true },
            {
              key: "total",
              label: "Amount",
              right: true,
              render: (s) => money(s.total),
            },
            {
              key: "action",
              label: "",
              render: (s) => (
                <Button
                  variant={selected?.id === s.id ? "primary" : "secondary"}
                >
                  {selected?.id === s.id ? (
                    <Check size={14} />
                  ) : (
                    <Plus size={14} />
                  )}
                  {selected?.id === s.id ? "Selected" : "Select"}
                </Button>
              ),
            },
          ]}
        />
      </Panel>
      {selected && (
        <Panel
          title={`Return items · ${selected.id}`}
          subtitle={selected.party}
        >
          <DataTable
            rows={selected.lines || []}
            empty="This invoice does not contain item-level records"
            columns={[
              { key: "name", label: "Product" },
              { key: "color", label: "Variant" },
              { key: "qty", label: "Original qty", right: true },
              {
                key: "rate",
                label: "Rate",
                right: true,
                render: (l) => money(l.rate),
              },
              {
                key: "return",
                label: "Return qty",
                render: (l) => (
                  <Input
                    aria-label={`Return quantity for ${l.name}`}
                    className="qty-input"
                    type="number"
                    min="0"
                    max={l.qty}
                    value={quantities[l.productId] || 0}
                    onChange={(e) => {
                      setQuantities({
                        ...quantities,
                        [l.productId]: +e.target.value,
                      })
                      setConfirm(false)
                    }}
                  />
                ),
              },
            ]}
          />
          <div className="return-review">
            <div>
              <span>Return amount</span>
              <strong>{money(total)}</strong>
            </div>
            <div>
              <span>Stock impact</span>
              <strong>
                {tab === "Sales return" ? "+" : "−"}
                {Object.values(quantities).reduce((s, q) => s + q, 0)} Thans
              </strong>
            </div>
            <div>
              <span>Balance adjustment</span>
              <strong>
                {tab === "Sales return" ? "Customer credit" : "Supplier debit"}
              </strong>
            </div>
          </div>
          <div className="modal-body">
            <Field label="Reason for return">
              <Select>
                <option>Fabric quality issue</option>
                <option>Incorrect item</option>
                <option>Excess quantity</option>
                <option>Other</option>
              </Select>
            </Field>
            {confirm && (
              <div className="confirm-notice">
                <strong>Confirm this {tab.toLowerCase()}?</strong>
                <p>
                  Stock and the party ledger will be adjusted by {money(total)}.
                  Returns are recorded as a separate transaction; the original
                  invoice is preserved.
                </p>
              </div>
            )}
            {error && <div className="form-error">{error}</div>}
          </div>
          <div className="modal-footer">
            <Button
              onClick={() => {
                setSelected(null)
                setConfirm(false)
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" onClick={proceed}>
              <RotateCcw size={15} />
              {confirm ? "Confirm return" : "Review return"}
            </Button>
          </div>
        </Panel>
      )}
    </>
  )
}
