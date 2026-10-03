import { useEffect, useState } from "react"
import { BrandMark, useBusiness } from "./business"
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  CreditCard,
  FileText,
  History,
  Package,
  Plus,
  Printer,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Wallet,
} from "lucide-react"
import {
  Heading,
  Input,
  Action,
  Select,
  Textarea,
  Badge,
  Button,
  DataTable,
  Field,
  Panel,
  SearchBox,
  Tabs,
} from "./ui"
import {
  money,
  today,
  type CartItem,
  type Collection,
  type Expense,
  type Party,
  type Product,
  type Transaction,
} from "./data"

export function SalesWorkspace({
  purchase = false,
  parties,
  products,
  onSave,
  onHistory,
}: {
  purchase?: boolean
  parties: Party[]
  products: Product[]
  onSave: (sale: Transaction, print: boolean) => boolean
  onHistory: () => void
}) {
  const [query, setQuery] = useState("")
  const [party, setParty] = useState("")
  const [cart, setCart] = useState<CartItem[]>([])
  const [method, setMethod] = useState("Cash")
  const [paid, setPaid] = useState("")
  const [account, setAccount] = useState("Cash in hand")
  const [discount, setDiscount] = useState("0")
  const [error, setError] = useState("")
  const [invoice, setInvoice] = useState("")
  const [invoiceDate, setInvoiceDate] = useState(today)
  const subtotal = cart.reduce((sum, i) => sum + i.qty * i.rate - i.discount, 0)
  const total = Math.max(0, subtotal - Number(discount))
  const received =
    method === "Cash" ? total : method === "Credit" ? 0 : Number(paid || 0)
  const selectedParty = parties.find((p) => p.id === party)
  function addProduct(p: Product) {
    if (!purchase && p.stock === 0) return
    const existing = cart.find((c) => c.productId === p.id)
    if (existing) update(p.id, "qty", existing.qty + 1)
    else
      setCart([
        ...cart,
        {
          productId: p.id,
          name: p.name,
          color: p.color,
          size: p.size,
          qty: 1,
          rate: purchase ? p.cost : p.rate,
          discount: 0,
        },
      ])
    setError("")
  }
  function update(id: string, key: string, value: number) {
    setCart(cart.map((c) => (c.productId === id ? { ...c, [key]: value } : c)))
  }
  function save(print: boolean) {
    if (!party)
      return setError(
        `Select a ${purchase ? "supplier" : "party"} before saving.`,
      )
    if (!cart.length)
      return setError("Add at least one product to the invoice.")
    if (
      cart.some(
        (c) =>
          c.qty <= 0 ||
          !Number.isInteger(c.qty) ||
          c.rate <= 0 ||
          c.discount < 0 ||
          c.discount > c.qty * c.rate,
      )
    )
      return setError(
        "Check quantities, rates and discounts. Than quantities must be whole numbers.",
      )
    if (
      !purchase &&
      cart.some(
        (c) => c.qty > (products.find((p) => p.id === c.productId)?.stock || 0),
      )
    )
      return setError(
        "The quantity exceeds available stock. Please adjust the quantity.",
      )
    if (Number(discount) < 0 || Number(discount) > subtotal)
      return setError("Invoice discount must be between zero and the subtotal.")
    if (Number(discount) > subtotal * 0.1)
      return setError("Discounts over 10% require owner authorization.")
    if (
      received > total ||
      received < 0 ||
      (method === "Partial" && (!received || received >= total))
    )
      return setError(
        "Enter a partial payment greater than zero and less than the total.",
      )
    if (
      !purchase &&
      selectedParty &&
      selectedParty.balance + total - received > selectedParty.limit
    )
      return setError(
        "This sale exceeds the party’s credit limit. Reduce credit or receive a payment.",
      )
    const saved = onSave(
      {
        id: `${purchase ? "PUR" : "INV"}-${Date.now().toString().slice(-6)}`,
        party: selectedParty!.name,
        date: purchase ? invoiceDate : today,
        items: cart.reduce((s, c) => s + c.qty, 0),
        total,
        paid: received,
        method,
        lines: cart,
        account,
        supplierInvoice: purchase ? invoice : undefined,
        invoiceDiscount: Number(discount),
      },
      print,
    )
    if (!saved)
      return setError(
        "Could not save. Check the payment account balance; your invoice has been kept.",
      )
    setInvoice("")
    setCart([])
    setPaid("")
    setDiscount("0")
    setError("")
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "F8" || e.key === "F9") {
        e.preventDefault()
        save(e.key === "F9")
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  })
  const found = products.filter((p) =>
    `${p.name} ${p.company} ${p.article} ${p.color} ${p.id} ${p.category}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  )
  return (
    <>
      <div className="page-heading">
        <div>
          <Heading level={1}>{purchase ? "New purchase" : "New sale"}</Heading>
          <p>
            {purchase
              ? "Receive stock and record a supplier invoice."
              : "A fast, simple workspace for your wholesale counter."}
          </p>
        </div>
        <Button onClick={onHistory}>
          <History size={15} />
          {purchase ? "Purchase" : "Sales"} history
        </Button>
      </div>
      <div className="pos-layout">
        <div className="pos-main">
          <Panel
            title={purchase ? "Purchase details" : "Select products"}
            subtitle={
              purchase
                ? "Record the supplier’s invoice for easy reconciliation"
                : "Search by product, company, article, variant, SKU or barcode"
            }
          >
            {purchase && (
              <div className="purchase-meta">
                <Field label="Supplier invoice number">
                  <Input
                    value={invoice}
                    onChange={(e) => setInvoice(e.target.value)}
                    placeholder="e.g. GA-2025-184"
                  />
                </Field>
                <Field label="Invoice date">
                  <Input
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                  />
                </Field>
              </div>
            )}
            <div
              className="product-search"
              onKeyDown={(e) => {
                if (
                  e.key !== "Enter" ||
                  e.target !== e.currentTarget.querySelector("input")
                )
                  return
                e.preventDefault()
                const product = found.find((p) => purchase || p.stock > 0)
                if (product) {
                  addProduct(product)
                  setQuery("")
                }
              }}
            >
              <SearchBox
                value={query}
                onChange={setQuery}
                placeholder="Search cloth, article or scan barcode…"
              />
              <span className="key-hint">Enter to select</span>
            </div>
            <div className="product-picker">
              {found.map((p) => (
                <Action
                  className="product-option"
                  key={p.id}
                  disabled={!purchase && p.stock === 0}
                  onClick={() => addProduct(p)}
                >
                  <span
                    className={`fabric-swatch swatch-${p.color.split(" ")[0].toLowerCase()}`}
                  />
                  <span className="product-option-info">
                    <strong>{p.name}</strong>
                    <span>
                      {p.company} · {p.article}
                    </span>
                    <small>
                      {p.color} · {p.size}m / Than
                    </small>
                  </span>
                  <span className="product-option-right">
                    <strong>{money(purchase ? p.cost : p.rate)}</strong>
                    <small className={p.stock < 10 ? "amber-text" : ""}>
                      {p.stock} Thans in stock
                    </small>
                    <Plus size={15} />
                  </span>
                </Action>
              ))}
            </div>
            {!found.length && (
              <div className="empty-state">
                <Search size={28} />
                <Heading level={3}>No matching products</Heading>
                <p>Try a product name or article number.</p>
              </div>
            )}
          </Panel>
          <Panel
            title={purchase ? "Purchase items" : "Sale items"}
            action={
              <span className="small-tag">
                {cart.reduce((s, c) => s + c.qty, 0)} Thans
              </span>
            }
          >
            <div className="table-scroll">
              <table className="cart-table">
                <thead>
                  <tr>
                    <th>Product / variant</th>
                    <th>Than size</th>
                    <th>Qty</th>
                    <th>Rate / Than</th>
                    <th>Discount</th>
                    <th className="align-right">Amount</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {cart.map((c) => (
                    <tr key={c.productId}>
                      <td>
                        <div className="cell-two">
                          <strong>{c.name}</strong>
                          <span>
                            {c.color} · {c.productId}
                          </span>
                        </div>
                      </td>
                      <td>
                        <Select
                          aria-label={`Than size for ${c.name}`}
                          value={c.size}
                          onChange={(e) =>
                            update(c.productId, "size", +e.target.value)
                          }
                        >
                          <option value={c.size}>{c.size}m</option>
                        </Select>
                      </td>
                      <td>
                        <Input
                          aria-label={`Quantity of ${c.name}`}
                          type="number"
                          min="1"
                          step="1"
                          value={c.qty}
                          onChange={(e) =>
                            update(c.productId, "qty", +e.target.value)
                          }
                        />
                      </td>
                      <td>
                        <Input
                          aria-label={`Rate for ${c.name}`}
                          type="number"
                          min="1"
                          value={c.rate}
                          onChange={(e) =>
                            update(c.productId, "rate", +e.target.value)
                          }
                        />
                      </td>
                      <td>
                        <Input
                          aria-label={`Discount for ${c.name}`}
                          type="number"
                          min="0"
                          value={c.discount}
                          onChange={(e) =>
                            update(c.productId, "discount", +e.target.value)
                          }
                        />
                      </td>
                      <td className="align-right numeric">
                        <strong>{money(c.qty * c.rate - c.discount)}</strong>
                      </td>
                      <td>
                        <Action
                          className="row-action delete-action"
                          aria-label={`Remove ${c.name}`}
                          onClick={() =>
                            setCart(
                              cart.filter(
                                (row) => row.productId !== c.productId,
                              ),
                            )
                          }
                        >
                          <Trash2 size={15} />
                        </Action>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!cart.length && (
              <div className="empty-state cart-empty">
                <ShoppingIcon />
                <Heading level={3}>Your invoice is ready to begin</Heading>
                <p>Select a party, then click a product above to add it.</p>
              </div>
            )}
            <div className="panel-note">
              <ShieldCheck size={14} />
              Rates are per Than. Stock updates only when you save.
            </div>
          </Panel>
        </div>
        <Panel
          className="pos-checkout"
          title={purchase ? "Supplier & payment" : "Party & payment"}
        >
          <div className="checkout-body">
            <Field label={purchase ? "Supplier" : "Customer / party"} required>
              <Select
                value={party}
                onChange={(e) => {
                  setParty(e.target.value)
                  setError("")
                }}
              >
                <option value="">
                  Select {purchase ? "supplier" : "party"}…
                </option>
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            {selectedParty && (
              <div className="party-balance">
                <div>
                  <span>Current {purchase ? "payable" : "outstanding"}</span>
                  <strong
                    className={
                      selectedParty.balance > 0 ? "red-text" : "green-text"
                    }
                  >
                    {money(selectedParty.balance)}
                  </strong>
                </div>
                <div>
                  <span>Credit limit</span>
                  <strong>{money(selectedParty.limit)}</strong>
                </div>
                <div>
                  <span>Payment terms</span>
                  <strong>30 days</strong>
                </div>
              </div>
            )}
            <div className="checkout-divider" />
            <div className="summary-row">
              <span>Subtotal</span>
              <strong>{money(subtotal)}</strong>
            </div>
            <div className="summary-row">
              <label htmlFor="invoice-discount">Invoice discount</label>
              <div className="input-prefix">
                <span>Rs.</span>
                <Input
                  id="invoice-discount"
                  type="number"
                  min="0"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                />
              </div>
            </div>
            <div className="grand-total">
              <span>Grand total</span>
              <strong>{money(total)}</strong>
            </div>
            <Field label="Payment type">
              <div className="payment-options">
                {["Cash", "Credit", "Partial"].map((m) => (
                  <Action
                    key={m}
                    className={method === m ? "selected" : ""}
                    onClick={() => setMethod(m)}
                  >
                    {m}
                  </Action>
                ))}
              </div>
            </Field>
            {method === "Partial" && (
              <Field label="Amount paid" required>
                <Input
                  type="number"
                  min="0"
                  max={total}
                  value={paid}
                  onChange={(e) => setPaid(e.target.value)}
                  placeholder="0"
                  autoFocus
                />
              </Field>
            )}
            {method !== "Credit" && (
              <Field label="Payment account">
                <Select
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                >
                  <option>Cash in hand</option>
                  <option>Meezan Bank</option>
                  <option>HBL Business</option>
                </Select>
              </Field>
            )}
            <div className="remaining-row">
              <span>
                {purchase ? "Remaining payable" : "Remaining balance"}
              </span>
              <strong>{money(total - received)}</strong>
            </div>
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <Button
              variant="primary"
              className="full-width"
              disabled={!cart.length}
              onClick={() => save(false)}
            >
              <Save size={16} />
              Save {purchase ? "purchase" : "sale"}
              <span className="shortcut">F8</span>
            </Button>
            <Button
              className="full-width"
              disabled={!cart.length}
              onClick={() => save(true)}
            >
              <Printer size={16} />
              Save & print<span className="key-hint">F9</span>
            </Button>
            <p className="checkout-hint">
              Review the party and amounts before saving.
            </p>
          </div>
        </Panel>
      </div>
    </>
  )
}
function ShoppingIcon() {
  return <FileText size={30} />
}

export function EntryForm({
  type,
  parties,
  products,
  initial,
  onClose,
  onSubmit,
}: {
  type: string
  parties: Party[]
  products: Product[]
  initial?: Party | Product
  onClose: () => void
  onSubmit: (data: Record<string, string>) => void
}) {
  const [error, setError] = useState("")
  const [selected, setSelected] = useState(initial?.id || "")
  const [amount, setAmount] = useState("")
  const [method, setMethod] = useState("Cash")
  const [quantity, setQuantity] = useState("")
  const [confirm, setConfirm] = useState(false)
  const party = parties.find((p) => p.id === selected)
  const product = products.find((p) => p.id === selected)
  const financial = type === "recovery" || type === "supplier-payment"
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const data = Object.fromEntries(
      new FormData(e.currentTarget),
    ) as Record<string, string>
    if (financial) {
      if (!party) return setError("Please select a party.")
      if (+amount <= 0 || +amount > party.balance)
        return setError(
          "Collection amount must be greater than zero and no more than the outstanding balance.",
        )
    }
    if ((type === "expense" || type === "transfer") && +data.amount <= 0)
      return setError("Enter an amount greater than zero.")
    if (type === "transfer" && data.from === data.to)
      return setError("Choose two different accounts.")
    if (type === "adjust") {
      if (!product) return setError("Select a product.")
      if (
        !Number.isInteger(+quantity) ||
        !+quantity ||
        product.stock + +quantity < 0
      )
        return setError(
          "Enter a whole number adjustment that does not make stock negative.",
        )
      if (!confirm) {
        setConfirm(true)
        return
      }
    }
    if (type === "party" && !data.name.trim())
      return setError("Enter the party name.")
    onSubmit(data)
  }
  return (
    <form onSubmit={submit}>
      <div className="modal-body">
        {financial && (
          <>
            <Field
              label={type === "recovery" ? "Customer / party" : "Supplier"}
              required
            >
              <Select
                name="partyId"
                value={selected}
                onChange={(e) => {
                  setSelected(e.target.value)
                  setError("")
                }}
                required
              >
                <option value="">Select a party…</option>
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            {party && (
              <div className="form-balance">
                <span>Current outstanding</span>
                <strong>{money(party.balance)}</strong>
                <small>
                  {party.city} · {party.phone}
                </small>
              </div>
            )}
            <Field label="Amount" required>
              <div className="large-amount-input">
                <span>Rs.</span>
                <Input
                  name="amount"
                  type="number"
                  min="1"
                  max={party?.balance}
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                />
              </div>
            </Field>
            <div className="form-grid">
              <Field label="Payment method">
                <Select
                  name="method"
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                >
                  <option>Cash</option>
                  <option>Bank</option>
                  <option>Cheque</option>
                </Select>
              </Field>
              <Field label="Payment account">
                <Select name="account">
                  <option>
                    {method === "Cash" ? "Cash in hand" : "Meezan Bank"}
                  </option>
                  <option>HBL Business</option>
                </Select>
              </Field>
            </div>
            {party && (
              <div className="summary-row">
                <span>Balance after payment</span>
                <strong>{money(party.balance - +amount)}</strong>
              </div>
            )}
          </>
        )}
        {type === "expense" && (
          <>
            <Field label="Category" required>
              <Select name="category" required>
                <option>Transportation</option>
                <option>Utilities</option>
                <option>Rent</option>
                <option>Salaries</option>
                <option>Office supplies</option>
                <option>Other</option>
              </Select>
            </Field>
            <Field label="Amount" required>
              <Input
                name="amount"
                type="number"
                min="1"
                required
                placeholder="Enter amount in Rs."
              />
            </Field>
            <Field label="Pay from account">
              <Select name="account">
                <option>Cash in hand</option>
                <option>Meezan Bank</option>
                <option>HBL Business</option>
              </Select>
            </Field>
          </>
        )}
        {type === "transfer" && (
          <>
            <div className="info-notice">
              <ArrowRight size={17} />
              Transfers move money between accounts. They are not income or
              expenses.
            </div>
            <Field label="From account">
              <Select name="from">
                <option>Cash in hand</option>
                <option>Meezan Bank</option>
                <option>HBL Business</option>
              </Select>
            </Field>
            <Field label="To account">
              <Select name="to" defaultValue="Meezan Bank">
                <option>Cash in hand</option>
                <option>Meezan Bank</option>
                <option>HBL Business</option>
              </Select>
            </Field>
            <Field label="Amount" required>
              <Input name="amount" type="number" min="1" required />
            </Field>
          </>
        )}
        {type === "adjust" && (
          <>
            <Field label="Product" required>
              <Select
                name="productId"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                required
              >
                <option value="">Select product…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.color} · {p.size}m
                  </option>
                ))}
              </Select>
            </Field>
            {product && (
              <div className="form-balance">
                <span>Current stock</span>
                <strong>{product.stock} Thans</strong>
                <small>{product.id}</small>
              </div>
            )}
            <Field
              label="Adjustment quantity"
              required
              hint="Use a negative number to reduce stock, e.g. −2."
            >
              <Input
                name="quantity"
                type="number"
                step="1"
                required
                value={quantity}
                onChange={(e) => {
                  setQuantity(e.target.value)
                  setConfirm(false)
                }}
              />
            </Field>
            <Field label="Reason" required>
              <Select name="reason">
                <option>Physical count correction</option>
                <option>Damaged fabric</option>
                <option>Opening stock</option>
                <option>Other correction</option>
              </Select>
            </Field>
            <div className="info-notice">
              <ShieldCheck size={17} />
              Authorized by Ahmed Ali · Owner / Admin
            </div>
            {confirm && (
              <div className="confirm-notice">
                <strong>Confirm stock adjustment?</strong>
                <p>
                  Stock will change from {product?.stock} to{" "}
                  {(product?.stock || 0) + +quantity} Thans. This adjustment
                  will be recorded in the stock movement log.
                </p>
              </div>
            )}
          </>
        )}
        {type === "party" && (
          <>
            <Field label="Party name" required>
              <Input
                name="name"
                required
                placeholder="Business or party name"
              />
            </Field>
            <div className="form-grid">
              <Field label="City" required>
                <Input name="city" required />
              </Field>
              <Field label="Phone">
                <Input name="phone" type="tel" />
              </Field>
            </div>
            <div className="form-grid">
              <Field label="Credit limit (Rs.)">
                <Input
                  name="limit"
                  type="number"
                  min="0"
                  defaultValue="100000"
                />
              </Field>
              <Field label="Payment terms">
                <Select name="terms">
                  <option>30 days</option>
                  <option>15 days</option>
                  <option>Cash only</option>
                  <option>60 days</option>
                </Select>
              </Field>
            </div>
          </>
        )}
        {type === "user" && (
          <>
            <Field label="Full name" required>
              <Input name="name" required />
            </Field>
            <Field label="Username" required>
              <Input name="username" required />
            </Field>
            <Field label="Role">
              <Select name="role">
                <option>Sales User</option>
                <option>Accountant</option>
                <option>Store Manager</option>
                <option>Recovery Staff</option>
                <option>Viewer</option>
              </Select>
            </Field>
            <Field label="Initial password" required>
              <Input name="password" type="password" minLength={8} required />
            </Field>
          </>
        )}
        {type !== "party" && type !== "user" && (
          <Field label="Date">
            <Input name="date" type="date" defaultValue={today} required />
          </Field>
        )}
        {type !== "user" && (
          <Field label={type === "adjust" ? "Additional notes" : "Notes"}>
            <Textarea name="notes" rows={2} placeholder="Optional details…" />
          </Field>
        )}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
      </div>
      <div className="modal-footer">
        <Button type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary">
          <Check size={16} />
          {type === "recovery"
            ? "Save & view receipt"
            : type === "adjust" && confirm
              ? "Confirm adjustment"
              : type === "adjust"
                ? "Review adjustment"
                : type === "party"
                  ? "Add party"
                  : type === "user"
                    ? "Add user"
                    : "Save"}
        </Button>
      </div>
    </form>
  )
}

export function PartyDetails({
  party,
  supplier = false,
  sales,
  collections,
  onAction,
}: {
  party: Party
  supplier?: boolean
  sales: Transaction[]
  collections: Collection[]
  onAction: (action: string) => void
}) {
  const [tab, setTab] = useState("Ledger / Khata")
  const [start, setStart] = useState("2025-06-01")
  const [end, setEnd] = useState(today)
  const transactions = sales.filter((s) => s.party === party.name)
  const payments = collections.filter((c) => c.party === party.name)
  const ledger = [
    ...transactions.map((s) => ({
      id: s.id,
      date: s.date,
      description: supplier ? "Purchase invoice" : "Sales invoice",
      debit: s.total,
      credit: s.paid,
    })),
    ...payments.map((c) => ({
      id: c.id,
      date: c.date,
      description: c.notes || "Payment received",
      debit: 0,
      credit: c.amount,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date))
  let running =
    party.balance - ledger.reduce((s, r) => s + r.debit - r.credit, 0)
  const withBalance = ledger
    .map((r) => {
      running += r.debit - r.credit
      return { ...r, balance: running }
    })
    .filter((r) => r.date >= start && r.date <= end)
  return (
    <>
      <div className="party-detail-header">
        <div className="party-avatar">
          {party.name
            .split(" ")
            .map((n) => n[0])
            .slice(0, 2)
            .join("")}
        </div>
        <div>
          <Heading level={2}>{party.name}</Heading>
          <p>
            {party.id} · {party.city} · {party.phone}
          </p>
          <span className="muted">
            Payment terms: 30 days · Credit limit: {money(party.limit)}
          </span>
        </div>
        <div className="party-detail-balance">
          <span>Current {supplier ? "payable" : "outstanding"}</span>
          <strong>{money(party.balance)}</strong>
          <Badge>{party.status}</Badge>
        </div>
      </div>
      <div className="detail-actions">
        <Button variant="primary" onClick={() => onAction("payment")}>
          <Wallet size={15} />
          {supplier ? "Pay supplier" : "Receive payment"}
        </Button>
        <Button onClick={() => onAction("sale")}>
          <Plus size={15} />
          {supplier ? "New purchase" : "New sale"}
        </Button>
        <Button onClick={() => window.print()}>
          <Printer size={15} />
          Print statement
        </Button>
      </div>
      <Tabs
        tabs={["Ledger / Khata", "Transactions", "Payments", "Aging"]}
        active={tab}
        onChange={setTab}
      />
      <div className="detail-content">
        <div className="table-toolbar">
          <span className="muted">
            {tab === "Ledger / Khata" ? "Complete account statement" : tab}
          </span>
          <div className="date-filters">
            <Input
              type="date"
              aria-label="From date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
            <span>to</span>
            <Input
              type="date"
              aria-label="To date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </div>
        </div>
        {tab === "Aging" ? (
          <div className="aging-grid">
            {["0–30 days", "31–60 days", "61–90 days", "90+ days"].map(
              (a, i) => (
                <div key={a}>
                  <span>{a}</span>
                  <strong className={i > 0 ? "red-text" : ""}>
                    {money(
                      i === 0
                        ? party.balance * 0.65
                        : i === 1
                          ? party.balance * 0.35
                          : 0,
                    )}
                  </strong>
                </div>
              ),
            )}
          </div>
        ) : (
          <DataTable
            rows={
              tab === "Payments"
                ? withBalance.filter((r) => r.credit > 0)
                : tab === "Transactions"
                  ? withBalance.filter((r) => r.debit > 0)
                  : withBalance
            }
            columns={[
              { key: "date", label: "Date" },
              {
                key: "id",
                label: "Reference",
                render: (r) => <span className="reference">{r.id}</span>,
              },
              { key: "description", label: "Description" },
              {
                key: "debit",
                label: "Debit",
                right: true,
                render: (r) => (r.debit ? money(r.debit) : "—"),
              },
              {
                key: "credit",
                label: "Credit",
                right: true,
                render: (r) =>
                  r.credit ? (
                    <span className="green-text">{money(r.credit)}</span>
                  ) : (
                    "—"
                  ),
              },
              {
                key: "balance",
                label: "Balance",
                right: true,
                render: (r) => <strong>{money(r.balance)}</strong>,
              },
            ]}
          />
        )}
      </div>
      <div className="statement-total">
        <span>Closing balance</span>
        <strong>{money(party.balance)}</strong>
      </div>
    </>
  )
}

export function InvoicePreview({
  transaction,
  collection,
  onClose,
}: {
  transaction?: Transaction
  collection?: Collection
  onClose: () => void
}) {
  const [layout, setLayout] = useState("A4 invoice")
  const { business } = useBusiness()
  const receipt = !!collection
  return (
    <>
      <div className="invoice-toolbar">
        <span>
          <Badge tone="green">Saved</Badge>{" "}
          {receipt ? "Payment receipt" : "Invoice preview"}
        </span>
        <Select
          aria-label="Print layout"
          value={layout}
          onChange={(e) => setLayout(e.target.value)}
        >
          <option>A4 invoice</option>
          <option>Thermal receipt</option>
        </Select>
      </div>
      <div
        className={`invoice-paper ${
          layout === "Thermal receipt" ? "thermal" : ""
        }`}
      >
        <div className="invoice-brand">
          <BrandMark logo={business.logo} />
          <div>
            <Heading level={2}>{business.name}</Heading>
            {business.tagline && <p>{business.tagline}</p>}
          </div>
        </div>
        <p className="invoice-address">
          {business.address}
          <br />
          {[business.phone, business.email].filter(Boolean).join(" · ")}
        </p>
        <div className="invoice-title">
          <Heading level={3}>
            {receipt
              ? "PAYMENT RECEIPT"
              : transaction?.id.startsWith("PUR")
                ? "PURCHASE INVOICE"
                : "SALES INVOICE"}
          </Heading>
          <span>{transaction?.id || collection?.id}</span>
        </div>
        <div className="invoice-meta">
          <div>
            <span>{receipt ? "Received from" : "Bill to"}</span>
            <strong>{transaction?.party || collection?.party}</strong>
            <span>Lahore, Pakistan</span>
          </div>
          <div>
            <span>Date: {transaction?.date || collection?.date}</span>
            <span>Prepared by: Ahmed Ali</span>
          </div>
        </div>
        {receipt ? (
          <div className="receipt-amount">
            <span>Amount received</span>
            <strong>{money(collection!.amount)}</strong>
            <p>
              {collection!.method} · {collection!.account}
            </p>
          </div>
        ) : (
          <DataTable
            rows={
              transaction?.lines || [
                {
                  productId: "sample",
                  name: "Wholesale fabric (invoice summary)",
                  color: "Mixed",
                  size: 30,
                  qty: transaction?.items || 0,
                  rate: (transaction?.total || 0) / (transaction?.items || 1),
                  discount: 0,
                },
              ]
            }
            columns={[
              {
                key: "name",
                label: "Description",
                render: (r) => (
                  <div className="cell-two">
                    <strong>{r.name}</strong>
                    <span>{r.color}</span>
                  </div>
                ),
              },
              { key: "size", label: "Than size", render: (r) => `${r.size}m` },
              { key: "qty", label: "Qty", right: true },
              {
                key: "rate",
                label: "Rate",
                right: true,
                render: (r) => money(r.rate),
              },
              {
                key: "discount",
                label: "Disc.",
                right: true,
                render: (r) => money(r.discount),
              },
              {
                key: "total",
                label: "Amount",
                right: true,
                render: (r) => money(r.qty * r.rate - r.discount),
              },
            ]}
          />
        )}
        {!receipt && (
          <div className="invoice-totals">
            <div>
              <span>Total</span>
              <strong>{money(transaction?.total || 0)}</strong>
            </div>
            <div>
              <span>Paid · {transaction?.method}</span>
              <span>{money(transaction?.paid || 0)}</span>
            </div>
            <div>
              <span>Remaining balance</span>
              <strong>
                {money((transaction?.total || 0) - (transaction?.paid || 0))}
              </strong>
            </div>
          </div>
        )}
        <div className="invoice-note">
          {collection?.notes || "Please keep this document for your records."}
          <br />
          {business.invoiceFooter || "Thank you for your business."}
        </div>
        <div className="invoice-signature">
          <span>Customer signature</span>
          <span>Authorized signature</span>
        </div>
      </div>
      <div className="modal-footer">
        <Button onClick={onClose}>Close</Button>
        <Button onClick={() => window.print()}>
          <FileText size={15} />
          Save PDF
        </Button>
        <Button variant="primary" onClick={() => window.print()}>
          <Printer size={15} />
          Print {receipt ? "receipt" : "invoice"}
        </Button>
      </div>
    </>
  )
}

export function StockDetails({
  product,
  onAdjust,
  movements,
}: {
  product: Product
  onAdjust: () => void
  movements: {
    id: string
    date: string
    type: string
    quantity: number
    productId: string
    reason: string
  }[]
}) {
  const rows = movements.filter((m) => m.productId === product.id)
  return (
    <>
      <div className="stock-detail">
        <span
          className={`fabric-swatch large-swatch swatch-${product.color.split(" ")[0].toLowerCase()}`}
        />
        <div>
          <Heading level={2}>{product.name}</Heading>
          <p>
            {product.company} · {product.article} · {product.color}
          </p>
          <span className="muted">
            {product.id} · {product.size} meters per Than
          </span>
        </div>
        <div className="stock-detail-number">
          <strong>{product.stock}</strong>
          <span>Thans available</span>
        </div>
      </div>
      <div className="stock-price-row">
        <div>
          <span>Average cost / Than</span>
          <strong>{money(product.cost)}</strong>
        </div>
        <div>
          <span>Selling price / Than</span>
          <strong>{money(product.rate)}</strong>
        </div>
        <div>
          <span>Stock value</span>
          <strong>{money(product.stock * product.cost)}</strong>
        </div>
      </div>
      <div className="panel-heading">
        <div>
          <Heading level={2}>Stock movement</Heading>
          <p>Every stock change, with a clear reference</p>
        </div>
        <Button onClick={onAdjust}>
          <Package size={15} />
          Adjust stock
        </Button>
      </div>
      <DataTable
        rows={rows}
        empty="No stock movements recorded yet"
        columns={[
          { key: "date", label: "Date" },
          { key: "id", label: "Reference" },
          {
            key: "type",
            label: "Type",
            render: (r) => <Badge tone="neutral">{r.type}</Badge>,
          },
          {
            key: "in",
            label: "Qty in",
            right: true,
            render: (r) =>
              r.quantity > 0 ? (
                <span className="green-text">+{r.quantity}</span>
              ) : (
                "—"
              ),
          },
          {
            key: "out",
            label: "Qty out",
            right: true,
            render: (r) =>
              r.quantity < 0 ? (
                <span className="red-text">{Math.abs(r.quantity)}</span>
              ) : (
                "—"
              ),
          },
          { key: "reason", label: "Reason" },
          { key: "user", label: "User", render: () => "Ahmed Ali" },
        ]}
      />
      <div className="panel-note">
        <ShieldCheck size={14} />
        Stock is tracked separately for each article, variant and Than size.
      </div>
    </>
  )
}
