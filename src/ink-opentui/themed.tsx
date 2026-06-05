// src/ink-opentui/themed.tsx
//
// OpenTUI-backed ThemedBox + ThemedText, mirroring the design-system originals
// src/components/design-system/ThemedBox.tsx and ThemedText.tsx. The
// theme-resolution logic is KEPT verbatim — it is renderer-agnostic React
// (theme-key → raw Color resolution, the TextHoverColorContext precedence, the
// `color`/`dimColor`/hover cascade). The ONLY retarget is the rendered child
// element: instead of Ink's Box/Text we emit the proven adapters ./Box.js and
// ./Text.js (both default exports), which render the OpenTUI <box>/<text>
// intrinsics. Same Props types, re-used via `import type` from the design-system
// source so the 643 components are drop-in.
//
// The original is React-compiler-compiled (the `_c` memo cache); that cache is a
// pure perf optimization, not behavior — so this hand-written source omits it,
// matching the clean style of the proven ./Box.tsx / ./Text.tsx adapters.
//
// RE-USE OVER RE-IMPLEMENT: the curried `color` helper and the
// TextHoverColorContext are renderer-agnostic KEEP code. We RE-EXPORT them from
// their original design-system modules rather than re-declaring them. This is
// load-bearing for the context: VirtualMessageList imports TextHoverColorContext
// directly from `../components/design-system/ThemedText.js` and mounts the
// Provider; if this adapter's ThemedText consumed a *fresh* createContext object,
// the Provider/consumer identities would not match and hover-coloring would
// silently break. Re-exporting guarantees a single shared context object.
//
// PER-SIDE BORDER COLORS: Ink's ThemedBox accepts borderTopColor/Bottom/Left/Right.
// OpenTUI's <box> (and our ./Box.js adapter) only support a single `borderColor`.
// We resolve all five theme keys (so type-compat is exact), then COLLAPSE them to
// one `borderColor`, preferring the explicit all-sides `borderColor` and falling
// back to the first defined per-side color. Per-side border tinting is not
// representable in OpenTUI 0.3.0.
//
// `wrap` / `truncate-*`: ThemedText forwards `wrap` to the ./Text.js adapter for
// exact type-compat, but the proven adapter does NOT map `wrap` yet (its
// documented M2 deferral). So wrap is a type-faithful no-op at runtime — noted
// here so the "KEPT verbatim" fidelity claim is not overstated.
//
// EXPORT-SHAPE CONSTRAINT FOR THE INTEGRATOR (read before wiring the barrel):
// A single ES module has exactly ONE default export. The originals are TWO
// modules — ThemedBox.js (default = ThemedBox) and ThemedText.js (default =
// ThemedText) — and `src/ink.ts` consumes them as `{ default as Box }` and
// `{ default as Text }` respectively, while 5 component sites import
// `ThemedText` (default) and `TextHoverColorContext` (named) DIRECTLY from
// `./design-system/ThemedText.js`. This one combined module therefore CANNOT be
// the `default` for both Box and Text. It exposes everything the integrator
// needs as explicit NAMED exports — `ThemedBox`, `ThemedText`, `Box` (alias of
// ThemedBox), `Text` (alias of ThemedText), `color`, `TextHoverColorContext`,
// plus the Props types — so the barrel / module-repoint can pick the correct one
// per path, e.g.
//   export { ThemedBox as default, ThemedBox as Box } from './themed.js'   // ThemedBox.js shim
//   export { ThemedText as default, ThemedText as Text, TextHoverColorContext } from './themed.js'  // ThemedText.js shim
//   export { color } from './themed.js'                                     // color.js shim
// The `default` here is ThemedBox (matching the prior revision) but MUST NOT be
// relied on for the `Text` path — use the named `ThemedText`/`Text` export.

import React, { type PropsWithChildren, type ReactNode, useContext } from 'react'
import Box from './Box.js'
import Text from './Text.js'
import { toOpenTuiColor } from './color.js'
import type { DOMElement } from '../ink/dom.js'
import type { Color } from '../ink/styles.js'
import { getTheme, type Theme } from '../utils/theme.js'
import { useTheme } from '../components/design-system/ThemeProvider.js'
// Re-use the EXACT public Props types of the components we replace.
import type { Props as ThemedBoxProps } from '../components/design-system/ThemedBox.js'
import type { Props as ThemedTextProps } from '../components/design-system/ThemedText.js'
// Re-export renderer-agnostic KEEP code rather than re-declaring it. The context
// MUST be the same object the original ThemedText module exports (see header).
import { TextHoverColorContext } from '../components/design-system/ThemedText.js'

export type { ThemedBoxProps, ThemedTextProps }
export { TextHoverColorContext }
export { color } from '../components/design-system/color.js'

/**
 * Resolves a color value that may be a theme key to a raw Color.
 * KEPT verbatim from the design-system ThemedBox/ThemedText (renderer-agnostic).
 */
function resolveColor(color: keyof Theme | Color | undefined, theme: Theme): Color | undefined {
  if (!color) return undefined
  // Check if it's a raw color (starts with rgb(, #, ansi256(, or ansi:)
  if (color.startsWith('rgb(') || color.startsWith('#') || color.startsWith('ansi256(') || color.startsWith('ansi:')) {
    return color as Color
  }
  // It's a theme key - resolve it
  return theme[color as keyof Theme] as Color
}

// Color normalization (rgb()/ansi256()/ansi: → #hex, avoiding OpenTUI's magenta
// hex-fallback) now lives in the shared ./color.js so the base ./Box.js/./Text.js
// adapters normalize too — see issue #17. themed.tsx still calls toOpenTuiColor on
// the resolved theme colors below; the base adapters re-normalize idempotently.

/**
 * Theme-aware Box component that resolves theme color keys to raw colors.
 * This wraps the base (adapter) Box component with theme resolution for border colors.
 */
function ThemedBoxInner(
  props: PropsWithChildren<ThemedBoxProps>,
  ref: React.ForwardedRef<DOMElement>,
) {
  const {
    borderColor,
    borderTopColor,
    borderBottomColor,
    borderLeftColor,
    borderRightColor,
    backgroundColor,
    children,
    ...rest
  } = props

  const [themeName] = useTheme()
  const theme = getTheme(themeName)
  const resolvedBorderColor = resolveColor(borderColor, theme)
  const resolvedBorderTopColor = resolveColor(borderTopColor, theme)
  const resolvedBorderBottomColor = resolveColor(borderBottomColor, theme)
  const resolvedBorderLeftColor = resolveColor(borderLeftColor, theme)
  const resolvedBorderRightColor = resolveColor(borderRightColor, theme)
  const resolvedBackgroundColor = resolveColor(backgroundColor, theme)

  // Collapse per-side border colors → a single borderColor (OpenTUI has no
  // per-side border color); prefer the all-sides color, else first defined side.
  const collapsedBorderColor =
    resolvedBorderColor ??
    resolvedBorderTopColor ??
    resolvedBorderBottomColor ??
    resolvedBorderLeftColor ??
    resolvedBorderRightColor

  return (
    <Box
      ref={ref}
      borderColor={toOpenTuiColor(collapsedBorderColor)}
      backgroundColor={toOpenTuiColor(resolvedBackgroundColor)}
      {...rest}
    >
      {children}
    </Box>
  )
}
const ThemedBox = React.forwardRef<DOMElement, PropsWithChildren<ThemedBoxProps>>(ThemedBoxInner)
ThemedBox.displayName = 'ThemedBox'

/**
 * Theme-aware Text component that resolves theme color keys to raw colors.
 * This wraps the base (adapter) Text component with theme resolution.
 */
function ThemedText(props: ThemedTextProps): ReactNode {
  const {
    color,
    backgroundColor,
    dimColor = false,
    bold = false,
    italic = false,
    underline = false,
    strikethrough = false,
    inverse = false,
    wrap = 'wrap',
    children,
  } = props

  const [themeName] = useTheme()
  const theme = getTheme(themeName)
  const hoverColor = useContext(TextHoverColorContext)
  const resolvedColor = !color && hoverColor
    ? resolveColor(hoverColor, theme)
    : dimColor
      ? (theme.inactive as Color)
      : resolveColor(color, theme)
  const resolvedBackgroundColor = backgroundColor ? (theme[backgroundColor] as Color) : undefined

  return (
    <Text
      color={toOpenTuiColor(resolvedColor)}
      backgroundColor={toOpenTuiColor(resolvedBackgroundColor)}
      bold={bold}
      italic={italic}
      underline={underline}
      strikethrough={strikethrough}
      inverse={inverse}
      wrap={wrap}
    >
      {children}
    </Text>
  )
}

// Named exports the integrator wires into the barrel / module-repoint. Both the
// design-system names (ThemedBox/ThemedText) and the ink.ts public names
// (Box/Text) are exposed so each path can pick the right one. `default` is
// ThemedBox only — DO NOT use it for the Text path (see header constraint).
export { ThemedBox, ThemedText, ThemedBox as Box, ThemedText as Text }
export default ThemedBox
