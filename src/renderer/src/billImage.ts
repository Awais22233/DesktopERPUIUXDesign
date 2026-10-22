import { toBlob } from "html-to-image"
// Inlined as a data: URL so the picture can use the same font as the screen without any network fetch (the app's content policy forbids it).
import interLatin from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?inline"

const fontCss = `@font-face{font-family:'Inter Variable';font-style:normal;font-weight:100 900;src:url(${interLatin}) format('woff2');}`

/** The bill exactly as it looks on screen, as a sharp PNG (2x), on a white background. */
export async function billToPng(paper: HTMLElement): Promise<Blob> {
  const blob = await toBlob(paper, { pixelRatio: 2, backgroundColor: "#ffffff", fontEmbedCSS: fontCss, style: { margin: "0" } })
  if (!blob) throw new Error("Could not draw the bill")
  return blob
}

/** Puts a PNG on the clipboard so it pastes as a picture into WhatsApp (desktop or web). */
export async function copyPng(blob: Blob): Promise<void> {
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })])
}
