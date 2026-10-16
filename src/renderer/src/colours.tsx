import { useEffect, useState, useSyncExternalStore } from "react"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { api } from "./backend"
import { Badge, Button, Input } from "./ui"
import { useRemote } from "./remote"
import { colourShade, normaliseColourName } from "@shared/colours"

export interface LibraryColour {
  id: number
  name: string
  hex: string | null
  uses: number
}

/* The library is loaded once for the whole app and shared, so a swatch dot anywhere is cheap and always current. */
let library: LibraryColour[] = []
let byName = new Map<string, LibraryColour>()
const listeners = new Set<() => void>()
function publish(rows: LibraryColour[]) {
  library = rows
  byName = new Map(rows.map((c) => [normaliseColourName(c.name), c]))
  listeners.forEach((l) => l())
}
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l))

/** Mount once near the top of the signed-in app. Keeps the shared colour library fresh after every change. */
export function useColourLibraryLoader(): void {
  const { data } = useRemote("colours:list", undefined)
  useEffect(() => {
    if (data) publish(data)
  }, [data])
}

export const useColourLibrary = (): LibraryColour[] => useSyncExternalStore(subscribe, () => library)

/** The shade shown for a colour name: the library's own shade, else a common-name shade, else none. */
export const shadeOf = (name: string): string | undefined => colourShade(name, byName.get(normaliseColourName(name))?.hex)

/** A small round swatch for a colour name. Colours with no known shade show a neutral striped dot. */
export function ColourDot({ name, size = 14, className = "" }: { name: string; size?: number; className?: string }) {
  useColourLibrary()
  const shade = name ? shadeOf(name) : undefined
  return <span className={`colour-dot ${shade ? "" : "unknown"} ${className}`} style={{ width: size, height: size, ...(shade ? { background: shade } : {}) }} aria-hidden="true" />
}

/** A fabric-sized swatch (used where a product has no photo) coloured from the library. */
export function FabricSwatch({ name, large = false }: { name: string; large?: boolean }) {
  useColourLibrary()
  const shade = name ? shadeOf(name) : undefined
  return <span className={`fabric-swatch ${large ? "large-swatch" : ""}`} style={shade ? { background: shade } : undefined} aria-hidden="true" />
}

/** A text box for one colour with the library's colours as one-click chips below it. A name that is not in the library yet is added when the product is saved. */
export function ColourPicker({ name, value, onChange, label }: { name?: string; value: string; onChange: (v: string) => void; label: string }) {
  const lib = useColourLibrary()
  const q = normaliseColourName(value)
  const shown = lib.filter((c) => !q || normaliseColourName(c.name).includes(q)).slice(0, 14)
  const exact = lib.find((c) => normaliseColourName(c.name) === q)
  return (
    <div className="colour-picker">
      <div className="colour-picker-input">
        {value.trim() && <ColourDot name={exact?.name ?? value} size={18} />}
        <Input name={name} aria-label={label} value={value} autoComplete="off" onChange={(e) => onChange(e.target.value)} />
      </div>
      {lib.length > 0 && (
        <div className="colour-chips" role="group" aria-label="Colours in your library">
          {shown.map((c) => (
            <button type="button" key={c.id} className={`colour-chip ${exact?.id === c.id ? "on" : ""}`} aria-pressed={exact?.id === c.id} onClick={() => onChange(c.name)}>
              <ColourDot name={c.name} />
              {c.name}
            </button>
          ))}
          {shown.length === 0 && <span className="muted">Not in your library yet. It will be added when you save.</span>}
        </div>
      )}
      {value.trim() && !exact && lib.length > 0 && shown.length > 0 && <span className="muted">"{value.trim()}" is new and will be added to your colour library.</span>}
    </div>
  )
}

/** One-click chips for adding many colours at once: click to add a row, click again to take it off. */
export function ColourChipsMulti({ names, onToggle }: { names: string[]; onToggle: (colour: string, on: boolean) => void }) {
  const lib = useColourLibrary()
  const [q, setQ] = useState("")
  if (lib.length === 0) return null
  const have = new Set(names.map(normaliseColourName))
  const shown = lib.filter((c) => !q.trim() || normaliseColourName(c.name).includes(normaliseColourName(q)))
  return (
    <div className="colour-multi">
      <Input aria-label="Search the colour library" placeholder="Search colours…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="colour-chips" role="group" aria-label="Pick colours from your library">
        {shown.map((c) => {
          const on = have.has(normaliseColourName(c.name))
          return (
            <button type="button" key={c.id} className={`colour-chip ${on ? "on" : ""}`} aria-pressed={on} onClick={() => onToggle(c.name, !on)}>
              <ColourDot name={c.name} />
              {c.name}
            </button>
          )
        })}
        {shown.length === 0 && <span className="muted">No colour matches. Type it in a row below and it will be added to the library.</span>}
      </div>
    </div>
  )
}

type Run = <T>(fn: () => Promise<T>) => Promise<T | undefined>

/** Settings → Colours: the one list every product's colour is chosen from. */
export function ColoursEditor({ run, notify, canManage }: { run: Run; notify: (m: string) => void; canManage: boolean }) {
  const lib = useColourLibrary()
  const [name, setName] = useState("")
  const [hex, setHex] = useState("")
  const [editing, setEditing] = useState<LibraryColour | null>(null)
  const [eName, setEName] = useState("")
  const [eHex, setEHex] = useState("")
  const [filter, setFilter] = useState("")
  const shown = lib.filter((c) => !filter.trim() || normaliseColourName(c.name).includes(normaliseColourName(filter)))

  function startEdit(c: LibraryColour) {
    setEditing(c)
    setEName(c.name)
    setEHex(c.hex ?? "")
  }
  return (
    <>
      <p className="muted">
        Write each colour once here, then pick it when you add a product. The same name is then used everywhere, so "Navy Blue" is never typed three different ways. Colours you type on a product are added here automatically.
      </p>
      {canManage && (
        <div className="list-editor-add colour-add">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New colour, e.g. Navy Blue" aria-label="New colour name" />
          <label className="shade-field">
            <span className="muted">Shade</span>
            <input type="color" value={hex || shadeOf(name) || "#cccccc"} onChange={(e) => setHex(e.target.value)} aria-label="Shade of the new colour" />
          </label>
          <Button
            type="button"
            onClick={() => name.trim() && run(() => api("colour:save", { name: name.trim(), hex: hex || null })).then((r) => r !== undefined && (setName(""), setHex(""), notify("Colour added.")))}
          >
            <Plus size={15} />
            Add
          </Button>
        </div>
      )}
      <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search colours…" aria-label="Search colours" />
      {lib.length === 0 && <p className="muted">No colours yet. Add one above, or just type colours when you add products.</p>}
      {shown.map((c) =>
        editing?.id === c.id ? (
          <div className="setting-toggle colour-edit" key={c.id}>
            <Input value={eName} onChange={(e) => setEName(e.target.value)} aria-label="Colour name" />
            <label className="shade-field">
              <input type="color" value={eHex || shadeOf(eName) || "#cccccc"} onChange={(e) => setEHex(e.target.value)} aria-label="Shade" />
            </label>
            <Button type="button" variant="ghost" onClick={() => setEHex("")}>
              Clear shade
            </Button>
            <Button
              type="button"
              onClick={() =>
                run(() => api("colour:save", { id: c.id, name: eName, hex: eHex || null })).then((r) => r !== undefined && (setEditing(null), notify(eName.trim() !== c.name ? `Renamed on ${c.uses} product${c.uses === 1 ? "" : "s"}.` : "Colour saved.")))
              }
            >
              Save
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="setting-toggle" key={c.id}>
            <div className="colour-line">
              <ColourDot name={c.name} size={20} />
              <div>
                <strong>{c.name}</strong>
                <span>{c.uses === 0 ? "Not used yet" : `Used by ${c.uses} product${c.uses === 1 ? "" : "s"}`}</span>
              </div>
              {!c.hex && !colourShade(c.name) && <Badge>No shade</Badge>}
            </div>
            {canManage && (
              <div className="colour-actions">
                <Button type="button" variant="ghost" onClick={() => startEdit(c)} aria-label={`Edit ${c.name}`}>
                  <Pencil size={14} />
                  Edit
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={c.uses > 0}
                  title={c.uses > 0 ? "A colour that products use cannot be removed" : undefined}
                  onClick={() => run(() => api("colour:delete", { id: c.id })).then((r) => r !== undefined && notify("Colour removed."))}
                  aria-label={`Remove ${c.name}`}
                >
                  <Trash2 size={14} />
                  Remove
                </Button>
              </div>
            )}
          </div>
        ),
      )}
    </>
  )
}
