// Color math utilities — no external deps, all pure computation

export type RGB = { r: number; g: number; b: number }
export type HSL = { h: number; s: number; l: number }
export type OKLCH = { l: number; c: number; h: number }

// ─── Parsing ────────────────────────────────────────────────────────────────

const CSS_NAMED: Record<string, string> = {
  white: '#ffffff',
  black: '#000000',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  gray: '#808080',
  orange: '#ffa500',
  purple: '#800080',
  pink: '#ffc0cb',
  brown: '#a52a2a',
  lime: '#00ff00',
  navy: '#000080',
  teal: '#008080',
  silver: '#c0c0c0',
  gold: '#ffd700',
  indigo: '#4b0082',
  violet: '#ee82ee',
}

export function parseColor(input: string): RGB {
  const s = input.trim().toLowerCase()

  // named
  const named = CSS_NAMED[s]
  if (named) return parseColor(named)

  // #rgb / #rgba / #rrggbb / #rrggbbaa
  const hexMatch = s.match(/^#([0-9a-f]{3,8})$/)
  if (hexMatch) {
    const h = hexMatch[1]!
    if (h.length === 3 || h.length === 4) {
      return {
        r: parseInt(h[0]! + h[0]!, 16),
        g: parseInt(h[1]! + h[1]!, 16),
        b: parseInt(h[2]! + h[2]!, 16),
      }
    }
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    }
  }

  // rgb(r g b) or rgb(r, g, b)
  const rgbMatch = s.match(/^rgba?\(\s*([0-9.]+)[,\s]+([0-9.]+)[,\s]+([0-9.]+)/)
  if (rgbMatch) {
    return {
      r: Math.round(parseFloat(rgbMatch[1]!)),
      g: Math.round(parseFloat(rgbMatch[2]!)),
      b: Math.round(parseFloat(rgbMatch[3]!)),
    }
  }

  // hsl(h s% l%) or hsl(h, s%, l%)
  const hslMatch = s.match(/^hsla?\(\s*([0-9.]+)[,\s]+([0-9.]+)%[,\s]+([0-9.]+)%/)
  if (hslMatch) {
    return hslToRgb({
      h: parseFloat(hslMatch[1]!),
      s: parseFloat(hslMatch[2]!) / 100,
      l: parseFloat(hslMatch[3]!) / 100,
    })
  }

  // oklch(L C H)
  const oklchMatch = s.match(/^oklch\(\s*([0-9.]+%?)[,\s]+([0-9.]+)[,\s]+([0-9.]+)/)
  if (oklchMatch) {
    const L = parseFloat(oklchMatch[1]!.replace('%', '')) / (oklchMatch[1]!.includes('%') ? 100 : 1)
    return oklchToRgb({ l: L, c: parseFloat(oklchMatch[2]!), h: parseFloat(oklchMatch[3]!) })
  }

  throw new Error(`Cannot parse color: "${input}"`)
}

// ─── Conversions ────────────────────────────────────────────────────────────

export function rgbToHex(c: RGB): string {
  return (
    '#' +
    [c.r, c.g, c.b]
      .map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
      .join('')
  )
}

export function rgbToHsl(c: RGB): HSL {
  const r = c.r / 255
  const g = c.g / 255
  const b = c.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return { h: h * 360, s, l }
}

export function hslToRgb(c: HSL): RGB {
  const { h, s, l } = c
  if (s === 0) {
    const v = Math.round(l * 255)
    return { r: v, g: v, b: v }
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hk = h / 360
  const toRgb = (t: number) => {
    const tt = t < 0 ? t + 1 : t > 1 ? t - 1 : t
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  return {
    r: Math.round(toRgb(hk + 1 / 3) * 255),
    g: Math.round(toRgb(hk) * 255),
    b: Math.round(toRgb(hk - 1 / 3) * 255),
  }
}

// OKLCH uses the OKLab perceptual color space — accurate for UI palettes
export function rgbToOklch(c: RGB): OKLCH {
  // Linear RGB
  const toLinear = (v: number) => {
    const x = v / 255
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
  }
  const r = toLinear(c.r)
  const g = toLinear(c.g)
  const b = toLinear(c.b)
  // RGB → XYZ (D65)
  const x = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
  const y = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
  const z = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
  // XYZ → LMS
  const l0 = Math.cbrt(0.8189330101 * x + 0.3618667424 * y - 0.1288597137 * z)
  const m0 = Math.cbrt(0.0329845436 * x + 0.9293118715 * y + 0.0361456387 * z)
  const s0 = Math.cbrt(0.0482003018 * x + 0.2643662691 * y + 0.6338517070 * z)
  // LMS → OKLab
  const L = 0.2104542553 * l0 + 0.793617785 * m0 - 0.0040720468 * s0
  const a = 1.9779984951 * l0 - 2.428592205 * m0 + 0.4505937099 * s0
  const bv = 0.0259040371 * l0 + 0.7827717662 * m0 - 0.808675766 * s0
  const chroma = Math.sqrt(a * a + bv * bv)
  const hue = (Math.atan2(bv, a) * 180) / Math.PI
  return { l: L, c: chroma, h: hue < 0 ? hue + 360 : hue }
}

export function oklchToRgb(oklch: OKLCH): RGB {
  const { l: L, c, h } = oklch
  const hRad = (h * Math.PI) / 180
  const a = c * Math.cos(hRad)
  const bv = c * Math.sin(hRad)
  const l0 = L + 0.3963377774 * a + 0.2158037573 * bv
  const m0 = L - 0.1055613458 * a - 0.0638541728 * bv
  const s0 = L - 0.0894841775 * a - 1.291485548 * bv
  const l1 = l0 * l0 * l0
  const m1 = m0 * m0 * m0
  const s1 = s0 * s0 * s0
  const xr = +4.0767416621 * l1 - 3.3077115913 * m1 + 0.2309699292 * s1
  const yr = -1.2684380046 * l1 + 2.6097574011 * m1 - 0.3413193965 * s1
  const zr = -0.0041960863 * l1 - 0.7034186147 * m1 + 1.707614701 * s1
  const toSrgb = (x: number) =>
    Math.round(
      Math.min(255, Math.max(0, (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055) * 255)),
    )
  return { r: toSrgb(xr), g: toSrgb(yr), b: toSrgb(zr) }
}

// ─── Palette generation ─────────────────────────────────────────────────────

const SHADE_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const

export type Shade = (typeof SHADE_STEPS)[number]
export type Palette = Record<Shade, string>

export function generatePalette(baseColor: string): Palette {
  const rgb = parseColor(baseColor)
  const oklch = rgbToOklch(rgb)

  // Map shades to lightness values in OKLCH space (perceptually uniform)
  const lightnessMap: Record<Shade, number> = {
    50: 0.97,
    100: 0.94,
    200: 0.88,
    300: 0.80,
    400: 0.70,
    500: 0.59,
    600: 0.50,
    700: 0.42,
    800: 0.35,
    900: 0.27,
    950: 0.22,
  }

  // Find the closest shade for the base color to anchor the hue/chroma
  const baseShade = findNearestShade(oklch.l)

  const palette = {} as Palette
  for (const shade of SHADE_STEPS) {
    const targetL = lightnessMap[shade]
    // Scale chroma: slightly reduce for very light/dark shades
    const chromaScale = targetL > 0.85 ? 0.6 : targetL < 0.3 ? 0.7 : 1.0
    const shadedOklch: OKLCH = {
      l: targetL,
      c: oklch.c * chromaScale,
      h: oklch.h,
    }
    const shadedRgb = oklchToRgb(shadedOklch)
    palette[shade] = rgbToHex(shadedRgb)
  }

  return palette
}

function findNearestShade(lightness: number): Shade {
  const lightnessMap: Record<Shade, number> = {
    50: 0.97, 100: 0.94, 200: 0.88, 300: 0.80, 400: 0.70,
    500: 0.59, 600: 0.50, 700: 0.42, 800: 0.35, 900: 0.27, 950: 0.22,
  }
  let best: Shade = 500
  let bestDist = Infinity
  for (const [shade, l] of Object.entries(lightnessMap)) {
    const d = Math.abs(l - lightness)
    if (d < bestDist) {
      bestDist = d
      best = Number(shade) as Shade
    }
  }
  return best
}

// ─── Contrast ───────────────────────────────────────────────────────────────

function relativeLuminance(c: RGB): number {
  const toLinear = (v: number) => {
    const x = v / 255
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b)
}

export type ContrastResult = {
  ratio: number
  aa_normal: boolean
  aa_large: boolean
  aaa_normal: boolean
  aaa_large: boolean
  rating: 'AAA' | 'AA' | 'AA Large' | 'Fail'
}

export function checkContrast(color1: string, color2: string): ContrastResult {
  const rgb1 = parseColor(color1)
  const rgb2 = parseColor(color2)
  const l1 = relativeLuminance(rgb1)
  const l2 = relativeLuminance(rgb2)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  const ratio = (lighter + 0.05) / (darker + 0.05)

  const aa_normal = ratio >= 4.5
  const aa_large = ratio >= 3
  const aaa_normal = ratio >= 7
  const aaa_large = ratio >= 4.5

  const rating = aaa_normal
    ? 'AAA'
    : aa_normal
      ? 'AA'
      : aa_large
        ? 'AA Large'
        : 'Fail'

  return { ratio: Math.round(ratio * 100) / 100, aa_normal, aa_large, aaa_normal, aaa_large, rating }
}

// ─── Mix ────────────────────────────────────────────────────────────────────

export function mixColors(color1: string, color2: string, ratio = 0.5): string {
  const rgb1 = parseColor(color1)
  const rgb2 = parseColor(color2)
  return rgbToHex({
    r: Math.round(rgb1.r * (1 - ratio) + rgb2.r * ratio),
    g: Math.round(rgb1.g * (1 - ratio) + rgb2.g * ratio),
    b: Math.round(rgb1.b * (1 - ratio) + rgb2.b * ratio),
  })
}

// ─── Export formats ─────────────────────────────────────────────────────────

export function exportPaletteAsCss(name: string, palette: Palette): string {
  const lines = Object.entries(palette).map(
    ([shade, hex]) => `  --color-${name}-${shade}: ${hex};`,
  )
  return `:root {\n${lines.join('\n')}\n}`
}

export function exportPaletteAsTailwind(name: string, palette: Palette): string {
  const entries = Object.entries(palette)
    .map(([shade, hex]) => `      '${shade}': '${hex}',`)
    .join('\n')
  return `// tailwind.config.ts extend.colors:\n'${name}': {\n${entries}\n}`
}

export function exportPaletteAsJs(name: string, palette: Palette): string {
  const entries = Object.entries(palette)
    .map(([shade, hex]) => `  ${shade}: '${hex}',`)
    .join('\n')
  return `export const ${name} = {\n${entries}\n} as const`
}
