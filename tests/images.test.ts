import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { jpegSize, mirrorImages, readImage, removeProductImage, saveProductImage, sweepImages } from "../src/main/services/images"
import { listProducts } from "../src/main/services/lists"
import { setup } from "./helpers"

/** A structurally valid JPEG header of the given size (enough for the size checks; not a viewable picture). */
function fakeJpeg(w: number, h: number, pad = 0): Buffer {
  const head = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x01, 0x01, 0x11, 0x00])
  return Buffer.concat([head, Buffer.alloc(pad, 1), Buffer.from([0xff, 0xd9])])
}
const b64 = (b: Buffer) => b.toString("base64")
const dir = () => mkdtempSync(join(tmpdir(), "erp-img-"))

describe("product photos", () => {
  it("reads the size of a JPEG and rejects other bytes", () => {
    expect(jpegSize(fakeJpeg(200, 150))).toEqual({ width: 200, height: 150 })
    expect(jpegSize(Buffer.from("not a picture at all"))).toBeNull()
    expect(jpegSize(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull()
  })

  it("saves, shows in the product list, replaces and removes a photo (files follow the database)", async () => {
    const { db, owner, blue } = await setup()
    const d = dir()
    const base = saveProductImage(db, owner, d, blue, b64(fakeJpeg(200, 200)), b64(fakeJpeg(800, 800)))
    expect(readdirSync(d).sort()).toEqual([`${base}-f.jpg`, `${base}-t.jpg`])
    const row = listProducts(db, { ids: [`VAR-${String(blue).padStart(4, "0")}`] }).rows[0]!
    expect(row.image).toBe(base)
    expect(readImage(d, `${base}-t.jpg`)).not.toBeNull()

    const next = saveProductImage(db, owner, d, blue, b64(fakeJpeg(100, 100)), b64(fakeJpeg(600, 600)))
    expect(next).not.toBe(base)
    expect((db.prepare("SELECT image FROM variants WHERE id = ?").get(blue) as { image: string | null }).image).toBe(next)
    // the replaced photo is kept for a while (an older backup of the data may still point at it)
    expect(readdirSync(d).sort()).toEqual([`${base}-f.jpg`, `${base}-t.jpg`, `${next}-f.jpg`, `${next}-t.jpg`].sort())

    removeProductImage(db, owner, d, blue)
    expect((db.prepare("SELECT image FROM variants WHERE id = ?").get(blue) as { image: string | null }).image).toBeNull()
    // photos nobody refers to any more are swept only after 30 days; stale temp files after one day
    writeFileSync(join(d, "9-aaaaaaaa-t.jpg.tmp"), "x")
    expect(sweepImages(db, d, 30)).toBe(0)
    expect(sweepImages(db, d, 30, Date.now() + 31 * 86400_000)).toBe(5)
    expect(readdirSync(d)).toEqual([])
  })

  it("refuses oversized, wrong-format and unauthorised photos and leaves nothing behind", async () => {
    const { db, owner, limited, blue } = await setup()
    const d = dir()
    const ok = b64(fakeJpeg(200, 200))
    expect(() => saveProductImage(db, owner, d, blue, b64(fakeJpeg(900, 900)), ok)).toThrow(/too large/)
    expect(() => saveProductImage(db, owner, d, blue, ok, b64(fakeJpeg(3000, 3000)))).toThrow(/too large/)
    expect(() => saveProductImage(db, owner, d, blue, b64(fakeJpeg(200, 200, 200_000)), ok)).toThrow(/too large/)
    expect(() => saveProductImage(db, owner, d, blue, "<script>alert(1)</script>", ok)).toThrow(/valid photo/)
    expect(() => saveProductImage(db, owner, d, blue, b64(Buffer.from("GIF89a-not-jpeg")), ok)).toThrow(/valid photo/)
    expect(() => saveProductImage(db, limited, d, blue, ok, ok)).toThrow()
    expect(() => saveProductImage(db, owner, d, 99999, ok, ok)).toThrow(/not found/)
    expect(existsSync(d) ? readdirSync(d) : []).toEqual([])
  })

  it("serves only generated file names, never a path", () => {
    const d = dir()
    writeFileSync(join(d, "secret.txt"), "x")
    expect(readImage(d, "../secret.txt")).toBeNull()
    expect(readImage(d, "secret.txt")).toBeNull()
    expect(readImage(d, "1-abcdef01-t.jpg")).toBeNull()
  })

  it("copies only new photos to the backup folder", async () => {
    const { db, owner, blue, black } = await setup()
    const d = dir()
    const target = join(dir(), "images")
    saveProductImage(db, owner, d, blue, b64(fakeJpeg(100, 100)), b64(fakeJpeg(500, 500)))
    expect(mirrorImages(d, target)).toBe(2)
    expect(mirrorImages(d, target)).toBe(0)
    saveProductImage(db, owner, d, black, b64(fakeJpeg(100, 100)), b64(fakeJpeg(500, 500)))
    expect(mirrorImages(d, target)).toBe(2)
  })

  it("repairs a backup copy that was cut short", async () => {
    const { db, owner, blue } = await setup()
    const d = dir()
    const target = join(dir(), "images")
    const base = saveProductImage(db, owner, d, blue, b64(fakeJpeg(100, 100, 500)), b64(fakeJpeg(500, 500, 900)))
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, `${base}-f.jpg`), "torn") // a copy interrupted by a power cut
    expect(mirrorImages(d, target)).toBe(2)
    expect(readFileSync(join(target, `${base}-f.jpg`)).equals(readFileSync(join(d, `${base}-f.jpg`)))).toBe(true)
    expect(readdirSync(target).some((n) => n.endsWith(".tmp"))).toBe(false)
  })
})
