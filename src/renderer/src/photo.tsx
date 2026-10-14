import { useRef, useState } from "react"
import { Camera, Trash2 } from "lucide-react"
import { Button } from "./ui"
import type { Product } from "./data"

/** Photos are served by the app's private `erp-image` scheme; `t` = small thumbnail, `f` = large version. */
export const photoUrl = (p: Pick<Product, "image">, size: "t" | "f" = "t") => (p.image ? `erp-image://img/${p.image}-${size}.jpg` : undefined)

/** A soft, stable colour per product so an item without a photo is still easy to tell apart. */
function hue(name: string): number {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}

export function ProductPhoto({ product, size = "t", className = "" }: { product: Pick<Product, "image" | "name">; size?: "t" | "f"; className?: string }) {
  const url = photoUrl(product, size)
  const [broken, setBroken] = useState(false)
  if (url && !broken) return <img className={`product-photo ${className}`} src={url} alt="" loading="lazy" onError={() => setBroken(true)} />
  const letter = (product.name.trim()[0] ?? "?").toUpperCase()
  return (
    <span className={`product-photo placeholder ${className}`} style={{ background: `hsl(${hue(product.name)} 45% 90%)`, color: `hsl(${hue(product.name)} 40% 32%)` }} aria-hidden="true">
      {letter}
    </span>
  )
}

export interface PickedPhoto {
  thumb: string
  full: string
  preview: string
}

/** Reads the picked file as a data: URL (the installed app's content policy allows data: images but not blob: ones). */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const bad = () => reject(new Error("That file could not be read as a picture. Choose a JPG, PNG or WebP photo."))
    const reader = new FileReader()
    reader.onerror = bad
    reader.onload = () => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = bad
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

function render(img: HTMLImageElement, maxSide: number, quality: number): string {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")!
  ctx.fillStyle = "#fff" // transparent PNGs would turn black as JPEG
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
  return canvas.toDataURL("image/jpeg", quality).replace(/^data:image\/jpeg;base64,/, "")
}

/** Shrinks any picture the user picks to a small thumbnail and one larger copy, so the database folder stays small. */
export async function shrinkPhoto(file: File): Promise<PickedPhoto> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Choose a JPG, PNG or WebP photo.")
  if (file.size > 25_000_000) throw new Error("That photo is too large (over 25 MB). Choose a smaller one.")
  const img = await loadImage(file)
  const thumb = render(img, 240, 0.82)
  return { thumb, full: render(img, 1000, 0.85), preview: `data:image/jpeg;base64,${thumb}` }
}

export type PhotoChoice = { kind: "keep" } | { kind: "remove" } | ({ kind: "new" } & PickedPhoto)

export function PhotoField({ product, value, onChange }: { product?: Product; value: PhotoChoice; onChange: (v: PhotoChoice) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState("")
  const existing = product?.image && value.kind === "keep" ? product : undefined
  const shown = value.kind === "new" ? value.preview : existing ? photoUrl(existing, "f") : undefined
  async function pick(file?: File) {
    if (!file) return
    setError("")
    try {
      onChange({ kind: "new", ...(await shrinkPhoto(file)) })
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <div className="photo-field">
      <div className="photo-box">{shown ? <img src={shown} alt="Product photo" /> : <Camera size={26} aria-hidden="true" />}</div>
      <div className="photo-actions">
        <strong>Product photo</strong>
        <span className="muted">Optional. Helps you pick the right item quickly when selling.</span>
        <div className="photo-buttons">
          <Button type="button" onClick={() => input.current?.click()}>
            <Camera size={14} />
            {shown ? "Change photo" : "Choose photo"}
          </Button>
          {shown && (
            <Button type="button" variant="ghost" onClick={() => onChange({ kind: "remove" })}>
              <Trash2 size={14} />
              Remove
            </Button>
          )}
        </div>
        {error && <span className="red-text" role="alert">{error}</span>}
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden data-testid="photo-input" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = "" }} />
      </div>
    </div>
  )
}
