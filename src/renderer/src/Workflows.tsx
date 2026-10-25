import { useEffect, useRef, useState } from "react"
import { useDebounced, useRemote } from "./remote"
import { BrandMark, useBusiness } from "./business"
import { useConfig } from "./config"
import { PhotoField, ProductPhoto, type PhotoChoice } from "./photo"
import { ColourChipsMulti, ColourPicker, FabricSwatch } from "./colours"
import { loadDraft, saveDraft } from "./drafts"
import { api } from "./backend"
import { billRows, breakdown, fmtM, lineGross, metersOf } from "@shared/meters"
const lk = (c: { uid?: string; productId: string }) => c.uid ?? c.productId

/** One product (article + colour) is shown once, with a chip per length it is held in: "20 m × 5". */
/** Sold by the meter: it has a length, or it is a cloth product that has never been stocked or given a size (its length comes with the first purchase). */
const byTheMeter = (p: Product, thanOn: boolean) => (p.length !== null && p.length !== undefined) || (thanOn && !p.size && p.stock === 0)

function groupProducts(list: Product[], thanOn: boolean): Product[][] {
  const out: Product[][] = []
  const at = new Map<string, Product[]>()
  for (const p of list) {
    if (!byTheMeter(p, thanOn)) {
      out.push([p])
      continue
    }
    const key = [p.company, p.article, p.color, p.design ?? ""].join("|")
    const g = at.get(key)
    if (g) g.push(p)
    else {
      const fresh = [p]
      at.set(key, fresh)
      out.push(fresh)
    }
  }
  for (const g of at.values()) g.sort((a, b) => (a.length ?? 0) - (b.length ?? 0))
  // a product with no length yet sorts first; it is only the anchor for "+ new length"
  return out
}

function LengthChips({ items, purchase, onPick }: { items: Product[]; purchase: boolean; onPick: (p: Product, newLength?: boolean) => void }) {
  return (
    <div className="length-chips">
      {items.filter((p) => p.length != null).map((p) => (
        <Action key={p.id} className="length-chip" disabled={!purchase && p.stock === 0} onClick={() => onPick(p)} title={`${fmtM(p.length!)} meter than`}>
          {fmtM(p.length!)} m × {p.stock}
        </Action>
      ))}
      {purchase && (
        <Action className="length-chip new-length" onClick={() => onPick(items[0], true)}>
          + new length
        </Action>
      )}
    </div>
  )
}
import { billToPng, copyPng } from "./billImage"
import type { LedgerView } from "@shared/models"
import type { Masters } from "@shared/models"
import {
  Pencil,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  LayoutGrid,
  List,
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
  L,
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
  walkInId,
  accounts,
  onSave,
  onHistory,
  onAddProduct,
  onAddParty,
}: {
  /** Opens the "Add product" / "Add party" forms so a first sale never needs a trip to another screen. */
  onAddProduct?: () => void
  onAddParty?: () => void
  purchase?: boolean
  parties: Party[]
  walkInId?: string
  accounts: { name: string; type: string }[]
  onSave: (sale: Transaction, print: boolean) => Promise<boolean>
  onHistory: () => void
}) {
  const { isEnabled, profile } = useConfig()
  // The catalogue can hold tens of thousands of items, so the picker asks the engine for one page at a time.
  const known = useRef(new Map<string, Product>())
  const batchOn = purchase && (isEnabled("batch") || isEnabled("expiry"))
  const [query, setQuery] = useState("")
  const dq = useDebounced(query)
  const { data: result, loading: searching, error: searchError } = useRemote("products:list", { query: dq, activeOnly: true, pageSize: 24 })
  const found = result?.rows ?? []
  for (const p of found) known.current.set(p.id, p)
  // Counter shops (cosmetics) mostly sell to whoever walks in; wholesalers choose the party every time, so no default there.
  const [view, setView] = useState<"grid" | "list">(() => {
    try {
      const saved = localStorage.getItem("erp.posView")
      if (saved === "grid" || saved === "list") return saved
    } catch {
      /* private mode: use the default */
    }
    return profile === "cosmetics" ? "grid" : "list"
  })
  function chooseView(v: "grid" | "list") {
    setView(v)
    try {
      localStorage.setItem("erp.posView", v)
    } catch {
      /* not saved; still works for this session */
    }
  }
  const kind = purchase ? "purchase" : "sale"
  const draft = useRef(loadDraft(kind)).current
  const [party, setParty] = useState(draft?.party ?? (!purchase && profile === "cosmetics" && walkInId ? walkInId : ""))
  const [cart, setCart] = useState<CartItem[]>(draft?.cart ?? [])
  const [method, setMethod] = useState(draft?.method ?? "Cash")
  const [paid, setPaid] = useState(draft?.paid ?? "")
  const [account, setAccount] = useState(draft?.account ?? accounts[0]?.name ?? "")
  const [discount, setDiscount] = useState(draft?.discount ?? "0")
  const [error, setError] = useState("")
  const [invoice, setInvoice] = useState(draft?.invoice ?? "")
  const [invoiceDate, setInvoiceDate] = useState(draft?.invoiceDate ?? today)
  const [saving, setSaving] = useState(false)
  const savedCart = useRef<unknown>(null)
  const savingNow = useRef(false) // a double click or a repeated F8 must never save the same bill twice
  useEffect(() => {
    saveDraft(kind, cart.length ? { party, cart, method, paid, account, discount, invoice, invoiceDate } : undefined)
  }, [kind, party, cart, method, paid, account, discount, invoice, invoiceDate])
  // the bill-number box starts with the last number plus one; the user types over it when the bill book says otherwise
  async function suggestNo() {
    try {
      setInvoice((await api("sale:suggestNo")).invoiceNo)
    } catch {
      /* the box stays empty and the program numbers the bill itself */
    }
  }
  useEffect(() => {
    if (!purchase && !draft?.invoice) void suggestNo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const subtotal = cart.reduce((sum, i) => sum + lineGross(i) - i.discount, 0)
  const total = Math.max(0, subtotal - Number(discount))
  const received =
    method === "Cash" ? total : method === "Credit" ? 0 : Number(paid || 0)
  const selectedParty = parties.find((p) => p.id === party) ?? (walkInId && party === walkInId ? ({ id: walkInId, name: "Walk-in customer", city: "", phone: "", balance: 0, limit: 0, status: "Clear" } as Party) : undefined)
  /** `newLength`: a purchase of a length this product has not had yet (the length is typed on the line). */
  function addProduct(p: Product, newLength = false) {
    known.current.set(p.id, p)
    if (!purchase && p.stock === 0) return
    const meter = byTheMeter(p, isEnabled("than"))
    if (meter && p.length == null) newLength = true
    const uid = meter ? (newLength ? `${p.id}@new${Date.now()}` : `${p.id}@${p.length}`) : undefined
    // functional update: a fast scan right after a save must never work from an old copy of the cart
    setCart((cur) =>
      cur.some((c) => lk(c) === (uid ?? p.id))
        ? cur.map((c) => (lk(c) === (uid ?? p.id) ? { ...c, qty: c.qty + 1 } : c))
        : [...cur, { productId: p.id, uid, name: p.name, color: p.color, size: p.size, ...(meter ? { length: newLength ? 0 : p.length! } : {}), qty: 1, rate: (meter ? cur.find((c) => c.name === p.name && c.length !== undefined && c.rate > 0)?.rate : undefined) ?? (purchase ? p.purchasePrice : p.price), discount: 0 }],
    )
    setError("")
    // a wholesaler quotes each customer a rate of their own: start from what this customer paid last time
    if (!purchase && party) {
      void api("sale:lastRate", { partyId: party, productId: p.id })
        .then((r) => r.rate && setCart((cur) => cur.map((c) => (c.productId === p.id && c.rate === p.price ? { ...c, rate: r.rate! } : c))))
        .catch(() => undefined)
    }
  }
  function update(id: string, key: string, value: number | string) {
    setCart((cur) => cur.map((c) => (lk(c) === id ? { ...c, [key]: value } : c)))
  }
  async function save(print: boolean) {
    if (savingNow.current || cart === savedCart.current) return // already saving, or a stale copy of a bill that is already saved
    savingNow.current = true
    setSaving(true)
    let done = false
    try {
      done = await saveBill(print)
      if (done) savedCart.current = cart
    } finally {
      setSaving(false)
      savingNow.current = false
    }
  }
  async function saveBill(print: boolean): Promise<boolean> {
    if (!party) return fail(`Select a ${purchase ? "supplier" : "party"} before saving.`)
    if (!cart.length) return fail("Add at least one product to the invoice.")
    if (cart.some((c) => c.qty <= 0 || !Number.isInteger(c.qty) || c.rate < 0 || c.discount < 0 || c.discount > lineGross(c)))
      return fail(`Check quantities, rates and discounts. ${L.units} must be whole numbers.`)
    if (purchase && cart.some((c) => c.length !== undefined && !(c.length > 0))) return fail("Enter the length (meters) of every than.")
    if (cart.some((c) => c.length !== undefined && Math.abs(c.length * 10 - Math.round(c.length * 10)) > 1e-6)) return fail("Length can have only one decimal, e.g. 44.5.")
    if (!purchase && cart.some((c) => !(c.rate > 0))) return fail("Enter the rate for every item.")
    if (!purchase && cart.some((c) => known.current.has(c.productId) && c.qty > known.current.get(c.productId)!.stock))
      return fail("The quantity exceeds available stock. Please adjust the quantity.")
    const twoDecimals = (x: number) => Math.abs(x * 100 - Math.round(x * 100)) < 0.001
    if (cart.some((c) => !twoDecimals(c.rate) || !twoDecimals(c.discount)) || !twoDecimals(Number(discount)) || !twoDecimals(received))
      return fail("Rates, discounts and payments can have at most 2 decimal places (paisa).")
    if (Number(discount) < 0 || Number(discount) > subtotal) return fail("Invoice discount must be between zero and the subtotal.")
    if (received > total || received < 0 || (method === "Partial" && (!received || received >= total)))
      return fail("Enter a partial payment greater than zero and less than the total.")
    if (method !== "Credit" && received > 0 && !account) return fail("Choose the account the payment goes into.")
    const saved = await onSave(
      {
        id: "",
        party: selectedParty!.name,
        partyId: party,
        date: purchase ? invoiceDate : today,
        items: cart.reduce((s, c) => s + c.qty, 0),
        total,
        paid: received,
        method,
        lines: cart,
        account,
        supplierInvoice: invoice.trim() || undefined,
        invoiceDiscount: Number(discount),
      },
      print,
    )
    if (!saved) return fail("Could not save. Nothing was changed; your invoice has been kept.")
    setInvoice("")
    if (!purchase) void suggestNo()
    setCart([])
    setPaid("")
    setDiscount("0")
    setError("")
    return true
  }
  function fail(msg: string) {
    setError(msg)
    return false
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
            {!purchase && (
              <div className="purchase-meta">
                <Field label="Bill number" hint="The number on your bill book. It must not repeat.">
                  <Input aria-label="Bill number" value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder="Automatic" maxLength={30} />
                </Field>
              </div>
            )}
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
              onKeyDown={async (e) => {
                if (
                  e.key !== "Enter" ||
                  e.target !== e.currentTarget.querySelector("input")
                )
                  return
                e.preventDefault()
                // A barcode scanner types and presses Enter faster than the search debounce: ask the engine right now.
                const typed = query.trim()
                try {
                  const hit = await api("products:list", { query: typed, activeOnly: true, pageSize: 5 })
                  const product = hit.rows.find((p) => p.barcode && p.barcode === typed && (purchase || p.stock > 0)) ?? hit.rows.find((p) => purchase || p.stock > 0)
                  if (product) {
                    addProduct(product)
                    setQuery("")
                  }
                } catch (err) {
                  setError((err as Error).message)
                }
              }}
            >
              <SearchBox
                value={query}
                onChange={setQuery}
                placeholder={isEnabled("barcode") ? "Scan a barcode or search by name…" : "Search by name, article or code…"}
              />
              <span className="key-hint">Enter to select</span>
              <div className="view-toggle" role="group" aria-label="Product view">
                <Action className={view === "grid" ? "active" : ""} aria-pressed={view === "grid"} title="Photo grid" onClick={() => chooseView("grid")}>
                  <LayoutGrid size={15} />
                </Action>
                <Action className={view === "list" ? "active" : ""} aria-pressed={view === "list"} title="List" onClick={() => chooseView("list")}>
                  <List size={15} />
                </Action>
              </div>
            </div>
            {view === "grid" && found.length > 0 && (
              <div className="product-grid">
                {groupProducts(found, isEnabled("than")).map((g) =>
                  byTheMeter(g[0], isEnabled("than")) ? (
                    <div className="product-card group-card" key={g[0].id}>
                      <ProductPhoto product={g[0]} size="t" className="card-photo" />
                      <strong title={g[0].name}>{g[0].name}</strong>
                      <span className="card-sub">{g[0].company}</span>
                      <LengthChips items={g} purchase={purchase} onPick={addProduct} />
                      {(purchase ? g[0].purchasePrice : g[0].price) > 0 && <span className="card-price">{money(purchase ? g[0].purchasePrice : g[0].price)} / m</span>}
                    </div>
                  ) : (
                  (([p]) => (
                  <Action className="product-card" key={p.id} disabled={!purchase && p.stock === 0} onClick={() => addProduct(p)}>
                    <ProductPhoto product={p} size="t" className="card-photo" />
                    <strong title={p.name}>{p.name}</strong>
                    <span className="card-sub">{[p.company, p.size].filter(Boolean).join(" · ")}</span>
                    <span className="card-price">{money(purchase ? p.cost : p.price)}</span>
                    <small className={p.stock === 0 ? "red-text" : p.stock < 10 ? "amber-text" : "muted"}>
                      {p.stock === 0 ? "Out of stock" : `${p.stock} ${L.units}`}
                    </small>
                  </Action>
                  ))(g)
                  ),
                )}
              </div>
            )}
            <div className="product-picker" hidden={view === "grid"}>
              {groupProducts(found, isEnabled("than")).map((g) =>
                byTheMeter(g[0], isEnabled("than")) ? (
                  <div className="product-option group-option" key={g[0].id}>
                    {g[0].image ? <ProductPhoto product={g[0]} className="list-photo" /> : <FabricSwatch name={g[0].color} />}
                    <span className="product-option-info">
                      <strong>{g[0].name}</strong>
                      <span>
                        {g[0].company} · {g[0].article}
                      </span>
                      <LengthChips items={g} purchase={purchase} onPick={addProduct} />
                    </span>
                    <span className="product-option-right">
                      {(purchase ? g[0].purchasePrice : g[0].price) > 0 && <strong>{money(purchase ? g[0].purchasePrice : g[0].price)} / m</strong>}
                      <small>{g.reduce((s, x) => s + x.stock, 0)} {L.units} in stock</small>
                    </span>
                  </div>
                ) : (
                  (([p]) => (
                <Action
                  className="product-option"
                  key={p.id}
                  disabled={!purchase && p.stock === 0}
                  onClick={() => addProduct(p)}
                >
                  {p.image ? <ProductPhoto product={p} className="list-photo" /> : <FabricSwatch name={p.color} />}
                  <span className="product-option-info">
                    <strong>{p.name}</strong>
                    <span>
                      {p.company} · {p.article}
                    </span>
                    <small>
                      {[p.color, p.size].filter(Boolean).join(" · ") || p.unit}
                    </small>
                  </span>
                  <span className="product-option-right">
                    <strong>{money(purchase ? p.cost : p.price)}</strong>
                    <small className={p.stock < 10 ? "amber-text" : ""}>
                      {p.stock} {L.units} in stock
                    </small>
                    <Plus size={15} />
                  </span>
                </Action>
                  ))(g)
                ),
              )}
            </div>
            {!found.length && !searching && (
              <div className="empty-state">
                <Search size={28} />
                {!searchError && !dq && onAddProduct ? (
                  <>
                    <Heading level={3}>No products yet</Heading>
                    <p>Add the items you sell, then come back to make your first sale.</p>
                    <Button variant="primary" onClick={onAddProduct}>
                      <Plus size={15} />
                      Add your first product
                    </Button>
                  </>
                ) : (
                  <>
                    <Heading level={3}>{searchError ? "Could not load products" : "No matching products"}</Heading>
                    <p>{searchError || "Try a product name or article number."}</p>
                  </>
                )}
              </div>
            )}
            {(result?.total ?? 0) > found.length && (
              <p className="muted" style={{ padding: "8px 4px 0" }}>
                Showing the first {found.length} of {result!.total.toLocaleString()} items. Type to narrow the list.
              </p>
            )}
          </Panel>
          <Panel
            title={purchase ? "Purchase items" : "Sale items"}
            action={
              <span className="small-tag">
                {cart.reduce((s, c) => s + c.qty, 0)} {L.units}
              </span>
            }
          >
            <div className="table-scroll">
              <table className="cart-table">
                <thead>
                  <tr>
                    <th>Product / variant</th>
                    <th>{L.size}</th>
                    {batchOn && <th>Batch</th>}
                    {batchOn && isEnabled("expiry") && <th>Expiry</th>}
                    <th>Qty</th>
                    <th>{cart.some((c) => c.length !== undefined) ? "Rate / meter" : L.rate}</th>
                    <th>Discount</th>
                    <th className="align-right">Amount</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {cart.map((c) => (
                    <tr key={lk(c)}>
                      <td>
                        <div className="cell-two">
                          <strong>{c.name}</strong>
                          <span>
                            {c.color} · {c.productId}
                          </span>
                          {c.length ? (
                            <span className="meter-line">
                              {c.qty} × {fmtM(c.length)} m = {fmtM(metersOf(c))} m
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        {purchase && c.length !== undefined ? (
                          <Input
                            aria-label={`Length of ${c.name}`}
                            type="number"
                            min="0.1"
                            step="0.1"
                            placeholder="Meters"
                            value={c.length || ""}
                            onChange={(e) => update(lk(c), "length", +e.target.value)}
                          />
                        ) : c.length ? (
                          `${fmtM(c.length)} m`
                        ) : (
                          c.size || "—"
                        )}
                      </td>
                      {batchOn && (
                        <td>
                          <Input aria-label={`Batch of ${c.name}`} value={c.batchNo ?? ""} onChange={(e) => update(lk(c), "batchNo", e.target.value)} placeholder="Batch no." />
                        </td>
                      )}
                      {batchOn && isEnabled("expiry") && (
                        <td>
                          <Input aria-label={`Expiry of ${c.name}`} type="date" value={c.expiryDate ?? ""} onChange={(e) => update(lk(c), "expiryDate", e.target.value)} />
                        </td>
                      )}
                      <td>
                        <Input
                          aria-label={`Quantity of ${c.name}`}
                          type="number"
                          min="1"
                          step="1"
                          value={c.qty}
                          onChange={(e) =>
                            update(lk(c), "qty", +e.target.value)
                          }
                        />
                      </td>
                      <td>
                        <Input
                          aria-label={`Rate for ${c.name}`}
                          type="number"
                          min="0"
                          value={!purchase && !c.rate ? "" : c.rate}
                          placeholder={purchase ? undefined : "Rate"}
                          onChange={(e) =>
                            update(lk(c), "rate", +e.target.value)
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
                            update(lk(c), "discount", +e.target.value)
                          }
                        />
                      </td>
                      <td className="align-right numeric">
                        <strong>{money(lineGross(c) - c.discount)}</strong>
                      </td>
                      <td>
                        <Action
                          className="row-action delete-action"
                          aria-label={`Remove ${c.name}`}
                          onClick={() =>
                            setCart(
                              cart.filter(
                                (row) => lk(row) !== lk(c),
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
                <p>Click a product above to add it. Choose the {purchase ? "supplier" : "customer"} on the right before you save.</p>
              </div>
            )}
            <div className="panel-note">
              <ShieldCheck size={14} />
              Rates are {L.perUnit}. Stock updates only when you save.
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
                {!purchase && walkInId && <option value={walkInId}>Walk-in customer</option>}
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.city && parties.filter((q) => q.name.toLowerCase() === p.name.toLowerCase()).length > 1 ? ` — ${p.city}` : ""}
                  </option>
                ))}
              </Select>
              {onAddParty && (
                <button type="button" className="gs-link" style={{ paddingLeft: 0 }} onClick={onAddParty}>
                  + New {purchase ? "supplier" : "customer"}
                </button>
              )}
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
                  <strong>{selectedParty.terms ? `${selectedParty.terms} days` : "Not set"}</strong>
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
                  {accounts.map((a) => (
                    <option key={a.name}>{a.name}</option>
                  ))}
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
              disabled={!cart.length || saving}
              onClick={() => save(false)}
            >
              <Save size={16} />
              Save {purchase ? "purchase" : "sale"}
              <span className="shortcut">F8</span>
            </Button>
            <Button
              className="full-width"
              disabled={!cart.length || saving}
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

/** Search-as-you-type product chooser for forms: asks the engine for one small page, never the whole catalogue. */
export function ProductPicker({ value, initial, onPick, filter }: { value: string; initial?: Product; onPick: (p: Product | undefined) => void; filter?: (p: Product) => boolean }) {
  const [q, setQ] = useState("")
  const dq = useDebounced(q)
  const { data, loading } = useRemote("products:list", { query: dq, activeOnly: true, pageSize: 20 })
  const known = useRef(new Map<string, Product>())
  if (initial?.id) known.current.set(initial.id, initial)
  const rows = (data?.rows ?? []).filter((p) => !filter || filter(p))
  for (const p of rows) known.current.set(p.id, p)
  const options = value && !rows.some((p) => p.id === value) && known.current.has(value) ? [known.current.get(value)!, ...rows] : rows
  return (
    <>
      <SearchBox value={q} onChange={setQ} placeholder="Type a name, article, SKU or barcode…" />
      <Select name="productId" value={value} onChange={(e) => onPick(known.current.get(e.target.value))} required>
        <option value="">{loading ? "Searching…" : options.length ? "Select product…" : "No matching products"}</option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {[p.name, p.size].filter(Boolean).join(" · ")} ({p.stock} in stock)
          </option>
        ))}
      </Select>
    </>
  )
}

export function EntryForm({
  type,
  parties,
  masters,
  initial,
  onClose,
  onSubmit,
}: {
  type: string
  parties: Party[]
  masters: Masters
  initial?: Party | Product
  onClose: () => void
  onSubmit: (data: Record<string, string>) => void
}) {
  const { isEnabled } = useConfig()
  const accounts = masters.accounts.filter((a) => a.active)
  const [error, setError] = useState("")
  const [selected, setSelected] = useState(initial?.id || "")
  const [amount, setAmount] = useState("")
  const [method, setMethod] = useState(masters.paymentMethods[0] ?? "Cash")
  const [quantity, setQuantity] = useState("")
  const [confirm, setConfirm] = useState(false)
  const [photo, setPhoto] = useState<PhotoChoice>({ kind: "keep" })
  const [multi, setMulti] = useState(false)
  const [lengthRows, setLengthRows] = useState<{ length: string; qty: string }[]>([{ length: "", qty: "" }])
  const [colours, setColours] = useState<{ name: string; qty: string }[]>([{ name: "", qty: "" }, { name: "", qty: "" }])
  const party = parties.find((p) => p.id === selected)
  const [product, setProduct] = useState<Product | undefined>(type === "adjust" && initial && "stock" in initial ? (initial as Product) : undefined)
  const editing = !!initial?.id && (type === "party" || type === "product")
  const prod = (editing && type === "product" ? initial : undefined) as Product | undefined
  // cloth is bought and sold by the meter; an older product that only has a size text keeps working per than
  const byMeter = isEnabled("than") && type === "product" && (!editing || prod?.length != null || !prod?.size)
  const [colour, setColour] = useState(prod?.color ?? "")
  const pty = (editing && type === "party" ? initial : undefined) as Party | undefined
  const financial = type === "recovery" || type === "supplier-payment"
  const defaultAccount = (kind: string) => (kind === "Cash" ? accounts.find((a) => a.type === "cash") : accounts.find((a) => a.type === "bank") ?? accounts[0])?.name
  const accountOptions = accounts.map((a) => (
    <option key={a.name} value={a.name}>
      {a.name}
    </option>
  ))
  const [submitting, setSubmitting] = useState(false)
  const submittingNow = useRef(false)
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
    if (financial) {
      if (!party) return setError("Please select a party.")
      if (+amount <= 0 || +amount > Math.max(party.balance, 0)) return setError("The amount must be greater than zero and no more than the outstanding balance.")
    }
    if ((type === "expense" || type === "transfer") && +data.amount <= 0) return setError("Enter an amount greater than zero.")
    if (type === "transfer" && data.from === data.to) return setError("Choose two different accounts.")
    if (type === "adjust") {
      if (!product) return setError("Select a product.")
      if (!Number.isInteger(+quantity) || !+quantity || product.stock + +quantity < 0) return setError("Enter a whole number adjustment that does not make stock negative.")
      if (!confirm) {
        setConfirm(true)
        return
      }
    }
    if ((type === "party" || type === "product" || type === "account") && !(data.name ?? data.article ?? "x").trim()) return setError("Enter a name.")
    if (type === "product" && multi && !editing) {
      const rows = colours.filter((c) => c.name.trim() || c.qty.trim())
      if (!rows.length) return setError("Add at least one colour.")
      if (rows.some((c) => !c.name.trim())) return setError("Every row needs a colour name.")
      if (rows.some((c) => c.qty.trim() && (!/^\d+$/.test(c.qty.trim())))) return setError("Opening stock must be a whole number (or left empty).")
      const lower = rows.map((c) => c.name.trim().toLowerCase())
      if (new Set(lower).size !== lower.length) return setError("A colour is listed twice.")
      data.multi = "1"
      data.colours = JSON.stringify(rows.map((c) => ({ color: c.name.trim(), openingQty: c.qty.trim() ? Number(c.qty) : undefined })))
    }
    if (type === "product" && !multi) {
      if (photo.kind === "new") {
        data.photoThumb = photo.thumb
        data.photoFull = photo.full
      } else if (photo.kind === "remove") data.photoRemove = "1"
    }
    if (submittingNow.current) return // a double click or a repeated Enter must not save twice
    submittingNow.current = true
    setSubmitting(true)
    void Promise.resolve(onSubmit(data)).finally(() => {
      submittingNow.current = false
      setSubmitting(false)
    })
  }
  const dateField = type !== "party" && type !== "user" && type !== "product" && type !== "account"
  return (
    <form onSubmit={submit}>
      <div className="modal-body">
        {financial && (
          <>
            <Field label={type === "recovery" ? "Customer / party" : "Supplier"} required>
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
                    {p.city && parties.filter((q) => q.name.toLowerCase() === p.name.toLowerCase()).length > 1 ? ` — ${p.city}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            {party && (
              <div className="form-balance">
                <span>{type === "recovery" ? "Current outstanding" : "Current payable"}</span>
                <strong>{money(party.balance)}</strong>
                <small>{[party.city, party.phone].filter(Boolean).join(" · ")}</small>
              </div>
            )}
            <Field label="Amount" required>
              <div className="large-amount-input">
                <span>Rs.</span>
                <Input name="amount" type="number" min="0.01" step="0.01" max={party ? Math.max(party.balance, 0) : undefined} required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
              </div>
            </Field>
            <div className="form-grid">
              <Field label="Payment method">
                <Select name="method" value={method} onChange={(e) => setMethod(e.target.value)}>
                  {masters.paymentMethods.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Payment account">
                <Select name="account" key={method} defaultValue={defaultAccount(method)}>
                  {accountOptions}
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
                {masters.expenseCategories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label="Amount" required>
              <Input name="amount" type="number" min="0.01" step="0.01" required placeholder="Enter amount in Rs." />
            </Field>
            <Field label="Pay from account">
              <Select name="account">{accountOptions}</Select>
            </Field>
          </>
        )}
        {type === "transfer" && (
          <>
            <div className="info-notice">
              <ArrowRight size={17} />
              Transfers move money between accounts. They are not income or expenses.
            </div>
            <Field label="From account">
              <Select name="from">{accountOptions}</Select>
            </Field>
            <Field label="To account">
              <Select name="to" defaultValue={accounts[1]?.name ?? accounts[0]?.name}>
                {accountOptions}
              </Select>
            </Field>
            <Field label="Amount" required>
              <Input name="amount" type="number" min="0.01" step="0.01" required />
            </Field>
          </>
        )}
        {type === "adjust" && (
          <>
            <Field label="Product" required>
              <ProductPicker
                value={selected}
                initial={product}
                onPick={(p) => {
                  setSelected(p?.id ?? "")
                  setProduct(p)
                }}
              />
            </Field>
            {product && (
              <div className="form-balance">
                <span>Current stock</span>
                <strong>
                  {product.stock} {L.units}
                </strong>
                <small>{product.id}</small>
              </div>
            )}
            <Field label="Adjustment quantity" required hint="Use a negative number to reduce stock, e.g. −2.">
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
                <option>Damaged stock</option>
                <option>Lost or missing</option>
                <option>Other correction</option>
              </Select>
            </Field>
            {confirm && (
              <div className="confirm-notice">
                <strong>Confirm stock adjustment?</strong>
                <p>
                  Stock will change from {product?.stock} to {(product?.stock || 0) + +quantity} {L.units}. This is recorded in the stock movement log with your name.
                </p>
              </div>
            )}
          </>
        )}
        {type === "party" && (
          <>
            <Field label="Party name" required>
              <Input name="name" required defaultValue={pty?.name} placeholder="Business or party name" />
            </Field>
            <div className="form-grid">
              <Field label="City" required={isEnabled("cityWise")}>
                <Input name="city" list="city-list" required={isEnabled("cityWise")} defaultValue={pty?.city} />
                <datalist id="city-list">
                  {masters.cities.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </Field>
              <Field label="Area">
                <Input name="area" defaultValue={pty?.area} />
              </Field>
            </div>
            <div className="form-grid">
              <Field label="Phone">
                <Input name="phone" type="tel" defaultValue={pty?.phone} />
              </Field>
              <Field label="WhatsApp">
                <Input name="whatsapp" type="tel" defaultValue={pty?.whatsapp} />
              </Field>
            </div>
            <Field label="Address">
              <Input name="address" defaultValue={pty?.address} />
            </Field>
            <div className="form-grid">
              <Field label="Credit limit (Rs.)" hint="0 means no limit is set.">
                <Input name="limit" type="number" min="0" step="0.01" defaultValue={pty ? pty.limit : 0} />
              </Field>
              <Field label="Payment terms (days)">
                <Input name="terms" type="number" min="0" defaultValue={pty?.terms ?? ""} placeholder="e.g. 30" />
              </Field>
            </div>
            {!editing && (
              <Field label="Opening balance (Rs.)" hint="What this party already owes you (or you owe a supplier) before you start using the program.">
                <Input name="opening" type="number" step="0.01" placeholder="0" />
              </Field>
            )}
            {editing && (
              <Field label="Status">
                <Select name="active" defaultValue={pty?.status === "Inactive" ? "Inactive" : "Active"}>
                  <option>Active</option>
                  <option>Inactive</option>
                </Select>
              </Field>
            )}
            <Field label="Notes">
              <Textarea name="notes" rows={2} defaultValue={pty?.notes} />
            </Field>
          </>
        )}
        {type === "product" && (
          <>
            {!multi && <PhotoField product={prod} value={photo} onChange={setPhoto} />}
            <div className="form-grid">
              <Field label={isEnabled("than") ? "Company / brand" : "Brand"} required>
                <Input name="company" list="company-list" required defaultValue={prod?.company} />
                <datalist id="company-list">
                  {masters.companies.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </Field>
              <Field label={isEnabled("than") ? "Article" : "Item"} required hint={isEnabled("than") ? "e.g. Article A" : "e.g. Shampoo"}>
                <Input name="article" required defaultValue={prod?.article} />
              </Field>
            </div>
            {!editing && (
              <Button type="button" variant="ghost" className="multi-toggle" onClick={() => setMulti(!multi)} aria-pressed={multi}>
                {multi ? "← Add a single colour instead" : "+ Add several colours at once"}
              </Button>
            )}
            {multi && !editing && <ColourRows rows={colours} onChange={setColours} label={isEnabled("than") ? "Colours" : "Variants"} />}
            <div className="form-grid">
              {!(multi && !editing) && (
                <Field label={isEnabled("than") ? "Colour" : "Variant (colour / type)"}>
                  <ColourPicker name="color" value={colour} onChange={setColour} label={isEnabled("than") ? "Colour" : "Variant (colour / type)"} />
                </Field>
              )}
              {byMeter && !editing && !multi ? (
                <div className="length-rows">
                  <span className="field-label">Than lengths and thans in stock</span>
                  <input type="hidden" name="lengths" value={JSON.stringify(lengthRows)} />
                  {lengthRows.map((row, i) => (
                    <div className="length-row" key={i}>
                      <Input aria-label={`Length ${i + 1} (meters)`} type="number" min="0.1" step="0.1" placeholder="Length (m), e.g. 28" value={row.length} onChange={(e) => setLengthRows((rs) => rs.map((r, j) => (j === i ? { ...r, length: e.target.value } : r)))} />
                      <Input aria-label={`Thans of length ${i + 1}`} type="number" min="0" step="1" placeholder="Thans in stock" value={row.qty} onChange={(e) => setLengthRows((rs) => rs.map((r, j) => (j === i ? { ...r, qty: e.target.value } : r)))} />
                      {lengthRows.length > 1 && (
                        <Action className="row-action delete-action" aria-label={`Remove length ${i + 1}`} onClick={() => setLengthRows((rs) => rs.filter((_, j) => j !== i))}>
                          <Trash2 size={15} />
                        </Action>
                      )}
                    </div>
                  ))}
                  <Button type="button" onClick={() => setLengthRows((rs) => [...rs, { length: "", qty: "" }])}>
                    <Plus size={14} />
                    Add another length
                  </Button>
                  <small className="muted">Optional. One decimal is allowed (44.5). More lengths can also be added later when you buy.</small>
                </div>
              ) : byMeter ? (
                <Field label="Than length (meters)" hint={editing ? "To add another length, buy it in a purchase." : "Optional. One decimal, e.g. 44.5. You can add more lengths when you buy."}>
                  <Input name="length" type="number" min="0.1" step="0.1" placeholder="e.g. 40" defaultValue={prod?.length ?? ""} readOnly={editing && prod?.length != null} />
                </Field>
              ) : (
                <Field label={L.size} hint={isEnabled("than") ? "Type it, e.g. 40 meter" : "e.g. 180 ml"}>
                  <Input name="size" list="size-list" defaultValue={prod?.size} />
                  <datalist id="size-list">
                    {masters.thanSizes.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </Field>
              )}
            </div>
            <div className="form-grid">
              {isEnabled("profit") ? (
                <Field label={byMeter ? "Purchase price per meter (Rs.)" : "Purchase price (Rs.)"} required>
                  <Input name="cost" type="number" min="0" step="0.01" required defaultValue={prod?.purchasePrice} />
                </Field>
              ) : (
                <input type="hidden" name="cost" value={prod?.purchasePrice ?? 0} />
              )}
              <Field label={byMeter ? "Sale price per meter (Rs.)" : "Sale price (Rs.)"} hint="Optional. You can type the rate on every bill.">
                <Input name="rate" type="number" min="0" step="0.01" defaultValue={prod?.rate} />
              </Field>
            </div>
            <div className="form-grid">
              {!editing && !multi && !byMeter && (
                <Field label={`Opening stock (${L.units})`} hint="Stock you already have before using the program. Valued at the purchase price.">
                  <Input name="openingQty" type="number" min="0" step="1" placeholder="0" />
                </Field>
              )}
              {(isEnabled("barcode") || !!prod?.barcode) && !multi && (
                <Field label="Barcode" hint="Optional. Leave empty if this item has none.">
                  <Input name="barcode" defaultValue={prod?.barcode} />
                </Field>
              )}
            </div>
            <details className="more-details" open={editing && !!(prod?.category || prod?.sku || prod?.design || prod?.minStock || prod?.wholesale)}>
              <summary>More details (category, minimum stock{isEnabled("wholesalePrice") ? ", wholesale price" : ""}, SKU)</summary>
              <div className="form-grid">
                <Field label="Category (optional)">
                  <Input name="category" list="category-list" defaultValue={prod?.category} />
                  <datalist id="category-list">
                    {masters.categories.map((c) => (
                      <option key={c.name} value={c.name} />
                    ))}
                  </datalist>
                </Field>
                <Field label="Subcategory (optional)">
                  <Input name="subcategory" />
                </Field>
              </div>
              {isEnabled("than") && (
                <Field label="Design">
                  <Input name="design" defaultValue={prod?.design} />
                </Field>
              )}
              <div className="form-grid">
                {isEnabled("wholesalePrice") && (
                  <Field label="Wholesale price (Rs.)">
                    <Input name="wholesale" type="number" min="0" step="0.01" defaultValue={prod?.wholesale} />
                  </Field>
                )}
                <Field label="Minimum stock" hint="You will be warned when stock falls to this level.">
                  <Input name="minStock" type="number" min="0" step="1" defaultValue={prod?.minStock ?? 0} />
                </Field>
              </div>
              <Field label="SKU / code">
                <Input name="sku" defaultValue={prod?.sku} />
              </Field>
            </details>
            {editing && (
              <Field label="Status">
                <Select name="active" defaultValue={prod?.active ? "Active" : "Inactive"}>
                  <option>Active</option>
                  <option>Inactive</option>
                </Select>
              </Field>
            )}
          </>
        )}
        {type === "account" && (
          <>
            <Field label="Account name" required>
              <Input name="name" required placeholder="e.g. Meezan Bank" />
            </Field>
            <Field label="Type">
              <Select name="type">
                <option>Cash</option>
                <option>Bank</option>
              </Select>
            </Field>
            <Field label="Opening balance (Rs.)" hint="Money already in this account.">
              <Input name="opening" type="number" step="0.01" placeholder="0" />
            </Field>
          </>
        )}
        {type === "user" && (
          <>
            <Field label="Full name" required>
              <Input name="name" required />
            </Field>
            <Field label="Username" required>
              <Input name="username" required autoComplete="off" />
            </Field>
            <Field label="Role">
              <Select name="role">
                {masters.roles
                  .filter((r) => r.name !== "Owner / Admin")
                  .map((r) => (
                    <option key={r.name}>{r.name}</option>
                  ))}
              </Select>
            </Field>
            <Field label="Initial password" required hint="At least 6 characters.">
              <Input name="password" type="password" minLength={6} required autoComplete="new-password" />
            </Field>
          </>
        )}
        {dateField && (
          <Field label="Date">
            <Input name="date" type="date" defaultValue={today} max={today} required />
          </Field>
        )}
        {type !== "user" && type !== "product" && type !== "account" && type !== "party" && (
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
        <Button type="submit" variant="primary" disabled={submitting}>
          <Check size={16} />
          {type === "recovery"
            ? "Save & view receipt"
            : type === "adjust" && confirm
              ? "Confirm adjustment"
              : type === "adjust"
                ? "Review adjustment"
                : type === "party"
                  ? editing
                    ? "Save changes"
                    : "Add party"
                  : type === "product"
                    ? editing
                      ? "Save changes"
                      : multi
                        ? "Add colours"
                        : "Add product"
                    : type === "account"
                      ? "Add account"
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
  onAction,
}: {
  party: Party
  supplier?: boolean
  onAction: (action: string) => void
}) {
  const [tab, setTab] = useState("Ledger / Khata")
  const [start, setStart] = useState("")
  const [end, setEnd] = useState(today)
  const [view, setView] = useState<LedgerView>({ rows: [], aging: [0, 0, 0, 0] })
  useEffect(() => {
    let alive = true
    void api("ledger:get", { kind: supplier ? "supplier" : "customer", id: party.id }).then((v) => alive && setView(v)).catch(() => null)
    return () => {
      alive = false
    }
  }, [party.id, party.balance, supplier])
  const withBalance = view.rows
    .map((r) => ({ ...r, id: r.ref || String(r.id) }))
    .filter((r) => (!start || r.date >= start) && (!end || r.date <= end))
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
            {[party.id, party.city, party.phone].filter(Boolean).join(" · ")}
          </p>
          <span className="muted">
            Payment terms: {party.terms ? `${party.terms} days` : "not set"}
            {!supplier && <> · Credit limit: {party.limit ? money(party.limit) : "none"}</>}
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
        <Button onClick={() => onAction("edit")}>
          <Pencil size={15} />
          Edit details
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
            {["0–30 days", "31–60 days", "61–90 days", "90+ days"].map((a, i) => (
              <div key={a}>
                <span>{a}</span>
                <strong className={i > 0 && view.aging[i] ? "red-text" : ""}>{money(view.aging[i] ?? 0)}</strong>
              </div>
            ))}
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
  purchase = false,
  canVoid = false,
  onVoid,
  onRenumber,
  defaultLayout = "A4 invoice",
  thermalWidth = "80",
}: {
  transaction?: Transaction
  collection?: Collection
  onClose: () => void
  purchase?: boolean
  canVoid?: boolean
  onVoid?: (reason: string) => void | Promise<void>
  /** Change the bill number (the number from the bill book). Resolves true when it was changed. */
  onRenumber?: (invoiceNo: string) => Promise<boolean>
  /** From Settings > Printing. The user can still switch on the preview. */
  defaultLayout?: string
  thermalWidth?: string
}) {
  const [voiding, setVoiding] = useState(false)
  const [voidBusy, setVoidBusy] = useState(false)
  const voidNow = useRef(false)
  const [reason, setReason] = useState("")
  const [renumbering, setRenumbering] = useState(false)
  const [newNo, setNewNo] = useState("")
  const [copied, setCopied] = useState<"" | "ok" | "fail">("")
  const [copying, setCopying] = useState(false)
  const [layout, setLayout] = useState(defaultLayout === "Thermal receipt" ? "Thermal receipt" : "A4 invoice")
  const { business } = useBusiness()
  const receipt = !!collection
  // A thermal roll has no fixed length: the page is exactly as tall as the receipt, so no paper is wasted.
  const paperRef = useRef<HTMLDivElement>(null)
  const [rollMm, setRollMm] = useState(0)
  const thermal = layout === "Thermal receipt"
  const doc = transaction ?? collection
  const rows = billRows(transaction?.lines ?? [])
  const meterBill = rows.some((r) => r.parts.length > 0)
  const before = doc?.balanceBefore ?? 0
  const after = doc?.balanceAfter ?? 0
  const hasBalance = !transaction?.walkIn && doc?.balanceBefore !== undefined && doc?.balanceAfter !== undefined
  const round2 = (n: number) => Math.round(n * 100) / 100
  /** A negative balance means the party has paid in advance: say so instead of printing a minus sign. */
  const balText = (n: number) => (n < 0 ? `${money(-n)} advance` : money(n))
  /** Copies the bill as a picture; the user pastes it into a WhatsApp chat. */
  async function copyForWhatsApp() {
    const el = paperRef.current
    if (!el || copying) return
    setCopying(true)
    try {
      await copyPng(await billToPng(el))
      setCopied("ok")
    } catch {
      setCopied("fail")
    } finally {
      setCopying(false)
      window.setTimeout(() => setCopied(""), 3500)
    }
  }
  useEffect(() => {
    const el = paperRef.current
    if (!thermal || !el) return
    const measure = () => setRollMm(Math.ceil((el.getBoundingClientRect().height * 25.4) / 96) + 10)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [thermal, transaction, collection])
  return (
    <>
      <div className="invoice-toolbar">
        <span>
          <Badge tone="green">Saved</Badge>{" "}
          {receipt ? "Payment receipt" : "Invoice preview"}
        </span>
        {transaction?.status === "void" && <Badge tone="red">Cancelled</Badge>}
        {canVoid && onVoid && transaction && transaction.status !== "void" && !voiding && (
          <Button variant="ghost" onClick={() => setVoiding(true)}>
            Cancel invoice
          </Button>
        )}
        {onRenumber && doc && !voiding && !renumbering && (
          <Button variant="ghost" onClick={() => (setNewNo(doc.id), setRenumbering(true))}>
            {receipt ? "Change number" : "Change bill number"}
          </Button>
        )}
        <Select
          aria-label="Print layout"
          value={layout}
          onChange={(e) => setLayout(e.target.value)}
        >
          <option>A4 invoice</option>
          <option>Thermal receipt</option>
        </Select>
      </div>
      {renumbering && doc && onRenumber && (
        <div className="confirm-notice">
          <strong>Change number {doc.id}</strong>
          <p>Type the number written on the paper slip or bill. It must not be used by another one.</p>
          <Field label="New number" required>
            <Input aria-label="New bill number" value={newNo} onChange={(e) => setNewNo(e.target.value)} maxLength={30} />
          </Field>
          <div className="modal-footer">
            <Button onClick={() => setRenumbering(false)}>Keep {doc.id}</Button>
            <Button variant="primary" disabled={!newNo.trim() || newNo.trim() === doc.id} onClick={async () => {
                if (await onRenumber(newNo.trim())) setRenumbering(false)
              }}
            >
              Save number
            </Button>
          </div>
        </div>
      )}
      {voiding && transaction && onVoid && (
        <div className="confirm-notice">
          <strong>Cancel {transaction.id}?</strong>
          <p>The invoice is kept and marked cancelled. Stock, the party balance and any money received are reversed. This cannot be undone.</p>
          <Field label="Reason" required>
            <Input aria-label="Reason for cancelling" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Entered by mistake" />
          </Field>
          <div className="modal-footer">
            <Button onClick={() => setVoiding(false)}>Keep invoice</Button>
            <Button
              variant="primary"
              disabled={!reason.trim() || voidBusy}
              onClick={() => {
                if (voidNow.current) return
                voidNow.current = true
                setVoidBusy(true)
                void Promise.resolve(onVoid(reason.trim())).finally(() => {
                  voidNow.current = false
                  setVoidBusy(false)
                })
              }}
            >
              Cancel invoice
            </Button>
          </div>
        </div>
      )}
      {/* The roll size only applies while printing; A4 keeps the default page. */}
      {layout === "Thermal receipt" && <style>{`@page { size: ${thermalWidth === "58" ? "58mm" : "80mm"} ${rollMm || 200}mm; margin: 3mm 5mm; }`}</style>}
      <div
        ref={paperRef}
        className={`invoice-paper ${
          layout === "Thermal receipt" ? `thermal ${thermalWidth === "58" ? "w58" : "w80"}` : ""
        }`}
      >
        <div className="invoice-head">
          <div className="invoice-company">
            <BrandMark logo={business.logo} />
            <div className="invoice-company-text">
              <Heading level={2}>{business.name}</Heading>
              {business.tagline && <p className="invoice-tagline">{business.tagline}</p>}
              <p className="invoice-address">
                {[business.address, business.city && !business.address.toLowerCase().includes(business.city.toLowerCase()) ? business.city : ""].filter(Boolean).join(", ")}
                {business.phone && (
                  <>
                    <br />
                    Phone: {business.phone}
                  </>
                )}
                {business.email && (
                  <>
                    <br />
                    {business.email}
                  </>
                )}
              </p>
            </div>
          </div>
          <div className="invoice-doc">
            <Heading level={3}>{receipt ? "PAYMENT RECEIPT" : purchase ? "PURCHASE INVOICE" : "SALES INVOICE"}</Heading>
            <strong className="invoice-no">{transaction?.id || collection?.id}</strong>
            <span className="invoice-date">
              {transaction?.date || collection?.date}
              {(transaction?.time || collection?.time) && ` · ${transaction?.time || collection?.time}`}
            </span>
          </div>
        </div>
        {transaction?.status === "void" && <div className="invoice-void">CANCELLED — this invoice is void</div>}
        <div className="invoice-meta">
          <div>
            <span>{receipt ? (collection?.supplier ? "Paid to" : "Received from") : purchase ? "Supplier" : "Bill to"}</span>
            <strong>{transaction?.party || collection?.party}</strong>
          </div>
          <div className="invoice-meta-right">
            <span>Prepared by</span>
            <strong>{transaction?.user || collection?.user || "—"}</strong>
          </div>
        </div>
        {receipt ? (
          <div className="receipt-amount">
            <span>{collection!.supplier ? "Amount paid" : "Amount received"}</span>
            <strong>{money(collection!.amount)}</strong>
            <p>
              {collection!.method} · {collection!.account}
            </p>
          </div>
        ) : thermal ? (
          <div className="receipt-lines">
            {rows.map((l, i) => (
              <div className="rl" key={`${l.name}-${i}`}>
                <strong className="rl-name">{l.name}</strong>
                {l.parts.length === 0 && (l.size || (l.color && !l.name.endsWith(l.color))) && <span className="rl-sub">{[l.size, l.color && !l.name.endsWith(l.color) ? l.color : ""].filter(Boolean).join(" · ")}</span>}
                {l.parts.length > 0 && (
                  <span className="rl-sub">
                    {breakdown(l.parts)} = {fmtM(l.meters)} m
                  </span>
                )}
                <div className="rl-calc">
                  <span>
                    {l.parts.length > 0 ? `${l.qty} thans @ ${money(l.rateM)}/m` : `${l.qty} × ${money(l.rate)}`}
                    {l.discount > 0 && ` − ${money(l.discount)}`}
                  </span>
                  <strong>{money(l.amount)}</strong>
                </div>
              </div>
            ))}
          </div>
        ) : (
          meterBill ? (
            <DataTable
              plainHeader
              rows={rows.map((r, i) => ({ ...r, sr: i + 1 }))}
              columns={[
                { key: "sr", label: "Sr" },
                {
                  key: "name",
                  label: "Item name",
                  render: (r) => (
                    <div className="cell-two">
                      <strong>{r.name}</strong>
                    </div>
                  ),
                },
                { key: "qty", label: "Thans", right: true },
                { key: "parts", label: "Breakdown", render: (r) => (r.parts.length ? breakdown(r.parts) : "—") },
                { key: "meters", label: "Total meters", right: true, render: (r) => (r.parts.length ? fmtM(r.meters) : "—") },
                { key: "rateM", label: "Rate (per meter)", right: true, render: (r) => (r.parts.length ? money(r.rateM) : money(r.rate)) },
                ...(rows.some((r) => r.discount > 0) ? [{ key: "discount", label: "Disc.", right: true, render: (r: (typeof rows)[number]) => money(r.discount) }] : []),
                { key: "amount", label: "Total amount", right: true, render: (r) => money(r.amount) },
              ]}
            />
          ) : (
            <DataTable
            plainHeader
            rows={transaction?.lines ?? []}
            columns={[
              {
                key: "name",
                label: "Description",
                render: (r) => (
                  <div className="cell-two">
                    <strong>{r.name}</strong>
                    {r.color && !r.name.endsWith(r.color) && <span>{r.color}</span>}
                    {r.length ? <span className="invoice-meters">Total {fmtM(metersOf(r))} meters</span> : null}
                  </div>
                ),
              },
              { key: "size", label: L.size, render: (r) => (r.length ? `${fmtM(r.length)} m` : r.size || "—") },
              { key: "qty", label: "Qty", right: true, render: (r) => (r.length ? `${r.qty} × ${fmtM(r.length)}` : r.qty) },
              {
                key: "rate",
                label: "Rate",
                right: true,
                render: (r) => (r.length ? `${money(r.rateM ?? 0)} / m` : money(r.rate)),
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
          )
        )}
        {!receipt && (
          <div className="invoice-totals">
            {(transaction?.invoiceDiscount ?? 0) > 0 && (
              <>
                <div>
                  <span>Subtotal</span>
                  <span>{money((transaction?.total || 0) + (transaction?.invoiceDiscount || 0))}</span>
                </div>
                <div>
                  <span>Invoice discount</span>
                  <span>− {money(transaction?.invoiceDiscount || 0)}</span>
                </div>
              </>
            )}
            <div className="grand">
              <span>Bill total</span>
              <strong>{money(transaction?.total || 0)}</strong>
            </div>
            {hasBalance ? (
              <div className="account-summary" aria-label="Account summary">
                <div>
                  <span>Previous balance</span>
                  <span>{balText(before)}</span>
                </div>
                <div>
                  <span>This bill</span>
                  <span>+ {money(transaction?.total || 0)}</span>
                </div>
                <div className="sum-line">
                  <span>Total payable</span>
                  <strong>{balText(round2(before + (transaction?.total || 0)))}</strong>
                </div>
                <div>
                  <span>Paid{transaction?.method && transaction.paid > 0 && !["Partial", "Credit"].includes(transaction.method) ? ` · ${transaction.method}` : ""}</span>
                  <span>− {money(transaction?.paid || 0)}</span>
                </div>
                <div className="grand">
                  <span>Remaining balance</span>
                  <strong>{balText(after)}</strong>
                </div>
              </div>
            ) : (
              <>
                <div>
                  <span>Paid · {transaction?.method}</span>
                  <span>{money(transaction?.paid || 0)}</span>
                </div>
                <div>
                  <span>Remaining balance</span>
                  <strong>{money((transaction?.total || 0) - (transaction?.paid || 0))}</strong>
                </div>
              </>
            )}
          </div>
        )}
        {receipt && hasBalance && (
          <div className="invoice-totals">
            <div className="account-summary" aria-label="Account summary">
              <div>
                <span>Previous balance</span>
                <span>{balText(before)}</span>
              </div>
              <div>
                <span>Received now</span>
                <span>− {money(collection!.amount)}</span>
              </div>
              <div className="grand">
                <span>Remaining balance</span>
                <strong>{balText(after)}</strong>
              </div>
            </div>
          </div>
        )}
        <div className="invoice-note">
          {collection?.notes || "Please keep this document for your records."}
          <br />
          {business.invoiceFooter || "Thank you for your business."}
        </div>
        <div className="invoice-signature">
          <span>{receipt ? "Received by" : "Customer signature"}</span>
          <span>Authorized signature</span>
        </div>
      </div>
      <div className="modal-footer">
        <Button onClick={onClose}>Close</Button>
        <Button onClick={() => void copyForWhatsApp()} disabled={copying} aria-live="polite">
          {copied === "ok" ? <Check size={15} /> : <Copy size={15} />}
          {copying ? "Preparing…" : copied === "ok" ? "Bill image copied - paste in WhatsApp" : copied === "fail" ? "Could not copy the image" : "Copy bill image for WhatsApp"}
        </Button>
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

/** Rows of "colour name + opening stock" for adding one article in many colours at once. Pasting "Blue, Black, Maroon" makes three rows. */
function ColourRows({ rows, onChange, label }: { rows: { name: string; qty: string }[]; onChange: (r: { name: string; qty: string }[]) => void; label: string }) {
  function setName(i: number, value: string) {
    if (/[,\n;]/.test(value)) {
      const parts = value.split(/[,\n;]+/).map((p) => p.trim()).filter(Boolean)
      if (parts.length) {
        const next = [...rows]
        next.splice(i, 1, ...parts.map((name, k) => ({ name, qty: k === 0 ? rows[i]!.qty : "" })))
        // pasting a list replaces the untouched empty rows instead of leaving them behind
        return onChange(next.filter((r, k) => r.name.trim() || r.qty.trim() || k < i))
      }
    }
    onChange(rows.map((r, k) => (k === i ? { ...r, name: value } : r)))
  }
  return (
    <div className="colour-rows">
      <strong>{label}</strong>
      <span className="muted">One row per colour. Opening stock is optional. You can also paste a list like Blue, Black, Maroon.</span>
      <ColourChipsMulti
        names={rows.map((r) => r.name)}
        onToggle={(colour, on) => {
          const key = colour.trim().toLowerCase()
          if (!on) return onChange(rows.filter((r) => r.name.trim().toLowerCase() !== key).length ? rows.filter((r) => r.name.trim().toLowerCase() !== key) : [{ name: "", qty: "" }])
          const empty = rows.findIndex((r) => !r.name.trim() && !r.qty.trim())
          onChange(empty >= 0 ? rows.map((r, k) => (k === empty ? { ...r, name: colour } : r)) : [...rows, { name: colour, qty: "" }])
        }}
      />
      {rows.map((r, i) => (
        <div className="colour-row" key={i}>
          <Input aria-label={`Colour ${i + 1}`} value={r.name} placeholder="e.g. Blue" onChange={(e) => setName(i, e.target.value)} />
          <Input aria-label={`Opening stock of colour ${i + 1}`} type="number" min="0" step="1" value={r.qty} placeholder="Stock" onChange={(e) => onChange(rows.map((x, k) => (k === i ? { ...x, qty: e.target.value } : x)))} />
          <Button type="button" variant="ghost" className="icon-button" aria-label={`Remove colour ${i + 1}`} disabled={rows.length <= 1} onClick={() => onChange(rows.filter((_, k) => k !== i))}>
            <Trash2 size={14} />
          </Button>
        </div>
      ))}
      <Button type="button" onClick={() => onChange([...rows, { name: "", qty: "" }])}>
        <Plus size={14} />
        Add another colour
      </Button>
    </div>
  )
}

export function StockDetails({
  product: shown,
  onAdjust,
  onEdit,
}: {
  product: Product
  /** a length of the product can be given: the stock of that length is adjusted */
  onAdjust: (variant?: Product) => void
  onEdit?: () => void
}) {
  // Always show the live figures (they change after an adjustment) and the movement history one page at a time.
  const { isEnabled } = useConfig()
  // a cloth product is one line with a length per variant; the stock and history shown are for the chosen length
  const family = shown.lengths ?? []
  const [chosen, setChosen] = useState(family[0]?.id ?? shown.id)
  const { data: famFresh } = useRemote("products:list", { ids: family.length ? family.map((f) => f.id) : [shown.id], pageSize: 50 })
  const live = famFresh?.rows ?? []
  const lengths = family.length ? live.slice().sort((a, b) => (a.length ?? 0) - (b.length ?? 0)) : []
  const product = (family.length ? live.find((x) => x.id === chosen) : live[0]) ?? (family.find((x) => x.id === chosen) ?? shown)
  const totalThans = lengths.length ? lengths.reduce((s, x) => s + x.stock, 0) : product.stock
  const totalMeters = Math.round(lengths.reduce((s, x) => s + x.stock * (x.length ?? 0), 0) * 10) / 10
  const [movePage, setMovePage] = useState(1)
  const { data: moves, loading: movesLoading } = useRemote("movements:list", { productId: product.id, page: movePage, pageSize: 10 })
  const rows = moves?.rows ?? []
  return (
    <>
      <div className="stock-detail">
        {product.image ? <ProductPhoto product={product} size="f" className="detail-photo" /> : <FabricSwatch name={product.color} large />}
        <div>
          <Heading level={2}>{product.name}</Heading>
          <p>
            {product.company} · {product.article} · {product.color}
          </p>
          <span className="muted">
            {[product.id, product.size].filter(Boolean).join(" · ")}
          </span>
        </div>
        <div className="stock-detail-number">
          <strong>{totalThans}</strong>
          <span>{L.units} available</span>
        </div>
      </div>
      {lengths.length > 0 && (
        <DataTable
          rows={lengths}
          onRow={(x) => (setChosen(x.id), setMovePage(1))}
          empty=""
          columns={[
            { key: "length", label: "Than length", render: (x) => <strong>{x.length != null ? `${fmtM(x.length)} m` : x.size}</strong> },
            { key: "stock", label: "Thans", right: true, render: (x) => <span className={x.id === chosen ? "selected-length" : ""}>{x.stock}</span> },
            { key: "meters", label: "Meters", right: true, render: (x) => `${fmtM(Math.round(x.stock * (x.length ?? 0) * 10) / 10)} m` },
            {
              key: "act",
              label: "",
              right: true,
              render: (x) => (
                <Button type="button" onClick={() => onAdjust(x)}>
                  Adjust
                </Button>
              ),
            },
          ]}
        />
      )}
      {lengths.length > 0 && (
        <p className="muted lengths-note">
          Total {totalThans} {L.units} = {fmtM(totalMeters)} m. Showing the history of {fmtM(product.length ?? 0)} m (click a length to change).
        </p>
      )}
      <div className="stock-price-row">
        {isEnabled("profit") && (
          <div>
            <span>Average cost {L.perUnit}</span>
            <strong>{money(product.cost)}</strong>
          </div>
        )}
        <div>
          <span>Selling price {L.perUnit}</span>
          <strong>{money(product.rate)}</strong>
        </div>
        {isEnabled("profit") && (
          <div>
            <span>Stock value</span>
            <strong>{money(product.stock * product.cost)}</strong>
          </div>
        )}
      </div>
      <div className="panel-heading">
        <div>
          <Heading level={2}>Stock movement</Heading>
          <p>Every stock change, with a clear reference</p>
        </div>
        {onEdit && (
          <Button onClick={onEdit}>
            <Pencil size={15} />
            Edit product
          </Button>
        )}
        <Button onClick={() => onAdjust(product)}>
          <Package size={15} />
          Adjust stock
        </Button>
      </div>
      <DataTable
        rows={rows}
        server={{ total: moves?.total ?? 0, page: movePage, pageSize: 10, onPage: setMovePage, loading: movesLoading }}
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
        Stock is tracked separately for each item and variant.
      </div>
    </>
  )
}
