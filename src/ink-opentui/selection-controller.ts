// src/ink-opentui/selection-controller.ts
//
// PATH 1 (cell-grid shadow) host for the UNCHANGED forked-Ink selection engine
// (src/ink/selection.ts). See docs/M3-SELECTION-DESIGN.md for the authoritative
// plan. This controller is the OpenTUI analogue of the forked-Ink `Ink` class's
// selection surface (ink.tsx copySelection/hasTextSelection/shiftSelection… etc.):
// it owns a SelectionState, builds a per-frame SHADOW Screen from OpenTUI's final
// OptimizedBuffer, feeds OpenTUI mouse down/drag/up into the engine, paints the
// highlight overlay via addPostProcessFn + setCell, and copies via OSC 52.
//
// WHY A SHADOW: the engine reads a cell-grid `Screen` (chars/widths + a parallel
// noSelect bitmap + softWrap markers) — exactly the structure forked-Ink rendered
// into. OpenTUI renders to a flat OptimizedBuffer instead. We reconstruct that
// `Screen` each interaction frame from `buffer.getSpanLines()` (decoded per-row
// text, wide-char continuation cells resolved to "") + the char continuation flag
// in `buffer.buffers.char`, then hand the engine the grid it expects. The engine
// stays byte-for-byte the same (READ-ONLY constraint on src/ink/).
//
// NATIVE SELECTION SUPPRESSION: OpenTUI auto-starts its own selection on left-down
// only when the hit renderable is `selectable` (renderer processSingleMouseEvent,
// index core ~24135). The adapter leaves every renderable non-selectable, so
// native selection never starts, `currentSelection` stays null, and every mouse
// event bubbles (Renderable.processMouseEvent → parent) to the root onMouse handler
// render.tsx attaches — which drives this controller. We own selection end-to-end.

import {
  RGBA,
  type CliRenderer,
  type OptimizedBuffer,
  type Renderable,
} from '@opentui/core'
import { toOpenTuiColor } from './color.js'
import {
  CellWidth,
  type Screen,
  StylePool,
  CharPool,
  HyperlinkPool,
  createScreen,
  resetScreen,
  setCellAt,
  markNoSelectRegion,
} from '../ink/screen.js'
import {
  captureScrolledRows as engineCaptureScrolledRows,
  clearSelection,
  createSelectionState,
  extendSelection,
  finishSelection,
  type FocusMove,
  getSelectedText,
  hasSelection as engineHasSelection,
  moveFocus,
  type SelectionState,
  selectLineAt,
  selectWordAt,
  shiftAnchor as engineShiftAnchor,
  shiftSelection,
  shiftSelectionForFollow,
  startSelection,
  updateSelection,
} from '../ink/selection.js'

// Continuation flag set on the 2nd cell of a wide char in OptimizedBuffer.char
// (index core getSpanLines: CHAR_FLAG_CONTINUATION = 3221225472 | 0 = 0xC0000000).
const CHAR_FLAG_CONTINUATION = 0xc0000000 | 0
const CHAR_FLAG_MASK = 0xc0000000 | 0

// Multi-click detection window, mirrored from src/ink/components/App.tsx.
const MULTI_CLICK_TIMEOUT_MS = 500
const MULTI_CLICK_DISTANCE = 1

/** A renderable fenced off from selection, with its fromLeftEdge flag. */
type NoSelectEntry = { r: Renderable; fromLeftEdge: boolean }

export class SelectionController {
  /** The engine's mutable state — exposed via getState() exactly like
   *  ink.selection was (ScrollKeybindingHandler reads isDragging/focus/anchor). */
  readonly selection: SelectionState = createSelectionState()

  private readonly renderer: CliRenderer
  private readonly listeners = new Set<() => void>()

  // Shadow Screen + its pools. Rebuilt (resetScreen + repaint) each interaction
  // frame. The StylePool is only used so the engine's cellAt/setCellAt see a
  // valid emptyStyleId; we never emit SGR from it (the overlay writes RGBA to the
  // OpenTUI buffer directly, not through the StylePool).
  private screen: Screen | null = null
  private readonly stylePool = new StylePool()
  private readonly charPool = new CharPool()
  private readonly hyperlinkPool = new HyperlinkPool()

  // Selection highlight bg, parsed from theme color via setSelectionBgColor.
  private selectionBg: RGBA | null = null

  // noSelect rect registry (NoSelect components register their box renderable +
  // fromLeftEdge flag). Rasterized into screen.noSelect each shadow build.
  private readonly noSelectRegistry = new Set<NoSelectEntry>()

  // Multi-click bookkeeping (ported from App.handleMouseEvent).
  private lastClickTime = 0
  private clickCount = 0
  private lastClickCol = -1
  private lastClickRow = -1

  constructor(renderer: CliRenderer) {
    this.renderer = renderer
    renderer.addPostProcessFn(this.postProcess)
  }

  destroy(): void {
    this.renderer.removePostProcessFn(this.postProcess)
    this.listeners.clear()
    this.noSelectRegistry.clear()
  }

  // ── reactive surface (useSyncExternalStore-compatible; stable identities) ──

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  hasSelection = (): boolean => engineHasSelection(this.selection)

  getState = (): SelectionState => this.selection

  /** Re-render the frame (so the overlay repaints) and fire React subscribers. */
  private notify = (): void => {
    this.renderer.requestRender()
    for (const cb of this.listeners) cb()
  }

  // ── noSelect registry ──────────────────────────────────────────────────────

  /** Register a renderable to exclude from selection. Returns an unregister fn
   *  for the NoSelect component's effect cleanup. fromLeftEdge widens the
   *  exclusion left bound to column 0 (gutter semantics). */
  registerNoSelect(r: Renderable, fromLeftEdge: boolean): () => void {
    const entry: NoSelectEntry = { r, fromLeftEdge }
    this.noSelectRegistry.add(entry)
    return () => {
      this.noSelectRegistry.delete(entry)
    }
  }

  // ── theme bg (mirrors ink.setSelectionBgColor) ──────────────────────────────

  setSelectionBgColor(color: string): void {
    // Parse the color the same way ink.setSelectionBgColor did: wrap a NUL,
    // colorize as a background, recover the open SGR, and translate it to RGBA.
    // A bad/empty color string → null → overlay falls back to inverse-ish (we
    // simply skip the bg swap, leaving the cell unchanged — same as "no bg yet").
    const rgba = parseBgColor(color)
    this.selectionBg = rgba
  }

  // ── mouse entry points (driven by the root onMouse in render.tsx) ───────────
  // Ported from App.handleMouseEvent. OpenTUI gives 0-indexed absolute x/y and a
  // decoded button + modifiers, so there's no SGR bit math or -1 conversion.

  onMouseDown(col: number, row: number, alt: boolean): void {
    this.ensureShadow()
    // Lost-release recovery: a fresh press while still dragging means the prior
    // release was dropped (cursor left the window). Finish it so copy-on-select
    // fires before startSelection clobbers the state.
    if (this.selection.isDragging) {
      finishSelection(this.selection)
      this.notify()
    }
    const now = Date.now()
    const nearLast =
      now - this.lastClickTime < MULTI_CLICK_TIMEOUT_MS &&
      Math.abs(col - this.lastClickCol) <= MULTI_CLICK_DISTANCE &&
      Math.abs(row - this.lastClickRow) <= MULTI_CLICK_DISTANCE
    this.clickCount = nearLast ? this.clickCount + 1 : 1
    this.lastClickTime = now
    this.lastClickCol = col
    this.lastClickRow = row

    if (this.clickCount >= 2 && this.screen) {
      // Double-click → word; triple+ → line. selectWordAt/selectLineAt set
      // anchorSpan so a subsequent drag extends by word/line (native macOS).
      const count = this.clickCount === 2 ? 2 : 3
      startSelection(this.selection, col, row)
      if (count === 2) selectWordAt(this.selection, this.screen, col, row)
      else selectLineAt(this.selection, this.screen, row)
      this.selection.lastPressHadAlt = alt
      this.notify()
      return
    }

    startSelection(this.selection, col, row)
    this.selection.lastPressHadAlt = alt
    this.notify()
  }

  onMouseDrag(col: number, row: number): void {
    if (!this.selection.isDragging) return
    this.ensureShadow()
    // Word/line mode (anchorSpan set) → mode-aware extension; else char mode.
    if (this.selection.anchorSpan && this.screen) {
      extendSelection(this.selection, this.screen, col, row)
    } else {
      updateSelection(this.selection, col, row)
    }
    this.notify()
  }

  onMouseUp(): void {
    if (!this.selection.isDragging) return
    finishSelection(this.selection)
    this.notify()
  }

  // ── clipboard (mirrors ink.copySelection*) ──────────────────────────────────

  copySelectionNoClear(): string {
    if (!engineHasSelection(this.selection) || !this.screen) return ''
    const text = getSelectedText(this.selection, this.screen)
    if (text) this.renderer.copyToClipboardOSC52(text)
    return text
  }

  copySelection(): string {
    if (!engineHasSelection(this.selection)) return ''
    const text = this.copySelectionNoClear()
    clearSelection(this.selection)
    this.notify()
    return text
  }

  clearTextSelection(): void {
    if (!engineHasSelection(this.selection)) return
    clearSelection(this.selection)
    this.notify()
  }

  // ── scroll / keyboard (Phase B; thin wrappers, engine unchanged) ────────────

  captureScrolledRows(
    firstRow: number,
    lastRow: number,
    side: 'above' | 'below',
  ): void {
    if (!this.screen) return
    engineCaptureScrolledRows(this.selection, this.screen, firstRow, lastRow, side)
  }

  shiftAnchor(dRow: number, minRow: number, maxRow: number): void {
    engineShiftAnchor(this.selection, dRow, minRow, maxRow)
  }

  /** Mirrors ink.shiftSelectionForScroll: shift anchor+focus (keyboard scroll),
   *  notifying React only if the shift auto-cleared the selection. */
  shiftSelectionForScroll(dRow: number, minRow: number, maxRow: number): void {
    if (!this.screen) return
    const had = engineHasSelection(this.selection)
    shiftSelection(this.selection, dRow, minRow, maxRow, this.screen.width)
    if (had && !engineHasSelection(this.selection)) this.notify()
  }

  /** Mirrors ink.moveSelectionFocus: clamp/wrap the focus against the shadow
   *  dims for a semantic keyboard move, then call the engine. */
  moveSelectionFocus(move: FocusMove): void {
    const { focus } = this.selection
    if (!focus || !this.screen) return
    const maxCol = this.screen.width - 1
    const maxRow = this.screen.height - 1
    let { col, row } = focus
    switch (move) {
      case 'left':
        if (col > 0) col--
        else if (row > 0) {
          col = maxCol
          row--
        }
        break
      case 'right':
        if (col < maxCol) col++
        else if (row < maxRow) {
          col = 0
          row++
        }
        break
      case 'up':
        if (row > 0) row--
        break
      case 'down':
        if (row < maxRow) row++
        break
      case 'lineStart':
        col = 0
        break
      case 'lineEnd':
        col = maxCol
        break
    }
    if (col === focus.col && row === focus.row) return
    moveFocus(this.selection, col, row)
    this.notify()
  }

  /** Streaming-follow translation (mirrors ink.tsx onRender follow block). Wired
   *  from the adapter ScrollBox's scroll callback when content auto-follows; the
   *  caller supplies the live viewport bounds. Fires listeners directly on
   *  auto-clear (cannot recurse into a render here). */
  onContentFollow(delta: number, viewportTop: number, viewportBottom: number): void {
    if (delta <= 0 || !this.selection.anchor || !this.screen) return
    // Only translate selections that sit on scrollbox content (mirror ink's
    // anchor-in-viewport guard) — footer/prompt selections must not be shifted.
    if (
      this.selection.anchor.row < viewportTop ||
      this.selection.anchor.row > viewportBottom
    ) {
      return
    }
    if (this.selection.isDragging) {
      if (engineHasSelection(this.selection)) {
        engineCaptureScrolledRows(
          this.selection,
          this.screen,
          viewportTop,
          viewportTop + delta - 1,
          'above',
        )
      }
      engineShiftAnchor(this.selection, -delta, viewportTop, viewportBottom)
    } else if (
      !this.selection.focus ||
      (this.selection.focus.row >= viewportTop &&
        this.selection.focus.row <= viewportBottom)
    ) {
      if (engineHasSelection(this.selection)) {
        engineCaptureScrolledRows(
          this.selection,
          this.screen,
          viewportTop,
          viewportTop + delta - 1,
          'above',
        )
      }
      const cleared = shiftSelectionForFollow(
        this.selection,
        -delta,
        viewportTop,
        viewportBottom,
      )
      if (cleared) for (const cb of this.listeners) cb()
    }
  }

  // ── per-frame: shadow refresh (during interaction) + overlay ────────────────

  private postProcess = (buffer: OptimizedBuffer): void => {
    // Cost control: only pay the getSpanLines + overlay cost while a selection is
    // active or being dragged. Idle frames early-return (matches forked-Ink's
    // "only while selActive" overlay cost).
    if (!engineHasSelection(this.selection) && !this.selection.isDragging) return
    this.buildShadow(buffer)
    this.applyOverlay(buffer)
  }

  /** Build the shadow Screen at click/drag time from the LAST fully-painted
   *  frame (currentRenderBuffer), so wordBoundsAt/selectLineAt have a populated
   *  grid to scan before the post-process pass runs for this interaction.
   *  nextRenderBuffer is the blank buffer about to be painted into — it carries
   *  no content yet, so reading it would scan an all-spaces grid (every cell the
   *  same char-class → a double-click would select the whole row). Mirrors
   *  forked-Ink, which scanned the completed frontFrame at click time. */
  private ensureShadow(): void {
    const r = this.renderer as unknown as {
      currentRenderBuffer?: OptimizedBuffer
      nextRenderBuffer?: OptimizedBuffer
    }
    const buffer = r.currentRenderBuffer ?? r.nextRenderBuffer
    if (buffer) this.buildShadow(buffer)
  }

  /** Reconstruct the cell-grid Screen from the final OptimizedBuffer. Decodes
   *  per-row text from getSpanLines (wide-char continuation cells already
   *  resolved to "") and reads the continuation flag from buffers.char to mark
   *  SpacerTail widths, then rasterizes the noSelect registry rects. */
  private buildShadow(buffer: OptimizedBuffer): void {
    const W = buffer.width
    const H = buffer.height
    if (W <= 0 || H <= 0) return
    if (!this.screen) {
      this.screen = createScreen(W, H, this.stylePool, this.charPool, this.hyperlinkPool)
    } else {
      // resetScreen clears cells/noSelect/softWrap and resizes if needed.
      resetScreen(this.screen, W, H)
    }
    const screen = this.screen
    const lines = buffer.getSpanLines()
    const { char } = buffer.buffers

    for (let y = 0; y < H; y++) {
      const line = lines[y]
      // Concatenate the row's spans, then split into codepoints. getSpanLines
      // already emits "" for wide-char continuation cells, so the codepoint
      // array is aligned to non-continuation cells.
      let rowText = ''
      if (line) for (const span of line.spans) rowText += span.text
      const cps = [...rowText]
      let cpi = 0
      for (let x = 0; x < W; x++) {
        const cp = char[y * W + x] ?? 0
        const isCont = (cp & CHAR_FLAG_MASK) === CHAR_FLAG_CONTINUATION
        if (isCont) {
          // Second cell of a wide char — record a SpacerTail so the engine's
          // wide-char handling (wordBoundsAt step-over, extractRowText skip)
          // works exactly as it did over forked-Ink's buffer.
          setCellAt(screen, x, y, {
            char: '',
            styleId: screen.emptyStyleId,
            width: CellWidth.SpacerTail,
            hyperlink: undefined,
          })
          continue
        }
        const ch = cps[cpi++] ?? ' '
        // Cells that decode to a multi-column grapheme occupy 2 cells; the next
        // cell carries the continuation flag, so mark this one Wide. Narrow
        // otherwise. (We can't read display width directly, but the continuation
        // flag on x+1 is the authoritative signal OpenTUI used.)
        const nextCont =
          x + 1 < W &&
          ((char[y * W + x + 1] ?? 0) & CHAR_FLAG_MASK) === CHAR_FLAG_CONTINUATION
        setCellAt(screen, x, y, {
          char: ch,
          styleId: screen.emptyStyleId,
          width: nextCont ? CellWidth.Wide : CellWidth.Narrow,
          hyperlink: undefined,
        })
      }
    }

    // noSelect: rasterize each live registered rect. fromLeftEdge widens the
    // left bound to column 0 (gutter exclusion). markNoSelectRegion clamps to
    // bounds. resetScreen already zeroed the bitmap.
    for (const { r, fromLeftEdge } of this.noSelectRegistry) {
      if (r.isDestroyed) continue
      const x0 = fromLeftEdge ? 0 : r.screenX
      const w = r.screenX + r.width - x0
      if (w <= 0 || r.height <= 0) continue
      markNoSelectRegion(screen, x0, r.screenY, w, r.height)
    }
    // softWrap stays all-zero (visual-line copy). See design §3.5 — full
    // softWrap derivation from the flat buffer is the documented stretch goal;
    // the all-zero fallback copies visual lines with hard newlines at wraps,
    // which still beats native (no rejoin either) and keeps noSelect at parity.
  }

  /** Paint the selection highlight over the final buffer: for each selected,
   *  non-noSelect cell, re-set the cell with the same char/fg/attrs but the
   *  selection bg. Reads char/fg/attrs back from the buffer's typed arrays. */
  private applyOverlay(buffer: OptimizedBuffer): void {
    const bg = this.selectionBg
    if (!bg || !this.screen) return
    const screen = this.screen
    const W = buffer.width
    const H = buffer.height
    const { char, fg, attributes } = buffer.buffers
    const noSelect = screen.noSelect

    const bounds = selectionBoundsLocal(this.selection)
    if (!bounds) return
    const { start, end } = bounds

    for (let row = Math.max(0, start.row); row <= end.row && row < H; row++) {
      const colStart = row === start.row ? start.col : 0
      const colEnd = row === end.row ? Math.min(end.col, W - 1) : W - 1
      const rowOff = row * W
      for (let col = Math.max(0, colStart); col <= colEnd; col++) {
        const idx = rowOff + col
        if (noSelect[idx] === 1) continue
        const cp = char[idx] ?? 0
        const isCont = (cp & CHAR_FLAG_MASK) === CHAR_FLAG_CONTINUATION
        if (isCont) continue // spacer tail; the wide head paints both columns
        // Decode the visible char. Strip the continuation flag bits (none here)
        // and map 0 → space (unwritten cell).
        const codepoint = cp & ~CHAR_FLAG_MASK
        const glyph = codepoint > 0 ? String.fromCodePoint(codepoint) : ' '
        const cellFg = RGBA.fromArray(fg.slice(idx * 4, idx * 4 + 4))
        const attrs = (attributes[idx] ?? 0) & 0xff
        buffer.setCell(col, row, glyph, cellFg, bg, attrs)
      }
    }
  }
}

/** Normalized selection bounds (start before end in reading order). Duplicated
 *  here because src/ink/selection.ts does not export selectionBounds. */
function selectionBoundsLocal(s: SelectionState): {
  start: { col: number; row: number }
  end: { col: number; row: number }
} | null {
  if (!s.anchor || !s.focus) return null
  const a = s.anchor
  const b = s.focus
  const aBeforeB =
    a.row < b.row || (a.row === b.row && a.col <= b.col)
  return aBeforeB ? { start: a, end: b } : { start: b, end: a }
}

/** Parse a theme color string to RGBA for the selection bg. The theme's
 *  selectionBg is one of clpzcode's Color forms (#hex / rgb() / ansi256() /
 *  ansi:name); toOpenTuiColor normalizes any of them to #rrggbb (the same
 *  palette the rest of the adapter renders), which RGBA.fromHex then parses.
 *  Returns null for an unparseable/empty color (overlay then leaves cells as-is). */
function parseBgColor(color: string): RGBA | null {
  if (!color) return null
  const hex = toOpenTuiColor(color as Parameters<typeof toOpenTuiColor>[0])
  if (!hex || !hex.startsWith('#')) return null
  try {
    return RGBA.fromHex(hex)
  } catch {
    return null
  }
}
