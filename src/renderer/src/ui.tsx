import {
  createElement,
  type ComponentPropsWithRef,
  type HTMLAttributes,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Inbox,
  LoaderCircle,
  Search,
  X,
} from "lucide-react"

// Native semantics stay centralized in the local UI layer.
export function Action({
  type = "button",
  ...props
}: ComponentPropsWithRef<"button">) {
  return createElement("button", { type, ...props })
}
export function Input(props: ComponentPropsWithRef<"input">) {
  return createElement("input", props)
}
export function Select(props: ComponentPropsWithRef<"select">) {
  return createElement("select", props)
}
export function Textarea(props: ComponentPropsWithRef<"textarea">) {
  return createElement("textarea", props)
}
export function Heading({
  level = 2,
  ...props
}: HTMLAttributes<HTMLHeadingElement> & { level?: 1 | 2 | 3 | 4 | 5 | 6 }) {
  return createElement(`h${level}`, props)
}

export function Button({
  children,
  variant = "secondary",
  type = "button",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger"
  children: ReactNode
}) {
  return (
    <Action
      type={type}
      className={`btn btn-${variant} ${className}`}
      {...props}
    >
      {children}
    </Action>
  )
}
export function Badge({
  children,
  tone,
}: {
  children: ReactNode
  tone?: string
}) {
  const text = String(children)
  const inferred =
    /^(paid|clear|active|completed|received|in stock|success)$/i.test(text)
      ? "green"
      : /overdue|out of stock|void|loss|unpaid/i.test(text)
        ? "red"
        : /partial|low stock|pending|outstanding/i.test(text)
          ? "amber"
          : "neutral"
  return (
    <span className={`badge badge-${tone || inferred}`}>
      <span className="badge-dot" />
      {children}
    </span>
  )
}
export function SearchBox({
  value,
  onChange,
  placeholder = "Search…",
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <div className="searchbox">
      <Search size={16} />
      <Input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <Action aria-label="Clear search" onClick={() => onChange("")}>
          <X size={14} />
        </Action>
      )}
    </div>
  )
}
export function Field({
  label,
  children,
  hint,
  required,
}: {
  label: string
  children: ReactNode
  hint?: string
  required?: boolean
}) {
  return (
    <label className="field">
      <span>
        {label}
        {required && <span className="required"> *</span>}
      </span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  )
}
export function PageHeading({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children?: ReactNode
}) {
  return (
    <div className="page-heading">
      <div>
        <Heading level={1}>{title}</Heading>
        <p>{description}</p>
      </div>
      <div className="heading-actions">{children}</div>
    </div>
  )
}
export function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title?: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <div className="panel-heading">
          <div>
            <Heading level={2}>{title}</Heading>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}
export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: string[]
  active: string
  onChange: (tab: string) => void
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <Action
          key={tab}
          role="tab"
          aria-selected={active === tab}
          className={active === tab ? "active" : ""}
          onClick={() => onChange(tab)}
        >
          {tab}
        </Action>
      ))}
    </div>
  )
}
export type Column<T,> = {
  key: string
  label: string
  render?: (row: T) => ReactNode
  right?: boolean
}
export function DataTable<T extends object>({
  columns,
  rows,
  onRow,
  empty = "No records found",
  pagination = false,
  server,
  plainHeader = false,
}: {
  columns: Column<T>[]
  rows: T[]
  onRow?: (row: T) => void
  empty?: string
  pagination?: boolean
  /** Column titles as plain text (no sort buttons): used for printed documents, where buttons do not repeat on later pages. */
  plainHeader?: boolean
  /** The rows are one page held by the engine: paging, totals and loading come from here. */
  server?: { total: number; page: number; pageSize: number; onPage: (page: number) => void; loading?: boolean }
}) {
  const [sort, setSort] = useState<{
    key: string
    asc: boolean
  } | null>(null)
  const [localPage, setPage] = useState(1)
  useEffect(() => setPage(1), [rows.length])
  const page = server ? server.page : localPage
  const pageSize = server ? server.pageSize : 8
  const totalRows = server ? server.total : rows.length
  const sorted = [...rows].sort((a, b) => {
    if (!sort) return 0
    const av = (a as Record<string, unknown>)[sort.key],
      bv = (b as Record<string, unknown>)[sort.key]
    return (
      (typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv))) * (sort.asc ? 1 : -1)
    )
  })
  const pages = Math.max(1, Math.ceil(totalRows / pageSize))
  const goTo = (n: number) => (server ? server.onPage(n) : setPage(n))
  const visible = server ? sorted : pagination ? sorted.slice((page - 1) * 8, page * 8) : sorted
  return (
    <div className="table-wrapper">
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key} className={col.right ? "align-right" : ""}>
                  {plainHeader ? col.label : <Action
                    onClick={() =>
                      setSort({
                        key: col.key,
                        asc: sort?.key === col.key ? !sort.asc : true,
                      })
                    }
                  >
                    {col.label}
                    {sort?.key === col.key ? (
                      sort.asc ? (
                        <ArrowUp size={12} />
                      ) : (
                        <ArrowDown size={12} />
                      )
                    ) : (
                      <ArrowUpDown size={12} className="sort-icon" />
                    )}
                  </Action>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, index) => (
              <tr
                key={String((row as Record<string, unknown>).id || index)}
                onClick={() => onRow?.(row)}
                className={onRow ? "clickable-row" : ""}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={col.right ? "align-right numeric" : ""}
                  >
                    {col.render
                      ? col.render(row)
                      : String(
                          (row as Record<string, unknown>)[col.key] ?? "—",
                        )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && !server?.loading && (
        <div className="empty-state">
          <Inbox size={30} />
          <Heading level={3}>{empty}</Heading>
          <p>Try a different search or add your first record.</p>
        </div>
      )}
      {(pagination || server) && (
        <div className="pagination">
          <span>
            {server?.loading ? "Loading… " : ""}Showing {rows.length ? (page - 1) * pageSize + 1 : 0}–
            {Math.min((page - 1) * pageSize + rows.length, totalRows)} of {totalRows.toLocaleString()} records
          </span>
          <div>
            <Button
              className="icon-button"
              aria-label="Previous page"
              disabled={page === 1}
              onClick={() => goTo(page - 1)}
            >
              <ChevronLeft size={15} />
            </Button>
            <span className="page-number">{page}</span>
            <Button
              className="icon-button"
              aria-label="Next page"
              disabled={page >= pages}
              onClick={() => goTo(page + 1)}
            >
              <ChevronRight size={15} />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
export function Modal({
  title,
  description,
  onClose,
  children,
  wide = false,
}: {
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement
    ref.current?.focus()
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
      if (e.key === "Tab") {
        const elements = ref.current?.querySelectorAll<HTMLElement>(
          'button, input, select, textarea, [tabindex="0"]',
        )
        if (!elements?.length) return
        const first = elements[0],
          last = elements[elements.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener("keydown", handler)
    return () => {
      document.removeEventListener("keydown", handler)
      previous?.focus()
    }
  }, [onClose])
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${wide ? "modal-wide" : ""}`}
      >
        <div className="modal-heading">
          <div>
            <Heading level={2}>{title}</Heading>
            {description && <p>{description}</p>}
          </div>
          <Button
            variant="ghost"
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={20} />
          </Button>
        </div>
        {children}
      </div>
    </div>
  )
}
export function Loading({
  label = "Preparing your records…",
}: {
  label?: string
}) {
  return (
    <div className="empty-state">
      <LoaderCircle size={24} className="spin" />
      <p>{label}</p>
    </div>
  )
}
export function Toast({
  message,
  onClose,
}: {
  message: string
  onClose: () => void
}) {
  useEffect(() => {
    const timer = setTimeout(onClose, 4500)
    return () => clearTimeout(timer)
  }, [message, onClose])
  return (
    <div className="toast" role="status">
      <span className="toast-icon">
        <Check size={16} />
      </span>
      <span>{message}</span>
      <Action onClick={onClose} aria-label="Dismiss notification">
        <X size={16} />
      </Action>
    </div>
  )
}
export function exportCSV(name: string, rows: object[]) {
  const keys = Object.keys(rows[0] || {})
  const csv = [
    keys.join(","),
    ...rows.map((row) =>
      keys
        .map(
          (key) =>
            '"' +
            String((row as Record<string, unknown>)[key] ?? "").replace(
              /"/g,
              '""',
            ) +
            '"',
        )
        .join(","),
    ),
  ].join("\n")
  downloadFile(name + ".csv", csv, "text/csv")
}
export function downloadFile(
  name: string,
  content: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement("a")
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
type ExportButtonProps = {
  name: string
  rows: object[]
}
export function ExportButton({ name, rows }: ExportButtonProps) {
  return (
    <Button onClick={() => exportCSV(name, rows)}>
      <Download size={15} />
      Export
    </Button>
  )
}
