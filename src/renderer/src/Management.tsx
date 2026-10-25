import { useConfig, profiles, featureMeta } from "./config"
import { BrandMark, useBusiness, type Business } from "./business"
import { applyTextSize, applyTheme, readTextSize, readTheme, type TextSize, type Theme } from "./display"
import { api } from "./backend"
import type { BackupInfo, BackupStatus, BackupSummary } from "@shared/ipc"
import { PROFIT_REPORTS } from "@shared/profiles"
import { INVOICE_DESIGNS, type Masters, type ReportResult, type ReturnRow } from "@shared/models"
import { useEffect, useRef, useState } from "react"
import { useDebounced, useRemote } from "./remote"
import { DesignSample, ProductPicker } from "./Workflows"
import { ColoursEditor } from "./colours"
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
  Users,
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
  L,
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
  historyFrom,
  parties,
  suppliers,
  companies,
  cities,
  accounts,
  canExport,
}: {
  selected?: string
  onSelect: (report: string) => void
  historyFrom: string
  parties: Party[]
  suppliers: Party[]
  companies: string[]
  cities: string[]
  accounts: { name: string; type: string }[]
  canExport: boolean
}) {
  const { business } = useBusiness()
  const { isEnabled } = useConfig()
  const [group, setGroup] = useState("Sales")
  const [query, setQuery] = useState("")
  const [from, setFrom] = useState(historyFrom)
  const [to, setTo] = useState(today)
  const [range, setRange] = useState({ from: historyFrom, to: today })
  const [filter, setFilter] = useState("")
  const [data, setData] = useState<ReportResult | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!selected) return
    let alive = true
    setLoading(true)
    setError("")
    api("report:run", { name: selected, from: range.from, to: range.to, filter: filter || undefined })
      .then((r) => alive && setData(r))
      .catch((e) => alive && (setError((e as Error).message), setData(null)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [selected, range, filter, tick])
  const visibleGroups = Object.fromEntries(
    Object.entries(reportGroups)
      .map(([g, list]) => [g, list.filter((r) => (PROFIT_REPORTS.includes(r) && !isEnabled("profit") ? false : r === "Sales by City" || r === "City-wise Analysis" || r === "City Profitability" ? isEnabled("cityWise") : /Near Expiry|Expired Items|Batch Stock/.test(r) ? isEnabled("expiry") || isEnabled("batch") : true))])
      .filter(([, list]) => (list as string[]).length > 0),
  ) as Record<string, string[]>
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
          ]
            .filter((r) => isEnabled("profit") || !PROFIT_REPORTS.includes(r.title))
            .map((r) => (
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
              {Object.keys(visibleGroups).map((g) => (
                <Action
                  key={g}
                  onClick={() => setGroup(g)}
                  className={group === g ? "active" : ""}
                >
                  {g}
                  <span>{visibleGroups[g].length}</span>
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
              {(visibleGroups[group] ?? [])
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
  const supplierReport = /supplier|purchase|payable/i.test(selected) && !/profit/i.test(selected)
  const contextOptions = /Company/.test(selected)
    ? companies
    : /City/.test(selected)
      ? cities
      : /Cash Book/.test(selected)
        ? accounts.filter((a) => a.type === "cash").map((a) => a.name)
        : /Bank Book/.test(selected)
          ? accounts.filter((a) => a.type === "bank").map((a) => a.name)
          : supplierReport
            ? suppliers.map((p) => p.name)
            : parties.map((p) => p.name)
  const cell = (kind: string | undefined, v: string | number) => (kind === "money" ? money(Number(v)) : kind === "number" ? Number(v).toLocaleString("en-PK") : String(v))
  const fmtSummary = (x: ReportResult["summary"][number]) => (x.kind === "money" ? money(Number(x.value)) : x.kind === "number" ? Number(x.value).toLocaleString("en-PK") : String(x.value))
  return (
    <>
      <PageHeading title={selected} description="Review, export or print your business report.">
        <Button onClick={() => onSelect("")}>
          <ArrowRight size={15} className="rotate-180" />
          All reports
        </Button>
        {canExport && data && <ExportButton name={selected} rows={data.rows.map((r) => Object.fromEntries(data.columns.map((c) => [c.label, r[c.key]])))} />}
        <Button onClick={() => window.print()}>
          <Printer size={15} />
          Print
        </Button>
      </PageHeading>
      <Panel>
        <div className="report-filters">
          <Field label="From date">
            <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To date">
            <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label="Narrow down to">
            <Select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">Everything</option>
              {contextOptions.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </Select>
          </Field>
          <Button
            variant="primary"
            onClick={() => {
              setRange({ from, to })
              setTick((n) => n + 1)
            }}
          >
            <FileBarChart size={15} />
            Generate report
          </Button>
        </div>
      </Panel>
      {data && (
        <div className="summary-grid three">
          {data.summary.map((x) => (
            <Summary key={x.label} label={x.label} value={fmtSummary(x)} tone={x.tone ?? ""} />
          ))}
        </div>
      )}
      <Panel title="Report details" subtitle={`${range.from} to ${range.to} · ${business.name}`}>
        {loading ? (
          <Loading />
        ) : error ? (
          <div className="form-error">{error}</div>
        ) : data ? (
          <DataTable
            rows={data.rows.map((r, i) => ({ ...r, id: String(i) })) as { id: string }[]}
            pagination
            empty="Nothing to show for these dates."
            columns={data.columns.map((c) => ({
              key: c.key,
              label: c.label,
              right: c.kind === "money" || c.kind === "number",
              render: (r: Record<string, string | number>) => (c.key === "ref" ? <span className="reference">{r[c.key]}</span> : cell(c.kind, r[c.key] as string | number)),
            })) as never}
          />
        ) : null}
      </Panel>
      {data?.note && (
        <div className="info-notice report-disclaimer">
          <ShieldCheck size={16} />
          {data.note}
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

const IMMEDIATE = ["Features", "Payment methods", "Cash / bank accounts", "Product categories", "Colours", "Expense categories", "Than sizes", "Invoice numbering", "Salesmen & recovery"]

function ListEditor({ items, onAdd, onRemove, placeholder, empty }: { items: string[]; onAdd: (name: string) => unknown; onRemove?: (name: string) => unknown; placeholder: string; empty: string }) {
  const [value, setValue] = useState("")
  return (
    <>
      <div className="list-editor-add">
        <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (value.trim()) { void onAdd(value.trim()); setValue("") } } }} />
        <Button type="button" onClick={() => { if (value.trim()) { void onAdd(value.trim()); setValue("") } }}>
          <Plus size={15} />
          Add
        </Button>
      </div>
      {items.length === 0 && <p className="muted">{empty}</p>}
      {items.map((i) => (
        <div className="setting-toggle" key={i}>
          <div>
            <strong>{i}</strong>
          </div>
          {onRemove && (
            <Button type="button" variant="ghost" onClick={() => void onRemove(i)}>
              Remove
            </Button>
          )}
        </div>
      ))}
    </>
  )
}

export function Settings({
  notify,
  masters,
  run,
  canManage,
}: {
  notify: (message: string) => void
  masters: Masters
  run: <T>(fn: () => Promise<T>) => Promise<T | undefined>
  canManage: boolean
}) {
  const { profile, flags, setFlag } = useConfig()
  const sections = [
    "Business setup",
    "Features",
    "Sales & credit",
    "Printing",
    "Payment methods",
    "Cash / bank accounts",
    "Product categories",
    "Colours",
    "Expense categories",
    "Than sizes",
    "Invoice numbering",
    "Salesmen & recovery",
    "Return rules",
    "Regional",
    "Security",
  ].filter((name) => name !== "Than sizes" || flags.than)
  const [section, setSection] = useState("Business setup")
  const { business, saveBusiness } = useBusiness()
  const [logoDraft, setLogoDraft] = useState(business.logo)
  const [accentDraft, setAccentDraft] = useState<Business["accent"]>(business.accent)
  const [textSize, setTextSize] = useState<TextSize>(readTextSize)
  const [theme, setTheme] = useState<Theme>(readTheme)
  const logoInput = useRef<HTMLInputElement>(null)
  const st = masters.settings
  const [design, setDesign] = useState<string>(() => st["invoice.design"] ?? "modern")
  const get = (k: string, d: string) => st[k] ?? d
  const put = (key: string, value: string, message = "Saved.") => run(() => api("settings:set", { key, value })).then((r) => r !== undefined && notify(message))
  const pickLogo = (file: File | undefined) => {
    if (!file) return
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) return notify("Please choose a PNG, JPG, WebP or SVG image.")
    if (file.size > 300_000) return notify("The logo is too large. Please use an image under 300 KB.")
    const reader = new FileReader()
    reader.onload = () => setLogoDraft(String(reader.result))
    reader.readAsDataURL(file)
  }
  const [newCat, setNewCat] = useState("")
  const [subOf, setSubOf] = useState("")
  const [newSub, setNewSub] = useState("")
  const [pw, setPw] = useState({ current: "", next: "", again: "" })
  const jsonList = (key: string) => {
    try {
      const v = JSON.parse(get(key, "[]"))
      return Array.isArray(v) ? (v as string[]) : []
    } catch {
      return []
    }
  }
  const methods = masters.paymentMethods
  const save = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const text = (k: string) => String(f.get(k) ?? "")
    if (section === "Business setup") {
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
        accent: accentDraft,
      }).then((error) => notify(error ?? "Business details saved."))
      return
    }
    const pairs: [string, string][] =
      section === "Sales & credit"
        ? [["credit.limit_mode", text("mode")], ["sales.max_discount_percent", text("discount") || "100"], ["stock.allow_negative", f.get("negative") ? "on" : "off"], ["receipts.allow_overpayment", f.get("overpay") ? "on" : "off"]]
        : section === "Printing"
          ? [["invoice.layout", text("layout")], ["invoice.design", design], ["print.thermal_width", text("width")]]
          : section === "Return rules"
            ? [["returns.window_days", text("days") || "0"]]
            : section === "Regional"
              ? [["timezone_offset_minutes", text("offset")], ...(flags.expiry ? ([["expiry.warning_days", text("expiry") || "30"]] as [string, string][]) : [])]
              : []
    void (async () => {
      for (const [k, v] of pairs) {
        if ((await run(() => api("settings:set", { key: k, value: v }))) === undefined) return
      }
      notify("Settings saved.")
    })()
  }
  return (
    <>
      <PageHeading title="Settings" description="Make the application work the way your business does." />
      <div className="settings-layout">
        <Panel className="settings-navigation">
          {sections.map((s) => (
            <Action key={s} onClick={() => setSection(s)} className={section === s ? "active" : ""}>
              {s}
              <ChevronRight size={15} />
            </Action>
          ))}
        </Panel>
        <Panel title={section} subtitle={canManage ? "Changes apply to this business." : "You can view these settings but not change them."}>
          <form key={section} onSubmit={save}>
            <fieldset disabled={!canManage} className="settings-fieldset">
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
                  <Field label="Screen colour">
                    <div className="accent-picker" role="group" aria-label="Screen colour">
                      {ACCENT_CHOICES.map(([id, label, sw]) => (
                        <button
                          type="button"
                          key={id}
                          className="accent-option"
                          style={{ "--sw": sw } as React.CSSProperties}
                          aria-pressed={accentDraft === id}
                          onClick={() => {
                            setAccentDraft(id)
                            document.documentElement.dataset.accent = id
                          }}
                        >
                          <span className="swatch" />
                          {label}
                        </button>
                      ))}
                    </div>
                    <small className="muted">Changes the buttons and highlights on screen. Printed invoices stay black and white. Press Save to keep it.</small>
                  </Field>
                  <Field label="Screen theme on this computer">
                    <div className="accent-picker" role="group" aria-label="Screen theme">
                      {(["light", "dark"] as Theme[]).map((t) => (
                        <button
                          type="button"
                          key={t}
                          className="accent-option"
                          style={{ "--sw": t === "dark" ? "#1b2233" : "#f6f7fa" } as React.CSSProperties}
                          aria-pressed={theme === t}
                          onClick={() => {
                            setTheme(t)
                            applyTheme(t)
                          }}
                        >
                          <span className="swatch" />
                          {t === "dark" ? "Dark" : "Light"}
                        </button>
                      ))}
                    </div>
                    <small className="muted">Applies at once and is remembered on this computer only. Printed bills always stay black on white.</small>
                  </Field>
                  <Field label="Text size on this computer">
                    <div className="accent-picker" role="group" aria-label="Text size">
                      {TEXT_CHOICES.map(([id, label]) => (
                        <button
                          type="button"
                          key={id}
                          className="accent-option"
                          style={{ "--sw": "var(--primary)" } as React.CSSProperties}
                          aria-pressed={textSize === id}
                          onClick={() => {
                            setTextSize(id)
                            applyTextSize(id)
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <small className="muted">Applies at once and is remembered on this computer only. Printed documents are not affected.</small>
                  </Field>
                </>
              ) : section === "Features" ? (
                <>
<Field label="Business type">
                    <Input value={profiles[profile].name} readOnly />
                    <small className="muted">Set by your license. Contact your software provider to change it.</small>
                  </Field>
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
              ) : section === "Sales & credit" ? (
                <>
                  <Field label="Credit limit" hint="What happens when a sale would take a party above their credit limit.">
                    <Select name="mode" defaultValue={get("credit.limit_mode", "off")}>
                      <option value="off">Off: do not check</option>
                      <option value="warn">Warn: show a warning but allow the sale</option>
                      <option value="block">Block: refuse unless a permitted user overrides</option>
                    </Select>
                  </Field>
                  <Field label="Discount above this percent needs permission" hint="100 means no limit.">
                    <Input name="discount" type="number" min="0" max="100" defaultValue={get("sales.max_discount_percent", "100")} />
                  </Field>
                  <div className="setting-toggle">
                    <div>
                      <strong>Allow selling more than the stock shown</strong>
                      <span>Normally off. When on, stock can go below zero.</span>
                    </div>
                    <Input type="checkbox" name="negative" defaultChecked={get("stock.allow_negative", "off") === "on"} />
                  </div>
                  <div className="setting-toggle">
                    <div>
                      <strong>Allow a payment larger than what is owed</strong>
                      <span>Normally off. When on, a party can pay in advance.</span>
                    </div>
                    <Input type="checkbox" name="overpay" defaultChecked={get("receipts.allow_overpayment", "off") === "on"} />
                  </div>
                </>
              ) : section === "Printing" ? (
                <>
                  <Field label="Default document layout">
                    <Select name="layout" defaultValue={get("invoice.layout", "A4 invoice")}>
                      <option>A4 invoice</option>
                      <option>Thermal receipt</option>
                    </Select>
                  </Field>
                  <Field label="A4 bill design" hint="Pick the look of the A4 bill. Press Save to keep it. Thermal receipts have one fixed look.">
                    <input type="hidden" name="design" value={design} />
                    <div className="design-gallery" role="radiogroup" aria-label="A4 bill design">
                      {INVOICE_DESIGNS.map(([id, label, note]) => (
                        <button type="button" key={id} role="radio" aria-checked={design === id} className="design-option" onClick={() => setDesign(id)}>
                          <div className="design-thumb">
                            <DesignSample design={id} />
                          </div>
                          <strong>{label}</strong>
                          <span>{note}</span>
                        </button>
                      ))}
                    </div>
                  </Field>
                  <Field label="Thermal paper width">
                    <Select name="width" defaultValue={get("print.thermal_width", "80")}>
                      <option value="80">80 mm</option>
                      <option value="58">58 mm</option>
                    </Select>
                  </Field>
                  <div className="info-notice">
                    <Printer size={17} />
                    You can switch between A4 and thermal on any invoice preview before printing.
                  </div>
                </>
              ) : section === "Payment methods" ? (
                <ListEditor
                  items={methods}
                  placeholder="e.g. Easypaisa"
                  empty="No payment methods."
                  onAdd={(n) => put("payment.methods", JSON.stringify([...methods, n]), "Payment method added.")}
                  onRemove={methods.length > 1 ? (n) => put("payment.methods", JSON.stringify(methods.filter((m) => m !== n)), "Payment method removed.") : undefined}
                />
              ) : section === "Cash / bank accounts" ? (
                <>
                  <AccountsEditor accounts={masters.accounts} run={run} notify={notify} />
                </>
              ) : section === "Product categories" ? (
                <>
                  <p className="muted">Categories are optional. They help you filter and report; products work without them.</p>
                  <Field label="Companies / brands">
                    <ListEditor
                      items={masters.companies}
                      placeholder="New company or brand"
                      empty="No companies yet. They are also created automatically when you add a product."
                      onAdd={(n) => run(() => api("master:add", { kind: "company", name: n })).then((r) => r !== undefined && notify("Company added."))}
                    />
                  </Field>
                  <Field label="Categories">
                    <div className="list-editor-add">
                      <Input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="New category" />
                      <Button type="button" onClick={() => newCat.trim() && run(() => api("master:add", { kind: "category", name: newCat.trim() })).then((r) => r !== undefined && (setNewCat(""), notify("Category added.")))}>
                        <Plus size={15} />
                        Add
                      </Button>
                    </div>
                  </Field>
                  {masters.categories.map((c) => (
                    <div className="setting-toggle" key={c.name}>
                      <div>
                        <strong>{c.name}</strong>
                        <span>{c.sub.length ? c.sub.join(", ") : "No subcategories"}</span>
                      </div>
                    </div>
                  ))}
                  {masters.categories.length > 0 && (
                    <div className="list-editor-add">
                      <Select value={subOf} onChange={(e) => setSubOf(e.target.value)}>
                        <option value="">Add a subcategory to…</option>
                        {masters.categories.map((c) => (
                          <option key={c.name}>{c.name}</option>
                        ))}
                      </Select>
                      <Input value={newSub} onChange={(e) => setNewSub(e.target.value)} placeholder="Subcategory name" />
                      <Button type="button" onClick={() => subOf && newSub.trim() && run(() => api("master:add", { kind: "subcategory", name: newSub.trim(), parent: subOf })).then((r) => r !== undefined && (setNewSub(""), notify("Subcategory added.")))}>
                        <Plus size={15} />
                        Add
                      </Button>
                    </div>
                  )}
                </>
              ) : section === "Colours" ? (
                <ColoursEditor run={run} notify={notify} canManage={canManage} />
              ) : section === "Expense categories" ? (
                <ListEditor items={masters.expenseCategories} placeholder="e.g. Fuel" empty="No expense categories." onAdd={(n) => run(() => api("master:add", { kind: "expenseCategory", name: n })).then((r) => r !== undefined && notify("Category added."))} />
              ) : section === "Than sizes" ? (
                <>
                  <div className="info-notice">
                    <Package size={17} />
                    Common sizes offered as suggestions when adding products. You can always type any size, such as "40 meter".
                  </div>
                  <ListEditor
                    items={jsonList("than.sizes")}
                    placeholder='e.g. 40 meter'
                    empty="No suggestions yet."
                    onAdd={(n) => put("than.sizes", JSON.stringify([...jsonList("than.sizes"), n]), "Size added.")}
                    onRemove={(n) => put("than.sizes", JSON.stringify(jsonList("than.sizes").filter((x) => x !== n)), "Size removed.")}
                  />
                </>
              ) : section === "Invoice numbering" ? (
                <>
                  <div className="setting-toggle">
                    <div>
                      <strong>Allow changing document numbers</strong>
                      <span>When on, you can type the bill-book number on a sale and use "Change number" on bills, receipts, pay slips and expenses. Turn off to lock numbers to automatic.</span>
                    </div>
                    <Input
                      type="checkbox"
                      aria-label="Allow changing document numbers"
                      defaultChecked={get("invoice.allow_number_change", "on") === "on"}
                      onChange={(e) => put("invoice.allow_number_change", e.target.checked ? "on" : "off", e.target.checked ? "Document numbers can be changed." : "Document numbers are now automatic only.")}
                    />
                  </div>
                  <SequenceEditor sequences={masters.sequences} run={run} notify={notify} />
                </>
              ) : section === "Salesmen & recovery" ? (
                <StaffEditor staff={masters.staff} run={run} notify={notify} />
              ) : section === "Return rules" ? (
                <>
                  <Field label="Accept returns within (days)" hint="0 means there is no time limit. A person with the right permission can always override.">
                    <Input name="days" type="number" min="0" max="3650" defaultValue={get("returns.window_days", "0")} />
                  </Field>
                  <div className="info-notice">
                    <ShieldCheck size={17} />
                    A return is always recorded against the original invoice. Returning without an invoice needs the "Accept a return without an invoice" permission.
                  </div>
                </>
              ) : section === "Regional" ? (
                <>
                  <Field label="Time zone (minutes ahead of UTC)" hint="Pakistan is 300 (UTC+5). This decides where one business day ends and the next begins.">
                    <Input name="offset" type="number" min="-720" max="840" defaultValue={get("timezone_offset_minutes", "300")} />
                  </Field>
                  {flags.expiry && (
                    <Field label="Warn about expiry this many days ahead">
                      <Input name="expiry" type="number" min="1" max="365" defaultValue={get("expiry.warning_days", "30")} />
                    </Field>
                  )}
                </>
              ) : (
                <>
                  <p className="muted">Change the password you use to sign in.</p>
                  <Field label="Current password" required>
                    <Input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
                  </Field>
                  <Field label="New password" required hint="At least 6 characters.">
                    <Input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
                  </Field>
                  <Field label="Repeat new password" required>
                    <Input type="password" autoComplete="new-password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} />
                  </Field>
                  <Button
                    type="button"
                    variant="primary"
                    onClick={async () => {
                      if (pw.next !== pw.again) return notify("The two new passwords do not match.")
                      try {
                        await api("auth:changePassword", { current: pw.current, next: pw.next })
                        setPw({ current: "", next: "", again: "" })
                        notify("Password changed.")
                      } catch (e) {
                        notify((e as Error).message)
                      }
                    }}
                  >
                    Change password
                  </Button>
                </>
              )}
            </div>
            </fieldset>
            {!IMMEDIATE.includes(section) && section !== "Security" && (
              <div className="modal-footer">
                <Button type="reset">Reset changes</Button>
                <Button type="submit" variant="primary" disabled={!canManage}>
                  <Save size={16} />
                  Save settings
                </Button>
              </div>
            )}
          </form>
        </Panel>
      </div>
    </>
  )
}

function AccountsEditor({ accounts, run, notify }: { accounts: Masters["accounts"]; run: <T>(fn: () => Promise<T>) => Promise<T | undefined>; notify: (m: string) => void }) {
  const [name, setName] = useState("")
  const [type, setType] = useState<"cash" | "bank">("bank")
  const [opening, setOpening] = useState("")
  return (
    <>
      <div className="list-editor-add">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Account name, e.g. Meezan Bank" />
        <Select value={type} onChange={(e) => setType(e.target.value as "cash" | "bank")}>
          <option value="bank">Bank</option>
          <option value="cash">Cash</option>
        </Select>
        <Input type="number" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="Opening balance" />
        <Button
          type="button"
          onClick={() =>
            name.trim() &&
            run(() => api("account:add", { name: name.trim(), type, opening: opening ? Number(opening) : undefined })).then((r) => {
              if (r !== undefined) {
                setName("")
                setOpening("")
                notify("Account added.")
              }
            })
          }
        >
          <Plus size={15} />
          Add
        </Button>
      </div>
      {accounts.map((a) => (
        <div className="setting-toggle" key={a.id}>
          <div>
            <strong>
              {a.name} {!a.active && <Badge>Inactive</Badge>}
            </strong>
            <span>
              {a.type === "bank" ? "Bank" : "Cash"} · balance {money(a.balance)}
            </span>
          </div>
          <Button type="button" variant="ghost" onClick={() => run(() => api("account:setActive", { id: a.id, active: !a.active })).then((r) => r !== undefined && notify(a.active ? "Account deactivated." : "Account activated."))}>
            {a.active ? "Deactivate" : "Activate"}
          </Button>
        </div>
      ))}
    </>
  )
}

function StaffEditor({ staff, run, notify }: { staff: Masters["staff"]; run: <T>(fn: () => Promise<T>) => Promise<T | undefined>; notify: (m: string) => void }) {
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [role, setRole] = useState<"salesman" | "recovery" | "both">("salesman")
  const ROLE: Record<string, string> = { salesman: "Salesman", recovery: "Recovery person", both: "Salesman and recovery" }
  return (
    <>
      <div className="info-notice">
        <Users size={17} />
        The people who carry bills and collect money. Their name and phone are printed on the bill. Choose a usual salesman and recovery person on each party, and the sale screen fills them in.
      </div>
      <div className="form-grid">
        <Field label="Name">
          <Input aria-label="Staff name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Imran Arain" />
        </Field>
        <Field label="Phone">
          <Input aria-label="Staff phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} placeholder="0300-1234567" />
        </Field>
      </div>
      <div className="list-editor-add">
        <Select aria-label="Staff role" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
          {Object.entries(ROLE).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Button
          type="button"
          onClick={() =>
            name.trim() &&
            run(() => api("staff:save", { name: name.trim(), phone: phone.trim() || undefined, role })).then((r) => {
              if (r !== undefined) {
                setName("")
                setPhone("")
                notify("Added.")
              }
            })
          }
        >
          <Plus size={15} />
          Add
        </Button>
      </div>
      {staff.length === 0 && <p className="muted">No one added yet.</p>}
      {staff.map((x) => (
        <div className="setting-toggle" key={x.id}>
          <div>
            <strong>
              {x.name} {!x.active && <Badge>Off</Badge>}
            </strong>
            <span>
              {ROLE[x.role]}
              {x.phone ? ` · ${x.phone}` : ""}
            </span>
          </div>
          <Button type="button" variant="ghost" onClick={() => run(() => api("staff:save", { id: x.id, name: x.name, phone: x.phone, role: x.role, active: !x.active })).then((r) => r !== undefined && notify(x.active ? "Switched off." : "Switched on."))}>
            {x.active ? "Switch off" : "Switch on"}
          </Button>
        </div>
      ))}
    </>
  )
}

const SEQUENCE_LABEL: Record<string, string> = { sale: "Sales invoice", purchase: "Purchase invoice", receipt: "Payment receipt", payment: "Supplier payment", sale_return: "Sale return", purchase_return: "Purchase return", expense: "Expense", transfer: "Transfer" }
function SequenceEditor({ sequences, run, notify }: { sequences: Masters["sequences"]; run: <T>(fn: () => Promise<T>) => Promise<T | undefined>; notify: (m: string) => void }) {
  const [draft, setDraft] = useState<Record<string, string>>({})
  return (
    <>
      <div className="info-notice">
        <FileText size={17} />
        The prefix appears at the start of each number. Numbers continue without gaps and are never reused.
      </div>
      {sequences.map((s) => (
        <div className="setting-toggle" key={s.kind}>
          <div>
            <strong>{SEQUENCE_LABEL[s.kind] ?? s.kind}</strong>
            <span>Next number: {s.prefix}{String(s.next).padStart(5, "0")}</span>
          </div>
          <div className="input-prefix">
            <Input aria-label={`Prefix for ${SEQUENCE_LABEL[s.kind] ?? s.kind}`} maxLength={10} value={draft[s.kind] ?? s.prefix} onChange={(e) => setDraft({ ...draft, [s.kind]: e.target.value })} />
            <Button type="button" disabled={(draft[s.kind] ?? s.prefix) === s.prefix} onClick={() => run(() => api("sequence:set", { kind: s.kind, prefix: draft[s.kind]! })).then((r) => r !== undefined && notify("Prefix saved."))}>
              Save
            </Button>
          </div>
        </div>
      ))}
    </>
  )
}

export function Backup({
  notify,
  canRestore,
  secondaryDir,
  onChanged,
}: {
  notify: (message: string) => void
  canRestore: boolean
  secondaryDir: string
  onChanged: () => void
}) {
  const [list, setList] = useState<BackupInfo[]>([])
  const [health, setHealth] = useState<{ integrityOk: boolean; lastBackupAt: string | null; problems: string[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [check, setCheck] = useState<{ current: BackupSummary; backups: BackupSummary[] } | null>(null)
  const [checking, setChecking] = useState(false)
  const load = async () => {
    try {
      setList(await api("backup:list"))
      setHealth(await api("health:get"))
      setStatus(await api("backup:status"))
    } catch (e) {
      notify((e as Error).message)
    }
  }
  useEffect(() => {
    void load()
  }, [])
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Not created yet")
  const size = (b: number) => (b > 1_000_000 ? `${(b / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1000))} KB`)
  return (
    <>
      <PageHeading title="Backup & restore" description="Keep a safe copy of your business records." />
      <div className="backup-banner">
        <span className="backup-shield">
          <ShieldCheck size={28} />
        </span>
        <div>
          <Heading level={2}>Your business data, safely in your hands</Heading>
          <p>A backup is made automatically every day and every time you close the program. Keep a second copy on a USB drive.</p>
        </div>
        <Badge tone={health?.integrityOk === false ? "red" : "green"}>{health?.integrityOk === false ? "Data check failed" : "Data check passed"}</Badge>
      </div>
      <div className="summary-grid three">
        <Summary label="Last backup" value={when(health?.lastBackupAt ?? null)} />
        <Summary label="Backups kept" value={`${list.length}`} />
        <Summary label="Last outside copy" value={status?.targets.length ? when(status.lastExternalOkAt) : "Not set up"} />
      </div>
      <div className="backup-grid">
        <Panel title="Extra copies" subtitle="USB drive, second disk or Google Drive folder">
          <div className="backup-content">
            {([1, 2] as const).map((slot) => {
              const t = status?.targets.find((x) => x.slot === slot)
              return (
                <div className="backup-location" key={slot} data-slot={slot}>
                  <FolderOpen size={19} />
                  <div>
                    <strong>
                      Copy {slot}: {t?.dir || "Not chosen"}
                    </strong>
                    {t ? (
                      <span>
                        {t.available ? "Connected" : "Not connected right now"} · last copy {when(t.lastOkAt)} · {t.files} file{t.files === 1 ? "" : "s"}
                        {t.error ? ` · ${t.error}` : ""}
                      </span>
                    ) : (
                      <span>{slot === 1 ? "Choose a USB drive or another disk" : "Optional: a Google Drive folder or a second drive"}</span>
                    )}
                    <div className="row-actions">
                      <Button
                        onClick={async () => {
                          try {
                            const r = await api("backup:chooseFolder", { slot })
                            if (r.error) notify(r.error)
                            else if (r.folder) notify(`Copy ${slot} folder saved.`)
                            await load()
                            onChanged()
                          } catch (e) {
                            notify((e as Error).message)
                          }
                        }}
                      >
                        {t ? "Change" : "Choose folder"}
                      </Button>
                      {t && (
                        <>
                          <Button
                            onClick={async () => {
                              try {
                                const r = await api("backup:testFolder", { slot })
                                notify(r.ok ? `Copy ${slot}: ${r.message}` : `Copy ${slot}: ${r.message}`)
                              } catch (e) {
                                notify((e as Error).message)
                              }
                            }}
                          >
                            Test
                          </Button>
                          <Button
                            onClick={async () => {
                              try {
                                await api("backup:clearFolder", { slot })
                                await load()
                                onChanged()
                              } catch (e) {
                                notify((e as Error).message)
                              }
                            }}
                          >
                            Remove
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
            <p>Every backup is also copied to these folders and checked. Old copies are thinned automatically: the last 14 days, 8 weeks and 12 months are kept.</p>
            <div className="logo-actions">
              <Button
                variant="primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  try {
                    const r = await api("backup:run")
                    notify(`Backup created: ${r.name}`)
                    await load()
                  } catch (e) {
                    notify((e as Error).message)
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                <Download size={16} />
                Backup now
              </Button>
            </div>
          </div>
        </Panel>
        <Panel title="Restore a backup" subtitle="Go back to an earlier copy">
          <div className="backup-content">
            <div className="backup-big-icon">
              <RotateCcw size={31} />
            </div>
            <Heading level={3}>Restore your records</Heading>
            <p>Pick a backup from the list below. Your current records are saved as another backup first, and the program restarts.</p>
            <div className="info-notice">
              <ShieldCheck size={17} />
              Everything entered after the chosen backup will no longer be visible.
            </div>
          </div>
        </Panel>
      </div>
      <Panel title="Check that your backup really works" subtitle="Opens the newest backups and compares them with your records now">
        <div className="backup-content">
          <p>Do this once a month. It does not change anything: it only reads the backups and shows what is inside.</p>
          <Button
            disabled={checking}
            onClick={async () => {
              setChecking(true)
              try {
                setCheck(await api("backup:check"))
                await load()
              } catch (e) {
                notify((e as Error).message)
              } finally {
                setChecking(false)
              }
            }}
          >
            {checking ? "Checking…" : "Check my backups now"}
          </Button>
          {check && (
            <DataTable
              rows={[check.current, ...check.backups]}
              empty="No backups to check yet."
              columns={[
                { key: "where", label: "Copy", render: (r) => (<div className="cell-two"><strong>{r.name}</strong><span>{r.where}{r.name.startsWith("backup-") ? ` · ${when(r.createdAt)}` : ""}</span></div>) },
                { key: "ok", label: "Result", render: (r) => <Badge tone={r.ok ? "green" : "red"}>{r.ok ? "Opens correctly" : "Damaged"}</Badge> },
                { key: "sales", label: "Sales", right: true },
                { key: "purchases", label: "Purchases", right: true },
                { key: "customers", label: "Customers", right: true },
                { key: "products", label: "Products", right: true },
                { key: "receivable", label: "Customers owe", right: true, render: (r) => money(r.receivable) },
              ]}
            />
          )}
          {check && <p>A backup made earlier today may show slightly fewer sales than "Your records now". That is normal. Damaged backups are shown in red.</p>}
        </div>
      </Panel>
      <Panel title="Available backups">
        <DataTable
          rows={list}
          empty="No backups yet. One is created automatically when you close the program."
          columns={[
            { key: "name", label: "Backup", render: (b) => <span className="reference">{b.name}</span> },
            { key: "modified", label: "Created", render: (b) => when(b.modified) },
            { key: "size", label: "Size", right: true, render: (b) => size(b.size) },
            {
              key: "action",
              label: "",
              render: (b) =>
                restoring === b.name ? (
                  <div className="row-actions">
                    <Button
                      variant="primary"
                      onClick={async () => {
                        try {
                          await api("backup:restore", { name: b.name })
                        } catch (e) {
                          notify((e as Error).message)
                          setRestoring(null)
                        }
                      }}
                    >
                      Yes, restore and restart
                    </Button>
                    <Button onClick={() => setRestoring(null)}>Cancel</Button>
                  </div>
                ) : (
                  <Button disabled={!canRestore} onClick={() => setRestoring(b.name)}>
                    <Upload size={14} />
                    Restore
                  </Button>
                ),
            },
          ]}
        />
      </Panel>
      <Panel title="Backup recommendations">
        <div className="backup-recommendations">
          {["Choose a USB drive as the second-copy folder and keep it away from the computer.", "Use a UPS so a power cut never interrupts work.", "Check the backup date before restoring."].map((t) => (
            <div key={t}>
              <CheckCircle2 size={17} />
              <span>{t}</span>
            </div>
          ))}
        </div>
      </Panel>
    </>
  )
}

export function Returns({
  returns,
  accounts,
  onReturn,
  onExchange,
}: {
  returns: ReturnRow[]
  accounts: string[]
  onReturn: (t: Transaction, quantities: Record<string, number>, type: string, opts: { settlement: "balance" | "cash"; account?: string; refund?: number; damaged?: boolean; reason?: string }) => Promise<boolean>
  onExchange: (t: Transaction, quantities: Record<string, number>, lines: { productId: string; qty: number; rate: number; discount: number }[], paid: number, account: string) => Promise<boolean>
}) {
  const [tab, setTab] = useState("Sales return")
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<Transaction | null>(null)
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState("")
  const [reason, setReason] = useState("Quality issue")
  const [settlement, setSettlement] = useState<"balance" | "cash">("balance")
  const [account, setAccount] = useState(accounts[0] ?? "")
  const [damaged, setDamaged] = useState(false)
  const [newLines, setNewLines] = useState<{ productId: string; qty: number }[]>([])
  const [paid, setPaid] = useState("")
  const [busy, setBusy] = useState(false)
  const exchange = tab === "Exchange"
  const purchase = tab === "Purchase return"
  // Invoices are found by the engine (number or party), 10 at a time: the shop may hold years of history.
  const dq = useDebounced(query)
  const [docPage, setDocPage] = useState(1)
  const { data: foundDocs, loading: finding } = useRemote("docs:list", { kind: purchase ? "purchase" : "sale", query: dq, status: "completed", page: docPage, pageSize: 10 })
  const transactions = foundDocs?.rows ?? []
  const knownProducts = useRef(new Map<string, Product>())
  const reasons = purchase ? ["Quality issue", "Wrong item sent", "Excess quantity", "Other"] : ["Quality issue", "Incorrect item", "Customer changed mind", "Other"]
  const returnTotal = selected?.lines?.reduce((sum, l) => sum + (quantities[l.productId] || 0) * (l.rate - l.discount / l.qty), 0) || 0
  const priced = newLines.map((l) => ({ ...l, product: knownProducts.current.get(l.productId) })).filter((l) => l.product)
  const newTotal = priced.reduce((s, l) => s + l.qty * l.product!.price, 0)
  const difference = newTotal - returnTotal
  const reset = () => {
    setSelected(null)
    setQuantities({})
    setConfirm(false)
    setError("")
    setNewLines([])
    setPaid("")
    setSettlement("balance")
    setDamaged(false)
  }
  async function proceed() {
    if (!selected || returnTotal <= 0) return setError("Select at least one item to return.")
    if (selected.lines?.some((l) => !Number.isInteger(quantities[l.productId] || 0) || (quantities[l.productId] || 0) > l.qty || (quantities[l.productId] || 0) < 0))
      return setError("Return quantities must be whole numbers within the original quantity.")
    if (exchange && !newLines.length) return setError("Choose the items the customer is taking instead.")
    if (!confirm) return setConfirm(true)
    setBusy(true)
    const qs = Object.fromEntries(Object.entries(quantities).filter(([, q]) => q > 0))
    const ok = exchange
      ? await onExchange(selected, qs, priced.map((l) => ({ productId: l.productId, qty: l.qty, rate: l.product!.price, discount: 0 })), Math.max(0, Number(paid || 0)), account)
      : await onReturn(selected, qs, tab, { settlement: purchase ? "balance" : settlement, account: settlement === "cash" || (purchase && Number(paid) > 0) ? account : undefined, refund: settlement === "cash" || purchase ? (Number(paid) > 0 ? Number(paid) : settlement === "cash" ? returnTotal : undefined) : undefined, damaged, reason })
    setBusy(false)
    if (ok) reset()
    else setConfirm(false)
  }
  return (
    <>
      <PageHeading title="Returns & exchange" description="Return against an original invoice, with a clear stock and balance adjustment." />
      <Tabs
        tabs={["Sales return", "Exchange", "Purchase return"]}
        active={tab}
        onChange={(t) => {
          setTab(t)
          reset()
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
      <Panel title="Find original transaction" subtitle="Search an invoice number, party or supplier">
        <div className="padded-search">
          <SearchBox value={query} onChange={(v) => { setQuery(v); setDocPage(1) }} placeholder="Search invoice or party…" />
        </div>
        <DataTable
          rows={transactions}
          server={{ total: foundDocs?.total ?? 0, page: docPage, pageSize: 10, onPage: setDocPage, loading: finding }}
          empty="No invoices found."
          onRow={(s) => {
            setSelected(s)
            setQuantities({})
            setConfirm(false)
            setError("")
          }}
          columns={[
            { key: "id", label: "Invoice", render: (s) => <span className="reference">{s.id}</span> },
            { key: "party", label: purchase ? "Supplier" : "Party" },
            { key: "date", label: "Date" },
            { key: "items", label: L.units, right: true },
            { key: "total", label: "Amount", right: true, render: (s) => money(s.total) },
            {
              key: "action",
              label: "",
              render: (s) => (
                <Button variant={selected?.id === s.id ? "primary" : "secondary"}>
                  {selected?.id === s.id ? <Check size={14} /> : <Plus size={14} />}
                  {selected?.id === s.id ? "Selected" : "Select"}
                </Button>
              ),
            },
          ]}
        />
      </Panel>
      {selected && (
        <Panel title={`Return items · ${selected.id}`} subtitle={selected.party}>
          <DataTable
            rows={selected.lines || []}
            empty="This invoice does not contain item-level records"
            columns={[
              { key: "name", label: "Product" },
              { key: "size", label: L.size, render: (l) => l.size || "—" },
              { key: "qty", label: "Original qty", right: true },
              { key: "rate", label: "Rate", right: true, render: (l) => money(l.rate) },
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
                      setQuantities({ ...quantities, [l.productId]: +e.target.value })
                      setConfirm(false)
                    }}
                  />
                ),
              },
            ]}
          />
          {exchange && (
            <div className="modal-body">
              <Field label="Items the customer takes instead">
                <ProductPicker
                  value=""
                  filter={(p) => p.stock > 0}
                  onPick={(p) => {
                    if (!p) return
                    knownProducts.current.set(p.id, p)
                    setNewLines((n) => (n.some((x) => x.productId === p.id) ? n : [...n, { productId: p.id, qty: 1 }]))
                    setConfirm(false)
                  }}
                />
              </Field>
              {priced.map((l) => (
                <div className="summary-row" key={l.productId}>
                  <span>{l.product!.name}</span>
                  <div className="input-prefix">
                    <Input type="number" min="1" step="1" max={l.product!.stock} value={l.qty} aria-label={`Quantity of ${l.product!.name}`} onChange={(e) => setNewLines(newLines.map((x) => (x.productId === l.productId ? { ...x, qty: +e.target.value } : x)))} />
                    <Button type="button" onClick={() => setNewLines(newLines.filter((x) => x.productId !== l.productId))}>
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="return-review">
            <div>
              <span>Return value</span>
              <strong>{money(returnTotal)}</strong>
            </div>
            {exchange ? (
              <div>
                <span>{difference >= 0 ? "Customer pays the difference" : "Credit left for the customer"}</span>
                <strong>{money(Math.abs(difference))}</strong>
              </div>
            ) : (
              <div>
                <span>Stock impact</span>
                <strong>
                  {purchase ? "−" : "+"}
                  {Object.values(quantities).reduce((s, q) => s + q, 0)} {L.units}
                </strong>
              </div>
            )}
            <div>
              <span>Balance adjustment</span>
              <strong>{purchase ? "Supplier debit" : "Customer credit"}</strong>
            </div>
          </div>
          <div className="modal-body">
            {!exchange && (
              <Field label="Reason for return">
                <Select value={reason} onChange={(e) => setReason(e.target.value)}>
                  {reasons.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </Select>
              </Field>
            )}
            {tab === "Sales return" && (
              <>
                <Field label="How is the customer compensated?">
                  <Select value={settlement} onChange={(e) => setSettlement(e.target.value as "balance" | "cash")}>
                    <option value="balance">Reduce what the party owes (no cash)</option>
                    <option value="cash">Pay cash back now</option>
                  </Select>
                </Field>
                {settlement === "cash" && (
                  <div className="form-grid">
                    <Field label="Refund amount (Rs.)" hint="Leave empty to refund the full return value.">
                      <Input type="number" min="0" value={paid} onChange={(e) => setPaid(e.target.value)} placeholder={String(Math.round(returnTotal))} />
                    </Field>
                    <Field label="Paid from account">
                      <Select value={account} onChange={(e) => setAccount(e.target.value)}>
                        {accounts.map((a) => (
                          <option key={a}>{a}</option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                )}
                <label className="check-row">
                  <Input type="checkbox" checked={damaged} onChange={(e) => setDamaged(e.target.checked)} />
                  <span>The returned goods are damaged (written off, not put back on the shelf)</span>
                </label>
              </>
            )}
            {purchase && (
              <div className="form-grid">
                <Field label="Cash received back from supplier (Rs.)" hint="Optional.">
                  <Input type="number" min="0" value={paid} onChange={(e) => setPaid(e.target.value)} placeholder="0" />
                </Field>
                <Field label="Paid into account">
                  <Select value={account} onChange={(e) => setAccount(e.target.value)}>
                    {accounts.map((a) => (
                      <option key={a}>{a}</option>
                    ))}
                  </Select>
                </Field>
              </div>
            )}
            {exchange && difference > 0 && (
              <div className="form-grid">
                <Field label="Paid now (Rs.)" hint="The rest stays on the party's account.">
                  <Input type="number" min="0" max={difference} value={paid} onChange={(e) => setPaid(e.target.value)} placeholder="0" />
                </Field>
                <Field label="Into account">
                  <Select value={account} onChange={(e) => setAccount(e.target.value)}>
                    {accounts.map((a) => (
                      <option key={a}>{a}</option>
                    ))}
                  </Select>
                </Field>
              </div>
            )}
            {confirm && (
              <div className="confirm-notice">
                <strong>Confirm this {tab.toLowerCase()}?</strong>
                <p>
                  Stock and the account will be adjusted by {money(returnTotal)}. The original invoice stays as it is; the return is recorded as a separate entry.
                </p>
              </div>
            )}
            {error && <div className="form-error">{error}</div>}
          </div>
          <div className="modal-footer">
            <Button onClick={reset}>Cancel</Button>
            <Button variant="primary" disabled={busy} onClick={() => void proceed()}>
              <RotateCcw size={15} />
              {confirm ? "Confirm" : "Review"}
            </Button>
          </div>
        </Panel>
      )}
      <Panel title="Recent returns">
        <DataTable
          rows={returns.slice(0, 20)}
          empty="No returns recorded yet."
          columns={[
            { key: "id", label: "Return", render: (r) => <span className="reference">{r.id}</span> },
            { key: "type", label: "Type" },
            { key: "original", label: "Against" },
            { key: "party", label: "Party" },
            { key: "date", label: "Date" },
            { key: "total", label: "Value", right: true, render: (r) => money(r.total) },
          ]}
        />
      </Panel>
    </>
  )
}

const ACCENT_CHOICES: [Business["accent"], string, string][] = [
  ["navy", "Navy (default)", "#253b70"],
  ["green", "Green", "#1f6b52"],
  ["teal", "Teal", "#0f6b7a"],
  ["purple", "Purple", "#5b3a8c"],
  ["maroon", "Maroon", "#8a2f3c"],
]

const TEXT_CHOICES: [TextSize, string][] = [
  ["normal", "Normal"],
  ["large", "Large"],
  ["xlarge", "Extra large"],
]
