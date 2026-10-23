import { L, today } from "./data"
import type { DashboardData } from "@shared/models"
import { useConfig } from "./config"
import { useSession } from "./Auth"
import { useEffect, useState } from "react"
import { api } from "./backend"
import { backupWarnings, type BackupWarning } from "@shared/backupWarn"
import { Check } from "lucide-react"
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  CalendarDays,
  ChevronDown,
  CirclePlus,
  ClipboardList,
  CreditCard,
  Download,
  Package,
  Plus,
  Receipt,
  ShoppingBag,
  ShoppingCart,
  TrendingUp,
  Wallet,
} from "lucide-react"
import {
  Heading,
  Action,
  Select,
  Badge,
  Button,
  DataTable,
  Panel,
  Tabs,
  exportCSV,
} from "./ui"
import {
  money,
  type Collection,
  type Expense,
  type Party,
  type Product,
  type Transaction,
} from "./data"

type Props = {
  collections: Collection[]
  expenses: Expense[]
  parties: Party[]
  dashboard: DashboardData
  userName: string
  navigate: (page: string) => void
  open: (type: string, data?: unknown) => void
}
const SETUP_HIDDEN = "erp.setupHidden"
const readHidden = () => {
  try {
    return localStorage.getItem(SETUP_HIDDEN) === "1"
  } catch {
    return false
  }
}

/** First-day guide: shows what is done and what to do next. It disappears by itself once everything is done. */
function GettingStarted({ setup, navigate, open }: { setup: DashboardData["setup"]; navigate: Props["navigate"]; open: Props["open"] }) {
  const [hidden, setHidden] = useState(readHidden)
  const steps = [
    { key: "shopDetails", title: "Enter your shop details", hint: "Address and phone appear on every invoice.", cta: "Open settings", go: () => navigate("Settings") },
    { key: "money", title: "Set up cash and bank", hint: "Add your bank account and the money you have today.", cta: "Open Cash & Bank", go: () => navigate("Cash & Bank") },
    { key: "parties", title: "Add your customers", hint: "Enter each party with the balance they owe you, if any.", cta: "Add a party", go: () => open("party") },
    { key: "products", title: "Add your products", hint: "Include the stock you already have as opening stock.", cta: "Add a product", go: () => open("product") },
    { key: "firstSale", title: "Make your first sale", hint: "Pick a customer, add items and save.", cta: "New sale", go: () => navigate("POS / Sales") },
  ] as const
  const done = steps.filter((s) => setup[s.key]).length
  if (hidden || done === steps.length) return null
  const next = steps.find((s) => !setup[s.key])
  return (
    <section className="getting-started" aria-label="Getting started">
      <div className="gs-head">
        <div>
          <strong>Getting started</strong>
          <span>
            {done} of {steps.length} steps done
          </span>
        </div>
        <button
          type="button"
          className="gs-hide"
          onClick={() => {
            setHidden(true)
            try {
              localStorage.setItem(SETUP_HIDDEN, "1")
            } catch {
              /* hiding just lasts until the next start */
            }
          }}
        >
          Hide
        </button>
      </div>
      <div className="gs-bar" aria-hidden>
        <span style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ol className="gs-steps">
        {steps.map((s) => {
          const ok = setup[s.key]
          return (
            <li key={s.key} className={`${ok ? "done" : ""} ${s === next ? "next" : ""}`}>
              <span className="gs-mark">{ok ? <Check size={13} /> : null}</span>
              <div>
                <b>{s.title}</b>
                {!ok && <small>{s.hint}</small>}
              </div>
              {!ok && s === next && (
                <Button variant="primary" onClick={s.go}>
                  {s.cta}
                  <ArrowRight size={14} />
                </Button>
              )}
              {!ok && s !== next && (
                <button type="button" className="gs-link" onClick={s.go}>
                  {s.cta}
                </button>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/** 0, 250, 500 ... for small shops; 1.5k, 25k ... for larger turnover. */
function axisLabel(v: number, max: number): string {
  if (v < 1000) return String(Math.round(v))
  return `${+(v / 1000).toFixed(max < 10000 ? 1 : 0)}k`
}

export default function Dashboard({
  collections,
  expenses,
  parties,
  dashboard,
  userName,
  navigate,
  open,
}: Props) {
  const { isEnabled } = useConfig()
  const session = useSession()
  const [period, setPeriod] = useState("This week")
  const [activity, setActivity] = useState("Recent sales")
  const [hover, setHover] = useState<number | null>(null)
  const [warnings, setWarnings] = useState<BackupWarning[]>([])
  useEffect(() => {
    if (!session.can("settings.manage")) return
    let alive = true
    void api("backup:status")
      .then((st) => alive && setWarnings(backupWarnings(st)))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [session])
  const d = dashboard
  const series = period === "This week" ? d.week : d.month
  const prev = period === "This week" ? d.weekPrev : d.monthPrev
  const values = series.map((x) => x.value)
  const labels = series.map((x) => x.label)
  const periodTotal = values.reduce((s, v) => s + v, 0)
  const change = prev > 0 ? Math.round(((periodTotal - prev) / prev) * 1000) / 10 : null
  // a "nice" top for the chart axis, in thousands
  const peak = Math.max(1000, ...values)
  const step = Math.pow(10, Math.floor(Math.log10(peak)))
  const max = Math.ceil(peak / step) * step
  const points = values.map((v, i) => ({
    x: 52 + i * 90,
    y: 180 - (v / max) * 145,
  }))
  const path = points
    .map((p, i) =>
      i === 0
        ? `M ${p.x} ${p.y}`
        : `C ${p.x - 48} ${points[i - 1].y}, ${p.x - 38} ${p.y}, ${p.x} ${p.y}`,
    )
    .join(" ")
  const kpis = [
    { title: "Today's sales", amount: d.todaySales, icon: ShoppingCart, delta: "", detail: `${d.todaySalesCount} invoice${d.todaySalesCount === 1 ? "" : "s"} today`, tone: "indigo" },
    ...(isEnabled("recovery")
      ? [{ title: "Today's recovery", amount: d.todayRecovery, icon: Wallet, delta: "", detail: `${d.todayRecoveryCount} payment${d.todayRecoveryCount === 1 ? "" : "s"} received`, tone: "green" }]
      : []),
    { title: "Today's purchases", amount: d.todayPurchases, icon: ShoppingBag, delta: "", detail: `${d.todayPurchaseCount} purchase invoice${d.todayPurchaseCount === 1 ? "" : "s"}`, tone: "blue" },
    // profit is for people allowed to see reports; a counter salesman does not need it
    ...(session.can("report.view") ? [{ title: "Gross profit", amount: d.grossProfit, icon: TrendingUp, delta: d.margin === null ? "" : `${d.margin}% margin`, detail: "Before operating expenses", tone: "green" }] : []),
  ]
  const low = d.lowStock
  const rows =
    activity === "Recent sales"
      ? d.recentSales
      : activity === "Recent purchases"
        ? d.recentPurchases
        : collections.map((c) => ({
            id: c.id,
            party: c.party,
            date: c.date,
            items: 0,
            total: c.amount,
            paid: c.amount,
            method: c.method,
          }))
  return (
    <>
      {warnings.map((w) => (
        <div className="confirm-notice backup-warning" role="alert" key={w.text}>
          <strong>{w.level === "warn" ? "Backup warning" : "Backup reminder"}</strong>
          <p>{w.text}</p>
          <Button onClick={() => navigate("Backup & Restore")}>Open Backup & restore</Button>
        </div>
      ))}
      <div className="page-heading dashboard-heading">
        <div>
          <div className="eyebrow">YOUR BUSINESS AT A GLANCE</div>
          <Heading level={1}>Business overview</Heading>
          <p>Welcome back, {userName}. Here’s how your business is doing today.</p>
        </div>
        <div className="heading-actions">
          <Button onClick={() => open("date")}>
            <CalendarDays size={15} />
            {new Date(`${today}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            <ChevronDown size={14} />
          </Button>
          <Button variant="primary" onClick={() => navigate("POS / Sales")}>
            <Plus size={17} />
            New sale<span className="shortcut">F2</span>
          </Button>
        </div>
      </div>
      <GettingStarted setup={d.setup} navigate={navigate} open={open} />
      <div className="kpi-grid">
        {kpis.map((k) => (
          <div className={`kpi-card kpi-${k.tone}`} key={k.title}>
            <div className="kpi-top">
              <span>{k.title}</span>
              <span className={`kpi-icon ${k.tone}`}>
                <k.icon size={18} />
              </span>
            </div>
            <div className="kpi-value">{money(k.amount)}</div>
            <div className="kpi-bottom">
              {k.delta && (
                <span className="positive">
                  <ArrowUpRight size={13} />
                  {k.delta}
                </span>
              )}
              <span>{k.detail}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="balance-strip">
        {[
          {
            label: "Total receivables",
            amount: d.receivables,
            icon: ArrowDownLeft,
            tone: "red",
            page: "Customers",
          },
          {
            label: "Total payables",
            amount: d.payables,
            icon: ArrowUpRight,
            tone: "amber",
            page: "Suppliers",
          },
          {
            label: "Stock value",
            amount: d.stockValue,
            icon: Package,
            tone: "indigo",
            page: "Inventory",
          },
          {
            label: "Today's expenses",
            amount: d.todayExpenses,
            icon: Receipt,
            tone: "neutral",
            page: "Expenses",
          },
        ].map((item) => (
          <Action
            key={item.label}
            className="balance-item"
            onClick={() => navigate(item.page)}
          >
            <span className={`balance-icon ${item.tone}`}>
              <item.icon size={18} />
            </span>
            <div>
              <span>{item.label}</span>
              <strong>{money(item.amount)}</strong>
            </div>
            <ArrowRight size={15} className="balance-arrow" />
          </Action>
        ))}
      </div>
      <div className="quick-actions">
        <span className="quick-label">Quick actions</span>
        <Action onClick={() => open("recovery")}>
          <CirclePlus size={15} />
          Receive payment
        </Action>
        <Action onClick={() => navigate("New Purchase")}>
          <ShoppingBag size={15} />
          New purchase
        </Action>
        <Action onClick={() => open("expense")}>
          <Receipt size={15} />
          Add expense
        </Action>
        <Action onClick={() => open("adjust")}>
          <Package size={15} />
          Adjust stock
        </Action>
        <Action onClick={() => navigate("Reports")}>
          <ClipboardList size={15} />
          View reports
          <ArrowRight size={13} />
        </Action>
      </div>
      <div className="dashboard-charts">
        <Panel
          title="Sales overview"
          subtitle="Your sales performance over time"
          action={
            <Select
              aria-label="Sales period"
              className="compact-select"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            >
              <option>This week</option>
              <option>This month</option>
            </Select>
          }
          className="sales-chart-panel"
        >
          <div className="chart-summary">
            <strong>{money(periodTotal)}</strong>
            {change !== null && (
              <span className="trend">
                <ArrowUpRight size={14} style={change < 0 ? { transform: "rotate(90deg)" } : undefined} />
                {Math.abs(change)}%
              </span>
            )}
            <span className="muted">
              {change === null ? "No sales in the previous " : "vs. previous "}
              {period === "This week" ? "week" : "4 weeks"}
            </span>
            <span className="chart-legend">
              <i />
              Sales
            </span>
          </div>
          <div className="chart">
            <svg
              viewBox="0 0 650 215"
              role="img"
              aria-label="Sales trend increasing over the last seven days"
            >
              <defs>
                <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary)" stopOpacity=".13" />
                  <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
                </linearGradient>
              </defs>
              {[0, 1, 2, 3, 4].map((i) => (
                <g key={i}>
                  <line
                    x1="52"
                    x2="610"
                    y1={35 + i * 36.25}
                    y2={35 + i * 36.25}
                    stroke="#edf0f4"
                    strokeDasharray="4 4"
                  />
                  <text x="0" y={39 + i * 36.25} fontSize="10" fill="#8290a4">
                    {axisLabel(max * (1 - i / 4), max)}
                  </text>
                </g>
              ))}
              <path d={`${path} L 592 180 L 52 180 Z`} fill="url(#chartFill)" />
              <path
                d={path}
                fill="none"
                stroke="var(--primary)"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              {points.map((p, i) => (
                <g
                  key={i}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                >
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={hover === i ? 5 : 3.5}
                    fill="white"
                    stroke="var(--primary)"
                    strokeWidth="2"
                  />
                  <circle cx={p.x} cy={p.y} r="15" fill="transparent" />
                  <text
                    x={p.x}
                    y="205"
                    textAnchor="middle"
                    fontSize="10"
                    fill="#8290a4"
                  >
                    {labels[i]}
                  </text>
                  {hover === i && (
                    <g>
                      <rect
                        x={p.x - 44}
                        y={Math.max(0, p.y - 32)}
                        width="88"
                        height="23"
                        rx="4"
                        fill="#23345c"
                      />
                      <text
                        x={p.x}
                        y={Math.max(0, p.y - 32) + 15}
                        textAnchor="middle"
                        fontSize="10"
                        fill="white"
                      >
                        {money(values[i])}
                      </text>
                    </g>
                  )}
                </g>
              ))}
            </svg>
          </div>
          <div className="chart-footer">
            <span>
              <span className="tiny-dot green-dot" />
              Sales are up compared to last week
            </span>
            <Action onClick={() => navigate("Sales Report")}>
              Sales report
              <ArrowRight size={14} />
            </Action>
          </div>
        </Panel>
        <Panel
          title="Payment summary"
          subtitle="Today’s cash flow"
          action={<span className="small-tag">Today</span>}
          className="payment-panel"
        >
          <div className="payment-total">
            <span>Total received</span>
            <strong>
              {money(d.receivedCash + d.receivedBank)}
            </strong>
          </div>
          <div className="payment-progress">
            <span style={{ width: `${d.receivedCash + d.receivedBank > 0 ? (d.receivedCash / (d.receivedCash + d.receivedBank)) * 100 : 0}%` }} />
            <span style={{ width: `${d.receivedCash + d.receivedBank > 0 ? (d.receivedBank / (d.receivedCash + d.receivedBank)) * 100 : 0}%` }} />
          </div>
          <div className="payment-legend">
            <span>
              <i className="indigo-dot" />
              Cash <strong>{d.receivedCash + d.receivedBank > 0 ? Math.round((d.receivedCash / (d.receivedCash + d.receivedBank)) * 100) : 0}%</strong>
            </span>
            <span>
              <i className="teal-dot" />
              Bank <strong>{d.receivedCash + d.receivedBank > 0 ? Math.round((d.receivedBank / (d.receivedCash + d.receivedBank)) * 100) : 0}%</strong>
            </span>
          </div>
          <div className="payment-rows">
            <div>
              <span>
                <span className="payment-row-icon green">
                  <ArrowDownLeft size={15} />
                </span>
                Sales received
              </span>
              <strong>{money(d.salesReceived)}</strong>
            </div>
            {isEnabled("recovery") && (
              <div>
                <span>
                  <span className="payment-row-icon green">
                    <Wallet size={15} />
                  </span>
                  Recovery collected
                </span>
                <strong className="green-text">{money(d.todayRecovery)}</strong>
              </div>
            )}
            <div>
              <span>
                <span className="payment-row-icon neutral">
                  <ArrowUpRight size={15} />
                </span>
                Expenses paid
              </span>
              <strong>{money(d.todayExpenses)}</strong>
            </div>
          </div>
          <Action
            className="payment-link"
            onClick={() => navigate("Cash & Bank")}
          >
            View cash & bank
            <ArrowRight size={14} />
          </Action>
        </Panel>
      </div>
      <div className="dashboard-tables">
        <Panel
          title="Outstanding receivables"
          subtitle="Parties that need your attention"
          action={
            <Action
              className="text-button"
              onClick={() => navigate("Customers")}
            >
              View all
              <ArrowRight size={14} />
            </Action>
          }
        >
          <DataTable
            rows={parties.filter((p) => p.balance > 0).slice(0, 4)}
            onRow={(p) => open("party", p)}
            columns={[
              {
                key: "name",
                label: "Party",
                render: (p) => (
                  <div className="cell-two">
                    <strong>{p.name}</strong>
                    <span>{p.city}</span>
                  </div>
                ),
              },
              {
                key: "balance",
                label: "Outstanding",
                right: true,
                render: (p) => <strong>{money(p.balance)}</strong>,
              },
              {
                key: "status",
                label: "Status",
                render: (p) => <Badge>{p.status}</Badge>,
              },
              {
                key: "action",
                label: "",
                render: (p) => (
                  <Action
                    className="row-action"
                    aria-label={`Receive payment from ${p.name}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      open("recovery", p)
                    }}
                  >
                    <ArrowRight size={15} />
                  </Action>
                ),
              },
            ]}
          />
          <div className="panel-note">
            <span className="tiny-dot amber-dot" />
            {parties.filter((p) => p.balance > 0).length} part{parties.filter((p) => p.balance > 0).length === 1 ? "y" : "ies"} with an outstanding balance
          </div>
        </Panel>
        <Panel
          title="Low stock alerts"
          subtitle="Keep your best-selling fabrics available"
          action={
            <Action
              className="text-button"
              onClick={() => navigate("Inventory")}
            >
              View inventory
              <ArrowRight size={14} />
            </Action>
          }
        >
          <DataTable
            rows={low.slice(0, 4)}
            onRow={(p) => open("stock", p)}
            columns={[
              {
                key: "name",
                label: "Product / article",
                render: (p) => (
                  <div className="cell-two">
                    <strong>{p.name}</strong>
                    <span>
                      {p.company} · {p.article}
                    </span>
                  </div>
                ),
              },
              {
                key: "size",
                label: L.size,
                render: (p) => p.size || "—",
              },
              {
                key: "stock",
                label: "Available",
                right: true,
                render: (p) => (
                  <span className={p.stock === 0 ? "red-text" : "amber-text"}>
                    <strong>{p.stock}</strong>{" "}
                    <span className="muted">{L.units}</span>
                  </span>
                ),
              },
              {
                key: "status",
                label: "Status",
                render: (p) => (
                  <Badge>{p.stock === 0 ? "Out of stock" : "Low stock"}</Badge>
                ),
              },
            ]}
          />
          <div className="panel-note">
            <Package size={13} />
            {d.inventory.reorder.toLocaleString()} products are at or below their minimum stock level
          </div>
        </Panel>
      </div>
      {(isEnabled("expiry") || isEnabled("cityWise")) && (
        <div className="dashboard-tables">
          {isEnabled("expiry") && (
            <Panel title="Expiry alerts" subtitle="Items that are expired or about to expire">
              {d.expiring.length === 0 ? (
                <div className="panel-note">
                  <Package size={13} />
                  Nothing is close to its expiry date
                </div>
              ) : (
                <DataTable
                  rows={d.expiring}
                  columns={[
                    { key: "product", label: "Product" },
                    { key: "batch", label: "Batch" },
                    { key: "expiry", label: "Expiry" },
                    { key: "qty", label: "In stock", right: true },
                    {
                      key: "days",
                      label: "Status",
                      render: (x) => <Badge>{x.days < 0 ? `Expired ${-x.days} days ago` : x.days === 0 ? "Expires today" : `${x.days} days left`}</Badge>,
                    },
                  ]}
                />
              )}
            </Panel>
          )}
          {isEnabled("cityWise") && (
            <Panel title="City performance" subtitle="Last 30 days and what is still owed">
              {d.cities.length === 0 ? (
                <div className="panel-note">
                  <Package size={13} />
                  Add a city to your parties to see this
                </div>
              ) : (
                <DataTable
                  rows={d.cities}
                  columns={[
                    { key: "city", label: "City", render: (c) => <strong>{c.city}</strong> },
                    { key: "parties", label: "Parties", right: true },
                    { key: "sales", label: "Sales", right: true, render: (c) => money(c.sales) },
                    { key: "recovery", label: "Recovery", right: true, render: (c) => money(c.recovery) },
                    { key: "outstanding", label: "Outstanding", right: true, render: (c) => <strong>{money(c.outstanding)}</strong> },
                  ]}
                />
              )}
            </Panel>
          )}
        </div>
      )}
      <Panel
        className="recent-panel"
        title="Recent activity"
        action={
          <Button onClick={() => exportCSV("recent-activity", rows)}>
            <Download size={14} />
            Export
          </Button>
        }
      >
        <Tabs
          tabs={["Recent sales", "Recent recovery", "Recent purchases"]}
          active={activity}
          onChange={setActivity}
        />
        <DataTable
          rows={rows.slice(0, 5)}
          onRow={(r) => (activity === "Recent recovery" ? open("receipt", collections.find((c) => c.id === r.id)) : open("invoice", r))}
          columns={[
            {
              key: "id",
              label: "Reference",
              render: (r) => <span className="reference">{r.id}</span>,
            },
            { key: "party", label: "Party / supplier" },
            { key: "date", label: "Date", render: (r) => new Date(`${r.date}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) },
            { key: "items", label: L.units, right: true },
            {
              key: "total",
              label: "Total amount",
              right: true,
              render: (r) => <strong>{money(r.total)}</strong>,
            },
            {
              key: "paid",
              label: "Paid",
              right: true,
              render: (r) => money(r.paid),
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
              key: "actions",
              label: "",
              render: () => <ArrowRight size={15} className="muted" />,
            },
          ]}
        />
      </Panel>
      <div className="dashboard-footnote">
        <span>
          <span className="tiny-dot green-dot" />
          Saved on this computer
        </span>
        <span>Amounts in Pakistani Rupees (PKR)</span>
      </div>
    </>
  )
}
