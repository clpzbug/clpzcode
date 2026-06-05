// src/ink-opentui/color.ts
//
// Shared color normalizer for the Ink→OpenTUI adapter. clpzcode's `Color`
// vocabulary has FOUR forms — `#rrggbb`, `rgb(r,g,b)`, `ansi256(n)`, `ansi:name`
// (src/ink/styles.ts) — but OpenTUI's parseColor treats any non-CSS-named string
// as HEX (hexToRgb): an `rgb(...)`, `ansi256(n)` or `ansi:name` Color fails its hex
// regex and silently defaults to MAGENTA. So every Color that reaches a <box>/<text>
// intrinsic MUST first be normalized to a `#rrggbb` hex string.
//
// This logic previously lived only in themed.tsx, which meant THEMED Box/Text were
// safe but the base (non-themed) ./Box.js / ./Text.js adapters passed colors
// through raw — so a non-themed `rgb()`/`ansi256()`/`ansi:` color rendered magenta.
// Extracting it here lets Box.tsx, Text.tsx AND themed.tsx all normalize via one
// implementation (issue #17).
//
// PALETTE NOTE: the 16 named-ANSI hexes below are the xterm/chalk palette (what
// clpzcode's `colorize`/chalk emit for the same names), NOT @opentui/core's
// ansi256IndexToRgb 0-15 (which is the VGA/standard palette — red=#800000, etc.).
// They must stay distinct so blitted/themed named colors match the rest of the
// terminal output. (Verified: 9 of the 16 differ between the two palettes.)

import type { Color } from '../ink/styles.js'

const RGB_REGEX = /^rgb\(\s?(\d+),\s?(\d+),\s?(\d+)\s?\)$/
const ANSI256_REGEX = /^ansi256\(\s?(\d+)\s?\)$/

// xterm default palette for the 16 named ANSI colors (also covers indices 0-15
// of ansi256). Matches the colors `colorize`/chalk emit for the same names.
export const ANSI_16_HEX: Record<string, string> = {
  black: '#000000',
  red: '#cd0000',
  green: '#00cd00',
  yellow: '#cdcd00',
  blue: '#0000ee',
  magenta: '#cd00cd',
  cyan: '#00cdcd',
  white: '#e5e5e5',
  blackBright: '#7f7f7f',
  redBright: '#ff0000',
  greenBright: '#00ff00',
  yellowBright: '#ffff00',
  blueBright: '#5c5cff',
  magentaBright: '#ff00ff',
  cyanBright: '#00ffff',
  whiteBright: '#ffffff',
}
const ANSI_16_ORDER = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'blackBright',
  'redBright',
  'greenBright',
  'yellowBright',
  'blueBright',
  'magentaBright',
  'cyanBright',
  'whiteBright',
]

function toHex2(n: number): string {
  return Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')
}

// Standard xterm 256-color palette → [r,g,b]: 0-15 system, 16-231 6x6x6 cube,
// 232-255 grayscale ramp.
function ansi256ToHex(idx: number): string {
  if (idx < 16) return ANSI_16_HEX[ANSI_16_ORDER[idx]]
  if (idx >= 232) {
    const v = 8 + (idx - 232) * 10
    return `#${toHex2(v)}${toHex2(v)}${toHex2(v)}`
  }
  const i = idx - 16
  const r = Math.floor(i / 36)
  const g = Math.floor((i % 36) / 6)
  const b = i % 6
  const step = (c: number) => (c === 0 ? 0 : 55 + c * 40)
  return `#${toHex2(step(r))}${toHex2(step(g))}${toHex2(step(b))}`
}

/**
 * Convert any clpzcode `Color` to a `#rrggbb` hex string OpenTUI's parseColor
 * accepts. Passes `#hex` through; converts `rgb()`/`ansi256()`/`ansi:`.
 * Unrecognized input is returned as-is (parseColor's own fallback then applies).
 * Returns a `Color` (always a HexColor when converted) so the ./Box.js/./Text.js
 * adapters' `Color`-typed props stay drop-in.
 */
export function toOpenTuiColor(color: Color | undefined): Color | undefined {
  if (!color) return undefined
  if (color.startsWith('#')) return color
  if (color.startsWith('rgb(')) {
    const m = RGB_REGEX.exec(color)
    if (m) return `#${toHex2(Number(m[1]))}${toHex2(Number(m[2]))}${toHex2(Number(m[3]))}` as Color
    return color
  }
  if (color.startsWith('ansi256(')) {
    const m = ANSI256_REGEX.exec(color)
    if (m) return ansi256ToHex(Number(m[1])) as Color
    return color
  }
  if (color.startsWith('ansi:')) {
    const name = color.slice('ansi:'.length)
    return (ANSI_16_HEX[name] as Color) ?? color
  }
  return color
}

// Darken a resolved color toward black by `factor` (0..1) to approximate Ink's
// borderDimColor (chalk.dim SGR), which OpenTUI's <box> can't express directly.
// Non-#rrggbb results (named/unparseable) pass through unchanged.
export function dimColor(color: Color | undefined, factor = 0.55): Color | undefined {
  const resolved = toOpenTuiColor(color)
  if (typeof resolved !== 'string') return resolved
  const m = /^#([0-9a-fA-F]{6})$/.exec(resolved)
  if (!m) return resolved
  const n = parseInt(m[1], 16)
  const ch = (v: number) => Math.round(v * factor).toString(16).padStart(2, '0')
  return `#${ch((n >> 16) & 0xff)}${ch((n >> 8) & 0xff)}${ch(n & 0xff)}` as Color
}
