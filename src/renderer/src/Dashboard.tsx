import { useConfig } from "./config"
import { useState } from "react"
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
  sales: Transaction[]
  purchases: Transaction[]
  collections: Collection[]
  expenses: Expense[]
  parties: Party[]
  products: Product[]
  navigate: (page: string) => void
  open: (type: string, data?: unknown) => void
}
export default function Dashboard({
  sales,
  purchases,
  collections,
  expenses,
  parties,
  products,
  navigate,
  open,
}: Props) {
  const { isEnabled } = useConfig()
  const [period, setPeriod] = useState("This week")
  const [activity, setActivity] = useState("Recent sales")
  const [hover, setHover] = useState<number | null>(null)
  const totalSales = sales.reduce((sum, row) => sum + row.total, 0)
  const recovered = collections.reduce((sum, row) => sum + row.amount, 0)
  const totalExpenses = expenses.reduce((sum, row) => sum + row.amount, 0)
  const stockValue = products.reduce((sum, p) => sum + p.stock * p.cost, 0)
  const values =
    period === "This week"
      ? [124000, 185000, 152000, 238000, 196000, 272000, totalSales]
      : [420000, 580000, 510000, 760000, 650000, 890000, 1040000]
  const labels =
    period === "This week"
      ? [
          "Thu, 12",
          "Fri, 13",
          "Sat, 14",
          "Sun, 15",
          "Mon, 16",
          "Tue, 17",
          "Wed, 18",
        ]
      : ["1 Jun", "4 Jun", "7 Jun", "10 Jun", "13 Jun", "16 Jun", "18 Jun"]
  const max = period === "This week" ? 400000 : 1200000
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
    {
      title: "Today's sales",
      amount: totalSales,
      icon: ShoppingCart,
      delta: "+12.8%",
      detail: `${sales.length} invoices today`,
      tone: "indigo",
    },
    {
      title: "Today's recovery",
      amount: recovered,
      icon: Wallet,
      delta: "+8.2%",
      detail: `${collections.length} payments received`,
      tone: "green",
    },
    {
      title: "Today's purchases",
      amount: purchases
        .filter((p) => p.date === "2025-06-18")
        .reduce((s, p) => s + p.total, 0),
      icon: ShoppingBag,
      delta: "",
      detail: "2 purchase invoices",
      tone: "blue",
    },
    {
      title: "Gross profit",
      amount: Math.round(totalSales * 0.186),
      icon: TrendingUp,
      delta: "18.6% margin",
      detail: "Before operating expenses",
      tone: "green",
    },
  ]
  const low = products.filter((p) => p.stock < 10)
  const rows =
    activity === "Recent sales"
      ? sales
      : activity === "Recent purchases"
        ? purchases
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
      <div className="page-heading dashboard-heading">
        <div>
          <div className="eyebrow">YOUR BUSINESS AT A GLANCE</div>
          <Heading level={1}>Business overview</Heading>
          <p>Welcome back, Ahmed. Here’s how your business is doing today.</p>
        </div>
        <div className="heading-actions">
          <Button onClick={() => open("date")}>
            <CalendarDays size={15} />
            18 Jun, 2025
            <ChevronDown size={14} />
          </Button>
          <Button variant="primary" onClick={() => navigate("POS / Sales")}>
            <Plus size={17} />
            New sale<span className="shortcut">F2</span>
          </Button>
        </div>
      </div>
      <div className="kpi-grid">
        {kpis.map((k) => (
          <div className="kpi-card" key={k.title}>
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
            amount: parties.reduce((s, p) => s + p.balance, 0),
            icon: ArrowDownLeft,
            tone: "red",
            page: "Customers",
          },
          {
            label: "Total payables",
            amount: 570000,
            icon: ArrowUpRight,
            tone: "amber",
            page: "Suppliers",
          },
          {
            label: "Stock value",
            amount: stockValue,
            icon: Package,
            tone: "indigo",
            page: "Inventory",
          },
          {
            label: "Today's expenses",
            amount: totalExpenses,
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
            <strong>{money(values.reduce((s, v) => s + v, 0))}</strong>
            <span className="trend">
              <ArrowUpRight size={14} />
              12.8%
            </span>
            <span className="muted">
              vs. previous {period === "This week" ? "week" : "month"}
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
                  <stop offset="0%" stopColor="#5667ae" stopOpacity=".13" />
                  <stop offset="100%" stopColor="#5667ae" stopOpacity="0" />
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
                    {Math.round((max * (1 - i / 4)) / 1000)}k
                  </text>
                </g>
              ))}
              <path d={`${path} L 592 180 L 52 180 Z`} fill="url(#chartFill)" />
              <path
                d={path}
                fill="none"
                stroke="#495f9e"
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
                    stroke="#495f9e"
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
              {money(sales.reduce((s, p) => s + p.paid, 0) + recovered)}
            </strong>
          </div>
          <div className="payment-progress">
            <span style={{ width: "64%" }} />
            <span style={{ width: "36%" }} />
          </div>
          <div className="payment-legend">
            <span>
              <i className="indigo-dot" />
              Cash <strong>64%</strong>
            </span>
            <span>
              <i className="teal-dot" />
              Bank <strong>36%</strong>
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
              <strong>{money(sales.reduce((s, p) => s + p.paid, 0))}</strong>
            </div>
            {isEnabled("recovery") && (
              <div>
                <span>
                  <span className="payment-row-icon green">
                    <Wallet size={15} />
                  </span>
                  Recovery collected
                </span>
                <strong className="green-text">{money(recovered)}</strong>
              </div>
            )}
            <div>
              <span>
                <span className="payment-row-icon neutral">
                  <ArrowUpRight size={15} />
                </span>
                Expenses paid
              </span>
              <strong>{money(totalExpenses)}</strong>
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
            <span className="tiny-dot amber-dot" />2 parties have payments
            overdue by 30+ days
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
                label: "Than size",
                render: (p) => `${p.size} meters`,
              },
              {
                key: "stock",
                label: "Available",
                right: true,
                render: (p) => (
                  <span className={p.stock === 0 ? "red-text" : "amber-text"}>
                    <strong>{p.stock}</strong>{" "}
                    <span className="muted">Thans</span>
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
            {low.length} products are below their minimum stock level
          </div>
        </Panel>
      </div>
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
          onRow={(r) => open("invoice", r)}
          columns={[
            {
              key: "id",
              label: "Reference",
              render: (r) => <span className="reference">{r.id}</span>,
            },
            { key: "party", label: "Party / supplier" },
            { key: "date", label: "Date", render: () => "18 Jun 2025" },
            { key: "items", label: "Thans", right: true },
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
          All changes saved on this device
        </span>
        <span>Amounts in Pakistani Rupees (PKR)</span>
      </div>
    </>
  )
}
