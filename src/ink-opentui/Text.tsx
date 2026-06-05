// src/ink-opentui/Text.tsx
//
// OpenTUI-backed BaseText: same prop surface as src/ink/components/Text.tsx,
// emitting the OpenTUI <text> intrinsic. Maps:
//   color           → fg
//   backgroundColor → bg
//   bold/italic/underline/strikethrough/inverse → attributes bitfield
//                     (createTextAttributes)
//   children        → text content (strings/numbers; nested styled runs handled
//                     by the <span> path — see note below)
// `wrap`/truncate variants are deferred to M2 (OpenTUI truncate is end-only; the
// shim lives there). dimColor is not in clpzcode's Text surface (dimming is done
// via resolved colors), so nothing to map.
//
// NOTE (nested Text): Ink allows <Text><Text color>…</Text></Text> for inline
// runs. In OpenTUI those inner runs are <span>. This flat version renders string
// children directly; nested-Text→<span> rewriting is an M1 refinement.

import React, { Children, createContext, useContext, type ReactNode } from 'react'
import { createTextAttributes } from '@opentui/core'
import type { Props as InkTextProps } from '../ink/components/Text.js'
// Normalize clpzcode's rgb()/ansi256()/ansi: Color forms to #hex so a NON-themed
// fg/bg color doesn't hit OpenTUI's magenta hex-fallback (issue #17).
import { toOpenTuiColor } from './color.js'

// Ink lets <Text> nest <Text> for inline styled runs. OpenTUI models a block of
// text as <text> (TextRenderable) and inline runs as <span> (TextNodeRenderable);
// a <text> CANNOT contain another <text>. So the OUTERMOST Text renders <text>
// and marks its subtree; any Text rendered inside another Text renders <span>.
const InsideTextContext = createContext(false)

// Ink <Text> accepts any children (strings, numbers, nested <Text>, fragments);
// OpenTUI's <text> host accepts ONLY strings, TextNodeRenderable (nested
// <text>/<span>), or StyledText. React appends numbers verbatim → OpenTUI throws
// ("TextNodeRenderable only accepts strings…"). Coerce numbers to strings and
// flatten; strings + nested text elements pass through, null/false are dropped by
// the reconciler. (Nested non-text elements remain an M1 edge — rare in Text.)
function coerceTextChildren(children: ReactNode): ReactNode {
  return Children.map(children, child =>
    typeof child === 'number' ? String(child) : child,
  )
}

// Ink textWrap → OpenTUI {wrapMode, truncate}. OpenTUI truncate is end-only, so
// Ink's truncate-start/-middle degrade to end-truncate (minor visual diff).
function mapWrap(wrap?: string): { wrapMode: 'none' | 'word'; truncate: boolean } {
  if (!wrap || wrap === 'wrap' || wrap === 'wrap-trim') return { wrapMode: 'word', truncate: false }
  return { wrapMode: 'none', truncate: true }
}

function Text(props: InkTextProps): React.ReactNode {
  const { color, backgroundColor, bold, dim, italic, underline, strikethrough, inverse, wrap, children } =
    props as InkTextProps & { bold?: boolean; dim?: boolean; wrap?: string }

  const attributes = createTextAttributes({
    bold: dim ? false : (bold ?? false), // Ink: bold/dim mutually exclusive, dim wins
    dim: dim ?? false,
    italic: italic ?? false,
    underline: underline ?? false,
    strikethrough: strikethrough ?? false,
    inverse: inverse ?? false,
  })

  const insideText = useContext(InsideTextContext)
  const kids = coerceTextChildren(children)
  const fg = toOpenTuiColor(color)
  const bg = toOpenTuiColor(backgroundColor)

  // selectable:false on every text node so OpenTUI never auto-starts native
  // selection — the SelectionController owns selection via the root mouse handler.
  if (insideText) {
    return React.createElement(
      'span',
      { style: { fg, bg, attributes }, selectable: false },
      kids,
    )
  }

  const { wrapMode, truncate } = mapWrap(wrap)
  return React.createElement(
    'text',
    { fg, bg, attributes, selectable: false, wrapMode, truncate },
    React.createElement(InsideTextContext.Provider, { value: true }, kids),
  )
}

export default Text
