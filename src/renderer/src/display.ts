/** Text size is a choice for this computer (a small monitor and a big one need different sizes), so it is not stored with the shop. */
export type TextSize = "normal" | "large" | "xlarge"
const KEY = "erp.textSize"

export function readTextSize(): TextSize {
  try {
    const v = localStorage.getItem(KEY)
    return v === "large" || v === "xlarge" ? v : "normal"
  } catch {
    return "normal"
  }
}

export function applyTextSize(size: TextSize): void {
  document.documentElement.dataset.text = size
  try {
    localStorage.setItem(KEY, size)
  } catch {
    /* the choice then lasts until the program is closed */
  }
}
