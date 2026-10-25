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

/** Light or dark screen. Also a choice for this computer; printed bills always stay black on white. */
export type Theme = "light" | "dark"
const THEME_KEY = "erp.theme"

export function readTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light"
  } catch {
    return "light"
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    /* the choice then lasts until the program is closed */
  }
}
