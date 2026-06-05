// src/ink-opentui/hooks-extra.tsx
//
// OpenTUI-backed reimplementation of the "remaining" clpzcode hooks that aren't
// covered by the other adapter modules (input/stdin/focus/theme live elsewhere).
// Same export surface the 643 components depend on via src/ink.ts, so they're
// drop-in:
//   useApp                       — { exit } backed by renderer.destroy()
//   useAnimationFrame            — KEEP Clock logic; only the viewport dep changes
//   useAnimationTimer/useInterval — KEEP verbatim (Clock-driven; renderer-agnostic)
//   useTerminalViewport          — REIMPLEMENTED on Renderable.screenY/height vs the
//                                  renderer's terminal-height bound (no yoga walk)
//   useTerminalTitle             — renderer.setTerminalTitle (keeps win32 path)
//   useTabStatus/supportsTabStatus — KEEP the pure OSC escape logic; only the write
//                                  sink moves to the renderer's stdout (process.stdout)
//   useSelection/useHasSelection — DEGRADED no-op stubs (real cell-grid selection is M3)
//
// Renderer access uses useRenderer() from @opentui/react; the AppContext that backs
// it is provided by render.tsx's createRoot, so these are safe in any mounted node.
//
// NOTE (DOMElement): callers attach the viewport/animation ref to a <Box ref={…}>,
// which forwards to the OpenTUI <box> intrinsic — so at runtime the ref value is a
// Renderable. We keep the Ink `DOMElement` type in the public signature for drop-in
// compat (same as themed.tsx) and treat the value as a Renderable at the boundary.

import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { CliRenderer, Renderable } from '@opentui/core'
import { useRenderer } from '@opentui/react'
import stripAnsi from 'strip-ansi'
import { controllerFor } from './render.js'

// KEEP code reused from the renderer-agnostic Ink source ───────────────────────
import { ClockContext } from '../ink/components/ClockContext.js'
import type { DOMElement } from '../ink/dom.js'
import {
  CLEAR_TAB_STATUS,
  supportsTabStatus,
  tabStatus,
  wrapForMultiplexer,
} from '../ink/termio/osc.js'
import type { Color } from '../ink/termio/types.js'
import type { TabStatusKind } from '../ink/hooks/use-tab-status.js'
import type { FocusMove, SelectionState } from '../ink/selection.js'

// Re-export the pure escape-string predicate + the public kind type unchanged so
// the barrel keeps the same surface. supportsTabStatus is renderer-independent.
export { supportsTabStatus } from '../ink/termio/osc.js'
export type { TabStatusKind } from '../ink/hooks/use-tab-status.js'

// AppContext is renderer-agnostic ({ exit }) — reuse it (and its Props type) so any
// component that reads it via useContext keeps working. useApp backs exit with the
// live renderer instead of an Ink-instance reference.
export { default as AppContext } from '../ink/components/AppContext.js'
export type { Props as AppProps } from '../ink/components/AppContext.js'

// ── write sink ─────────────────────────────────────────────────────────────────
// The renderer owns the TTY but exposes setTerminalTitle (used below) rather than a
// generic raw-write, so out-of-band OSC escapes (tab status) are written directly to
// the renderer's OWN stdout. CliRenderer types `stdout` as private, but it IS present
// at runtime and carries the stream render.tsx passed (verified). Reading it through
// this narrow accessor routes tab-status escapes to the SAME stream as the frames even
// under a custom opts.stdout (issue #22) — previously they hardcoded process.stdout,
// diverging from a non-process.stdout render. Falls back to process.stdout defensively.
function rendererStdout(renderer: CliRenderer): NodeJS.WriteStream {
  return (renderer as unknown as { stdout?: NodeJS.WriteStream }).stdout ?? process.stdout
}

// ── useApp (mirrors src/ink/hooks/use-app.ts) ──────────────────────────────────
// Ink read AppContext to get { exit }; here exit destroys the live renderer (which
// fires DESTROY → resolves waitUntilExit in render.tsx). Memoized so the returned
// object is stable across renders, matching Ink's context-value stability.
const useApp = (): { exit: (error?: Error) => void } => {
  const renderer = useRenderer()
  return useMemo(() => ({ exit: () => renderer.destroy() }), [renderer])
}
export default useApp

// ── useAnimationFrame (KEEP Clock logic; only the viewport dep changes) ─────────
// Identical body to src/ink/hooks/use-animation-frame.ts — the single divergence is
// that useTerminalViewport (below) is now Renderable-backed. Visible animations drive
// the shared clock (keepAlive:true); passing null unsubscribes and freezes time.
export function useAnimationFrame(
  intervalMs: number | null = 16,
): [ref: (element: DOMElement | null) => void, time: number] {
  const clock = useContext(ClockContext)
  const [viewportRef, { isVisible }] = useTerminalViewport()
  const [time, setTime] = useState(() => clock?.now() ?? 0)

  const active = isVisible && intervalMs !== null

  useEffect(() => {
    if (!clock || !active) return

    let lastUpdate = clock.now()

    const onChange = (): void => {
      const now = clock.now()
      if (now - lastUpdate >= intervalMs!) {
        lastUpdate = now
        setTime(now)
      }
    }

    return clock.subscribe(onChange, true)
  }, [clock, intervalMs, active])

  return [viewportRef, time]
}

// ── useAnimationTimer / useInterval (KEEP verbatim — Clock-driven, renderer-free) ──
// Both piggyback on the single shared ClockContext so all timers consolidate into one
// wake-up. Bodies copied unchanged from src/ink/hooks/use-interval.ts.
export function useAnimationTimer(intervalMs: number): number {
  const clock = useContext(ClockContext)
  const [time, setTime] = useState(() => clock?.now() ?? 0)

  useEffect(() => {
    if (!clock) return

    let lastUpdate = clock.now()

    const onChange = (): void => {
      const now = clock.now()
      if (now - lastUpdate >= intervalMs) {
        lastUpdate = now
        setTime(now)
      }
    }

    return clock.subscribe(onChange, false)
  }, [clock, intervalMs])

  return time
}

export function useInterval(
  callback: () => void,
  intervalMs: number | null,
): void {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  const clock = useContext(ClockContext)

  useEffect(() => {
    if (!clock || intervalMs === null) return

    let lastUpdate = clock.now()

    const onChange = (): void => {
      const now = clock.now()
      if (now - lastUpdate >= intervalMs) {
        lastUpdate = now
        callbackRef.current()
      }
    }

    return clock.subscribe(onChange, false)
  }, [clock, intervalMs])
}

// ── useTerminalViewport (REIMPLEMENTED on Renderable coordinates) ───────────────
// Same contract as src/ink/hooks/use-terminal-viewport.ts: returns [callbackRef,
// entry], updates the entry during layout (no setState → no cascading re-renders),
// callers read fresh values on their own re-renders.
//
// The Ink version walked the yoga ancestor chain and hand-rolled scrollTop + the
// log-update cursor-restore correction to compute an absolute top. OpenTUI does all
// of that for us: Renderable.screenY is the final absolute screen row (post-layout,
// post-scroll), and the renderer's own viewport is simply [0, terminalHeight). So
// visibility collapses to a plain on-screen interval test against the renderer bound.

type ViewportEntry = {
  /** Whether the element is currently within the terminal viewport. */
  isVisible: boolean
}

export function useTerminalViewport(): [
  ref: (element: DOMElement | null) => void,
  entry: ViewportEntry,
] {
  const renderer = useRenderer()
  // Runtime value is the OpenTUI Renderable the <box> ref resolves to; the public
  // type stays DOMElement for drop-in compat.
  const elementRef = useRef<Renderable | null>(null)
  const entryRef = useRef<ViewportEntry>({ isVisible: true })

  const setElement = useCallback((el: DOMElement | null) => {
    elementRef.current = el as unknown as Renderable | null
  }, [])

  // Runs on every render (layout values can change without React knowing). Only
  // mutates the ref — never setState — to avoid commit-phase re-render loops.
  useLayoutEffect(() => {
    const element = elementRef.current
    if (!element) return

    const top = element.screenY
    const bottom = top + element.height
    // renderer.height (not terminalHeight) to match TerminalSizeContext — the
    // visibility test must use the same height the size provider tracks.
    const viewportBottom = renderer.height

    const visible = bottom > 0 && top < viewportBottom

    if (visible !== entryRef.current.isVisible) {
      entryRef.current = { isVisible: visible }
    }
  })

  return [setElement, entryRef.current]
}

// ── useTerminalTitle (renderer.setTerminalTitle; keep win32 path) ───────────────
// Declaratively set the tab/window title. ANSI is stripped so callers don't deal
// with encoding. null = no-op (leaves the title untouched). On Windows we still use
// process.title (classic conhost ignores OSC); elsewhere the renderer owns the title.
export function useTerminalTitle(title: string | null): void {
  const renderer = useRenderer()

  useEffect(() => {
    if (title === null) return

    const clean = stripAnsi(title)

    if (process.platform === 'win32') {
      process.title = clean
    } else {
      renderer.setTerminalTitle(clean)
    }
  }, [title, renderer])
}

// ── useTabStatus (KEEP OSC logic; sink → renderer stdout) ───────────────────────
// Declaratively set the OSC 21337 tab-status indicator. The escape-string builders
// (tabStatus / CLEAR_TAB_STATUS / wrapForMultiplexer / supportsTabStatus) are reused
// unchanged from osc.ts; only the write target moves from Ink's App.writeRaw to the
// renderer's stdout. Terminals that don't support OSC 21337 discard it silently.
//
// null opts out; a non-null→null transition emits CLEAR_TAB_STATUS so toggling off
// mid-session doesn't leave a stale dot. Body mirrors src/ink/hooks/use-tab-status.ts.

const rgb = (r: number, g: number, b: number): Color => ({
  type: 'rgb',
  r,
  g,
  b,
})

// Per the OSC 21337 usage guide's suggested mapping (copied from Ink — pure data).
const TAB_STATUS_PRESETS: Record<
  TabStatusKind,
  { indicator: Color; status: string; statusColor: Color }
> = {
  idle: {
    indicator: rgb(0, 215, 95),
    status: 'Idle',
    statusColor: rgb(136, 136, 136),
  },
  busy: {
    indicator: rgb(255, 149, 0),
    status: 'Working…',
    statusColor: rgb(255, 149, 0),
  },
  waiting: {
    indicator: rgb(95, 135, 255),
    status: 'Waiting',
    statusColor: rgb(95, 135, 255),
  },
}

export function useTabStatus(kind: TabStatusKind | null): void {
  const renderer = useRenderer()
  const prevKindRef = useRef<TabStatusKind | null>(null)

  useEffect(() => {
    // Write tab-status OSC to the renderer's own stdout so it lands on the same
    // stream as the frames even under a custom opts.stdout (issue #22).
    const out = rendererStdout(renderer)
    if (kind === null) {
      if (prevKindRef.current !== null && supportsTabStatus()) {
        out.write(wrapForMultiplexer(CLEAR_TAB_STATUS))
      }
      prevKindRef.current = null
      return
    }

    prevKindRef.current = kind
    if (!supportsTabStatus()) return
    out.write(wrapForMultiplexer(tabStatus(TAB_STATUS_PRESETS[kind])))
  }, [kind, renderer])
}

// ── useSelection / useHasSelection (M3: controller-backed cell-grid selection) ──
// These proxy to the live SelectionController (selection-controller.ts) the same
// way the forked-Ink versions proxied to the Ink instance's selection engine. The
// controller hosts the UNCHANGED engine (src/ink/selection.ts) over a per-frame
// shadow Screen built from OpenTUI's final buffer (PATH 1; see
// docs/M3-SELECTION-DESIGN.md). The return shape is byte-for-byte identical to
// src/ink/hooks/use-selection.ts, so ScrollKeybindingHandler, useCopyOnSelect, and
// PromptInputFooterLeftSide stay drop-in. controllerFor(renderer) resolves the
// instance's controller; a null controller (no live instance) yields the no-op
// surface so callers never crash.

const NOOP_SELECTION = {
  copySelection: () => '',
  copySelectionNoClear: () => '',
  clearSelection: () => {},
  hasSelection: () => false,
  getState: () => null as SelectionState | null,
  subscribe: () => () => {},
  shiftAnchor: () => {},
  shiftSelection: () => {},
  moveFocus: () => {},
  captureScrolledRows: () => {},
  setSelectionBgColor: () => {},
} as const

const NO_SUBSCRIBE = (): (() => void) => () => {}
const ALWAYS_FALSE = (): boolean => false

// Signature mirrors src/ink/hooks/use-selection.ts exactly so callers that thread
// ReturnType<typeof useSelection> through helpers (e.g. ScrollKeybindingHandler's
// getState → SelectionState, moveFocus → FocusMove) still typecheck.
export function useSelection(): {
  copySelection: () => string
  copySelectionNoClear: () => string
  clearSelection: () => void
  hasSelection: () => boolean
  getState: () => SelectionState | null
  subscribe: (cb: () => void) => () => void
  shiftAnchor: (dRow: number, minRow: number, maxRow: number) => void
  shiftSelection: (dRow: number, minRow: number, maxRow: number) => void
  moveFocus: (move: FocusMove) => void
  captureScrolledRows: (
    firstRow: number,
    lastRow: number,
    side: 'above' | 'below',
  ) => void
  setSelectionBgColor: (color: string) => void
} {
  const renderer = useRenderer()
  // Memoized on the renderer (a singleton per process) so the returned object is
  // a stable identity across renders — matching the Ink hook's `[ink]` memo, so
  // callers can safely place it in dependency arrays.
  return useMemo(() => {
    const ctrl = controllerFor(renderer)
    if (!ctrl) return NOOP_SELECTION
    return {
      copySelection: () => ctrl.copySelection(),
      copySelectionNoClear: () => ctrl.copySelectionNoClear(),
      clearSelection: () => ctrl.clearTextSelection(),
      hasSelection: () => ctrl.hasSelection(),
      getState: () => ctrl.getState(),
      subscribe: (cb: () => void) => ctrl.subscribe(cb),
      shiftAnchor: (dRow: number, minRow: number, maxRow: number) =>
        ctrl.shiftAnchor(dRow, minRow, maxRow),
      shiftSelection: (dRow: number, minRow: number, maxRow: number) =>
        ctrl.shiftSelectionForScroll(dRow, minRow, maxRow),
      moveFocus: (move: FocusMove) => ctrl.moveSelectionFocus(move),
      captureScrolledRows: (
        firstRow: number,
        lastRow: number,
        side: 'above' | 'below',
      ) => ctrl.captureScrolledRows(firstRow, lastRow, side),
      setSelectionBgColor: (color: string) => ctrl.setSelectionBgColor(color),
    }
  }, [renderer])
}

// Reactive "selection exists" — re-renders the caller when a selection is
// created/cleared. Mirrors src/ink/hooks/use-selection.ts's useSyncExternalStore
// wiring (stable subscribe/getSnapshot from the controller).
export function useHasSelection(): boolean {
  const renderer = useRenderer()
  const ctrl = controllerFor(renderer)
  return useSyncExternalStore(
    ctrl ? ctrl.subscribe : NO_SUBSCRIBE,
    ctrl ? ctrl.hasSelection : ALWAYS_FALSE,
  )
}
