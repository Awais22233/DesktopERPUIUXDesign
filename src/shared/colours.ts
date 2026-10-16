/** Swatch shades for the colour names cloth shops use most. Used when a library colour has no shade of its own. */
const COMMON: Record<string, string> = {
  black: "#2b2b2e", "jet black": "#111114", white: "#fafafa", "off white": "#efece3", cream: "#f2e8cf", beige: "#cdb99a", ivory: "#f6f1e0",
  grey: "#8a8f98", gray: "#8a8f98", "light grey": "#c3c7cd", charcoal: "#3d4148", silver: "#c0c0c0",
  brown: "#7a5538", "dark brown": "#4b3425", coffee: "#5b3d2b", chocolate: "#4a2c1d", camel: "#b98b53", khaki: "#b5a37a", skin: "#e0b99a",
  navy: "#1f2f55", "navy blue": "#1f2f55", blue: "#2a5bd7", "royal blue": "#2447a8", "sky blue": "#8ec5e8", "light blue": "#a9cbe8", "firozi": "#1fb5b0", ferozi: "#1fb5b0", turquoise: "#2bb7b3", teal: "#1f7a7a",
  red: "#c8202c", maroon: "#6d1a2a", burgundy: "#5e1a2b", wine: "#5c1a30", pink: "#e98fb0", "baby pink": "#f4c6d6", "hot pink": "#e0338b", peach: "#f3b999", rose: "#d36a86", magenta: "#b01a73",
  purple: "#6a3d9a", violet: "#7a4fbf", lilac: "#c8a8e0", mauve: "#a8788f",
  green: "#2e8b4f", "dark green": "#1d5a35", "bottle green": "#14452f", "parrot green": "#4cc34a", pista: "#b8d98a", olive: "#6b7a2e", mehndi: "#7a8a2a", "sea green": "#3a9a7a", mint: "#a8dcc0",
  yellow: "#f2cf2e", mustard: "#c9a21a", golden: "#c9a24a", gold: "#c9a24a", orange: "#ee8a1f", rust: "#a3441f", tea: "#d6a77a", "tea pink": "#e8b4a0", slate: "#6a7787",
}

export const normaliseColourName = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase()

/** The shade to show for a colour name: the library's own shade first, then the common-name shade, else none. */
export function colourShade(name: string, hex?: string | null): string | undefined {
  if (hex) return hex
  const n = normaliseColourName(name)
  return COMMON[n] ?? COMMON[n.split(" ").slice(-1)[0] ?? ""]
}

export const COMMON_COLOUR_NAMES: string[] = [
  "Black", "White", "Off White", "Cream", "Beige", "Grey", "Charcoal", "Brown", "Navy Blue", "Royal Blue", "Sky Blue", "Ferozi", "Red", "Maroon", "Pink", "Peach", "Purple",
  "Bottle Green", "Dark Green", "Parrot Green", "Pista", "Olive", "Mustard", "Yellow", "Golden", "Orange",
]
