// src/ink-opentui/layout-misc.tsx
//
// The layout/text long-tail of the Ink→OpenTUI adapter: the small pieces that
// don't earn their own file. Each mirrors the EXACT public surface of its Ink
// source (so the 643 components stay drop-in) and, where a piece is genuinely
// renderer-agnostic, re-exports the existing implementation instead of rewriting.
//
// Pieces (each maps 1:1 to a src/ink.ts export):
//   Spacer         — Box flexGrow:1            (reuses ./Box.js)
//   Newline        — \n × count, inline text   (<span>)
//   measureElement — node.width/node.height off the Renderable
//   DOMElement     — type alias for OpenTUI's Renderable
//   wrapText       — KEEP: re-export the pure wrap/truncate fn
//   color          — KEEP: re-export the theme-aware color() helper
//   Ansi           — parse ANSI → styled runs, rendered via ./Text.js
//   RawAnsi        — custom Renderable that blits pre-wrapped ANSI; extend()'d
//   NoSelect       — children in a non-selectable <box> (fromLeftEdge pending)

import React, { useLayoutEffect, useRef, type ReactNode } from 'react'
import {
  Renderable,
  RGBA,
  ansi256IndexToRgb,
  createTextAttributes,
  DEFAULT_FOREGROUND_RGB,
  type RenderContext,
  type RenderableOptions,
  type OptimizedBuffer,
} from '@opentui/core'
import { extend, useRenderer } from '@opentui/react'
import Box from './Box.js'
import { controllerFor } from './render.js'
import Text from './Text.js'
// Reuse Ink's renderer-agnostic ANSI parser (termio) and color vocabulary.
import { Parser } from '../ink/termio.js'
import type {
  Color as TermioColor,
  NamedColor,
  TextStyle,
} from '../ink/termio/types.js'
import type { Color } from '../ink/styles.js'

// ── DOMElement ────────────────────────────────────────────────────────────────
// In Ink this was a hand-rolled vnode struct; under OpenTUI the live node IS the
// Renderable. measureElement/refs hand callers a Renderable, so that's the type.
// (Ink leaked fields like yogaNode/scrollTop off DOMElement; those are M-later —
// callers that touched them are being migrated as the milestones land.)
export type DOMElement = Renderable

// ── wrapText (KEEP) ─────────────────────────────────────────────────────────--
// Pure string wrap/truncate over the project's own stringWidth/wrapAnsi — fully
// renderer-agnostic, so re-export the canonical implementation verbatim.
export { default as wrapText } from '../ink/wrap-text.js'

// ── color (KEEP) ──────────────────────────────────────────────────────────────
// Curried theme-aware colorizer (resolves theme keys → raw color, then ANSI).
// Renderer-agnostic string→string, so re-export the canonical implementation.
export { color } from '../components/design-system/color.js'

// ── measureElement ──────────────────────────────────────────────────────────--
// Ink read getComputedWidth/Height off the Yoga node; OpenTUI exposes the laid-out
// size directly as Renderable.width/height (both number getters). Same contract.
type MeasureOutput = { width: number; height: number }

// Named export (this file hosts several pieces, so no module default — the
// barrel aliases each: `export { measureElement } from './layout-misc.js'`).
export const measureElement = (node: DOMElement): MeasureOutput => ({
  width: node.width,
  height: node.height,
})

// ── Spacer ──────────────────────────────────────────────────────────────────--
// Flexible gap that expands along its container's major axis. Pure composition
// over Box, so it just sets flexGrow on the proven ./Box.js.
export function Spacer(): React.ReactNode {
  return React.createElement(Box, { flexGrow: 1 })
}

// ── Newline ───────────────────────────────────────────────────────────────────
// Mirror Ink's Newline Props. Ink emitted an <ink-text> holding "\n"×count to be
// consumed by its squash pass; in OpenTUI the inline-text element inside a <text>
// is <span>, so we emit that. Must be used within a <Text>, same as Ink.
export type Props = {
  /**
   * Number of newlines to insert.
   *
   * @default 1
   */
  readonly count?: number
}

export type NewlineProps = Props

export function Newline({ count = 1 }: Props): React.ReactNode {
  return React.createElement('span', null, '\n'.repeat(count))
}

// ── NoSelect ────────────────────────────────────────────────────────────────--
// Fences content off from clpzcode's cell-grid text selection (M3). The box's
// renderable is registered with the SelectionController, which each shadow build
// rasterizes its screen rect into the engine's noSelect bitmap — so selected
// cells inside it are skipped by both the highlight overlay and getSelectedText
// (gutters/line-numbers/diff sigils don't get copied). `fromLeftEdge` widens the
// exclusion left bound to column 0 (every diff gutter uses it), exactly the Ink
// semantic. `selectable:false` is kept as belt-and-braces (it also keeps OpenTUI's
// native selection off this box), but the registry + rasterization is what
// actually excludes the cells. The layout pass-through reuses ./Box.js.
type BoxProps = React.ComponentProps<typeof Box>
export type NoSelectProps = Omit<BoxProps, 'noSelect'> & {
  /**
   * Extend the exclusion zone from column 0 to this box's right edge. Used by
   * every diff/code gutter so a drag-select over a diff copies clean code
   * without line numbers or +/-/└ sigils.
   *
   * @default false
   */
  fromLeftEdge?: boolean
}

export function NoSelect(props: NoSelectProps): React.ReactNode {
  const { children, fromLeftEdge = false, ...boxProps } = props
  const renderer = useRenderer()
  // Box.tsx forwards the ref to the <box> intrinsic → resolves to the Renderable
  // at runtime (same pattern as useTerminalViewport). Register it with the
  // controller so its screen rect (widened to col 0 when fromLeftEdge) is excluded
  // from selection; unregister on unmount / fromLeftEdge change.
  const ref = useRef<Renderable | null>(null)
  useLayoutEffect(() => {
    const ctrl = controllerFor(renderer)
    const r = ref.current
    if (!ctrl || !r) return
    return ctrl.registerNoSelect(r, fromLeftEdge)
  }, [renderer, fromLeftEdge])
  // `selectable` is an OpenTUI box prop outside Ink's Styles, so the cast carries
  // it past the Ink-typed Box surface (Box.tsx forwards unknown props to <box>).
  return React.createElement(
    Box,
    { ...boxProps, ref, selectable: false } as BoxProps,
    children,
  )
}

// ── Ansi ──────────────────────────────────────────────────────────────────────
// Parses an ANSI string into styled runs and renders them as inline <span>s inside
// a single <text> container. The Ink original emitted ink-text/ink-link intrinsics
// (which OpenTUI can't mount); the *parsing* (termio) is renderer-agnostic and
// reused verbatim, only the leaf emission is retargeted. Each run is a <span> (the
// OpenTUI inline-text node — SpanRenderable extends TextNodeRenderable, accepting
// fg/bg/attributes), and the outer <text> is the required text-node host for them.
// We deliberately do NOT nest <text> inside <text> (./Text.js always emits the
// 'text' intrinsic, and TextRenderable.add rejects a TextRenderable child — only
// strings/TextNodeRenderable/StyledText are legal, so a nested <text> throws).
// Hyperlink runs degrade to plain styled text (OpenTUI hyperlink support is a
// later milestone). The fg/bg strings flow into span.fg/span.bg exactly as the
// ./Text.js adapter feeds them to <text> — same color contract across the adapter.

type SpanProps = {
  color?: Color
  backgroundColor?: Color
  dim?: boolean
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  inverse?: boolean
}

type Span = { text: string; props: SpanProps }

type AnsiProps = {
  children: string
  /** When true, force all text to be rendered with dim styling. */
  dimColor?: boolean
}

// Resolve a termio Color → `#rrggbb` hex for the OpenTUI Text path. OpenTUI's
// <text> fg/bg parse a hex string (not Ink's `ansi:`/`rgb()`/`ansi256()`
// vocabulary, and not RGBA.toString()'s `rgba(0.80,…)` form), so reuse the same
// termio→RGBA mapping as RawAnsi (shared ANSI_PALETTE / ansi256IndexToRgb) and
// format the 0-255 ints as hex. 'default' returns undefined so Text falls back
// to the terminal default.
function rgbaToHex(rgba: RGBA): string {
  const [r, g, b] = rgba.toInts()
  const h = (n: number) => n.toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

function colorToString(c: TermioColor): Color | undefined {
  const rgba = termioToRgba(c)
  return rgba ? (rgbaToHex(rgba) as Color) : undefined
}

function styleToSpanProps(style: TextStyle): SpanProps {
  const props: SpanProps = {}
  if (style.bold) props.bold = true
  if (style.dim) props.dim = true
  if (style.italic) props.italic = true
  if (style.underline !== 'none') props.underline = true
  if (style.strikethrough) props.strikethrough = true
  if (style.inverse) props.inverse = true
  const fg = colorToString(style.fg)
  if (fg) props.color = fg
  const bg = colorToString(style.bg)
  if (bg) props.backgroundColor = bg
  return props
}

function spanPropsEqual(a: SpanProps, b: SpanProps): boolean {
  return (
    a.color === b.color &&
    a.backgroundColor === b.backgroundColor &&
    a.bold === b.bold &&
    a.dim === b.dim &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strikethrough === b.strikethrough &&
    a.inverse === b.inverse
  )
}

function parseToSpans(input: string): Span[] {
  const parser = new Parser()
  const actions = parser.feed(input)
  const spans: Span[] = []
  for (const action of actions) {
    if (action.type !== 'text') continue
    const text = action.graphemes.map(g => g.value).join('')
    if (!text) continue
    const props = styleToSpanProps(action.style)
    const last = spans[spans.length - 1]
    if (last && spanPropsEqual(last.props, props)) {
      last.text += text
    } else {
      spans.push({ text, props })
    }
  }
  return spans
}

// Render one run as an inline <span> (SpanRenderable accepts fg/bg/attributes).
// Bold/dim are mutually exclusive in terminals (Ink's WeightProps union); emit at
// most one weight bit per run — dim wins (matches the Ink Ansi's StyledText).
function styledRun(key: number, props: SpanProps, text: string): ReactNode {
  const attributes = createTextAttributes({
    bold: props.dim ? false : !!props.bold,
    dim: !!props.dim,
    italic: !!props.italic,
    underline: !!props.underline,
    strikethrough: !!props.strikethrough,
    inverse: !!props.inverse,
  })
  return React.createElement(
    'span',
    { key, fg: props.color, bg: props.backgroundColor, attributes },
    text,
  )
}

export const Ansi = React.memo(function Ansi({ children, dimColor }: AnsiProps): ReactNode {
  if (typeof children !== 'string') {
    return dimColor
      ? React.createElement(Text, { dim: true }, String(children))
      : React.createElement(Text, null, String(children))
  }
  if (children === '') return null

  const spans = parseToSpans(children)
  if (spans.length === 0) return null

  const content = spans.map((span, i) => {
    const props = dimColor ? { ...span.props, dim: true } : span.props
    return styledRun(i, props, span.text)
  })
  // Single <text> host wraps the inline <span> runs (spans require a text-node
  // ancestor). dimColor on the container also dims any default-styled runs.
  return dimColor
    ? React.createElement(Text, { dim: true }, content)
    : React.createElement(Text, null, content)
})

// ── RawAnsi ─────────────────────────────────────────────────────────────────--
// Bypass the <Ansi> → React tree → squash → re-serialize roundtrip for content
// that is already terminal-ready (e.g. the ColorDiff NAPI module emits ANSI-
// escaped, width-wrapped lines). The Ink version emitted an <ink-raw-ansi> leaf
// with a constant-time measure func and handed the joined string to output.write.
//
// Under OpenTUI we register a custom Renderable (extend) that is a fixed-size
// leaf (width × lines.length — known up front, no measure func) and, in its
// renderSelf, parses each line's inline ANSI once and blits the styled runs to
// the buffer with drawText at the node's screen origin. Same single-leaf cost
// model: O(content), no per-span Yoga children.

type RawAnsiOptions = RenderableOptions & {
  rawText?: string
  rawWidth?: number
  rawHeight?: number
}

// A single drawable run: a contiguous slice of one row sharing fg/bg/attributes.
type AnsiRun = { x: number; y: number; text: string; fg: RGBA; bg?: RGBA; attributes: number }

// 16-color ANSI palette as RGB, indexed in NamedColor order. Mirrors the standard
// xterm defaults so blitted named colors match the rest of the terminal.
const ANSI_PALETTE: Record<NamedColor, [number, number, number]> = {
  black: [0, 0, 0],
  red: [205, 0, 0],
  green: [0, 205, 0],
  yellow: [205, 205, 0],
  blue: [0, 0, 238],
  magenta: [205, 0, 205],
  cyan: [0, 205, 205],
  white: [229, 229, 229],
  brightBlack: [127, 127, 127],
  brightRed: [255, 0, 0],
  brightGreen: [0, 255, 0],
  brightYellow: [255, 255, 0],
  brightBlue: [92, 92, 255],
  brightMagenta: [255, 0, 255],
  brightCyan: [0, 255, 255],
  brightWhite: [255, 255, 255],
}

// Resolve a termio Color → RGBA. Unlike Ansi (which round-trips through clpzcode
// color strings for the Text path), the blit path needs concrete RGBA, so we map
// termio's structured color directly.
function termioToRgba(c: TermioColor): RGBA | undefined {
  switch (c.type) {
    case 'named': {
      const [r, g, b] = ANSI_PALETTE[c.name]
      return RGBA.fromInts(r, g, b, 255)
    }
    case 'indexed': {
      const [r, g, b] = ansi256IndexToRgb(c.index)
      return RGBA.fromInts(r, g, b, 255)
    }
    case 'rgb':
      return RGBA.fromInts(c.r, c.g, c.b, 255)
    case 'default':
      return undefined
  }
}

// Default-foreground runs paint with the renderer/theme default rather than a
// hardcoded grey, so they track the active terminal default.
const DEFAULT_FG = RGBA.fromInts(
  DEFAULT_FOREGROUND_RGB[0],
  DEFAULT_FOREGROUND_RGB[1],
  DEFAULT_FOREGROUND_RGB[2],
  255,
)

class RawAnsiRenderable extends Renderable {
  private _rawText = ''
  // Parsed runs, recomputed only when rawText changes (parse is the dominant cost).
  private _runs: AnsiRun[] = []

  constructor(ctx: RenderContext, options: RawAnsiOptions) {
    super(ctx, options)
    // Apply initial size from rawWidth/rawHeight (the base reads width/height, not
    // these), so the leaf is sized even before finalizeInitialChildren re-applies
    // the props — no zero-size window on the very first layout pass.
    if (options.rawWidth != null) this.rawWidth = options.rawWidth
    if (options.rawHeight != null) this.rawHeight = options.rawHeight
    if (options.rawText != null) this.rawText = options.rawText
  }

  // The reconciler assigns unknown props via `instance[prop] = value`, so these
  // are property setters. rawWidth/rawHeight just forward to the layout size
  // (the producer already wrapped to these dims — they are the fixed leaf bounds).
  set rawWidth(value: number) {
    this.width = value
  }
  set rawHeight(value: number) {
    this.height = value
  }
  set rawText(value: string) {
    if (this._rawText === value) return
    this._rawText = value
    this._runs = this.parseRuns(value)
    this.requestRender()
  }
  get rawText(): string {
    return this._rawText
  }

  // Parse the multi-line ANSI string into per-row styled runs. Row index = line
  // number; runs carry row-relative x so renderSelf only adds the screen origin.
  private parseRuns(text: string): AnsiRun[] {
    const runs: AnsiRun[] = []
    const lines = text.split('\n')
    for (let y = 0; y < lines.length; y++) {
      const parser = new Parser()
      const actions = parser.feed(lines[y]!)
      let x = 0
      for (const action of actions) {
        if (action.type !== 'text') continue
        const runText = action.graphemes.map(g => g.value).join('')
        if (!runText) continue
        const width = action.graphemes.reduce((sum, g) => sum + g.width, 0)
        const style = action.style
        const fg = termioToRgba(style.fg) ?? DEFAULT_FG
        const bg = termioToRgba(style.bg)
        const attributes = createTextAttributes({
          bold: style.bold,
          dim: style.dim,
          italic: style.italic,
          underline: style.underline !== 'none',
          strikethrough: style.strikethrough,
          inverse: style.inverse,
        })
        runs.push({ x, y, text: runText, fg, bg, attributes })
        x += width
      }
    }
    return runs
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    const originX = this._screenX
    const originY = this._screenY
    for (const run of this._runs) {
      buffer.drawText(run.text, originX + run.x, originY + run.y, run.fg, run.bg, run.attributes)
    }
  }
}

// Register the custom leaf once at module load (extend is idempotent on key).
extend({ 'raw-ansi': RawAnsiRenderable })

type RawAnsiComponentProps = {
  /** Pre-rendered ANSI lines; each element is exactly one terminal row. */
  lines: string[]
  /** Column width the producer wrapped to (fixed leaf width). */
  width: number
}

export function RawAnsi({ lines, width }: RawAnsiComponentProps): React.ReactNode {
  if (lines.length === 0) return null
  return React.createElement('raw-ansi', {
    rawText: lines.join('\n'),
    rawWidth: width,
    rawHeight: lines.length,
  })
}
