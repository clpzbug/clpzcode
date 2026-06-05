// src/ink-opentui/focus-events.tsx
//
// OpenTUI-backed events + focus surface for the Ink→OpenTUI adapter. Two halves:
//
//   1. KEEP (re-exported as-is): the renderer-agnostic event value types the 643
//      components import via src/ink.ts — Event, EventEmitter, ClickEvent,
//      FocusEvent, TerminalFocusEvent (+ TerminalFocusEventType). These are pure
//      data classes with no DOM/renderer coupling, so they survive the migration
//      unchanged; re-exporting keeps a single source of truth.
//
//   2. RETARGETED to OpenTUI: FocusManager + focus(node), useTerminalFocus, and a
//      self-contained wireBoxEvents() helper the Box adapter uses to translate
//      Ink's onClick/onMouseEnter/onMouseLeave/onFocus/onBlur/tabIndex/autoFocus
//      props into OpenTUI <box> props.
//
// Divergences from src/ink/focus.ts (PoC-verified, see OPENTUI-ADAPTER-SPEC §M1):
//   - Node refs are OpenTUI `Renderable`s, not Ink `DOMElement`s. Tree walks use
//     renderable.getChildren()/renderable.parent (Ink used childNodes/parentNode).
//   - Renderables have no Ink-style `attributes.tabIndex`; the Box helper records
//     tabIndex/autoFocus in a module-level WeakMap that the traversal reads.
//   - focus()/blur() additionally sync the renderer's own focus pointer via
//     focusRenderable()/blurRenderable() so OpenTUI's <input>/<select> focus
//     highlighting stays consistent with our DOM-style focus stack.
//   - SINGLE focus-event path: Box onFocus/onBlur live in a module WeakMap
//     (the focusHandlers registry, the OpenTUI analogue of Ink's
//     node._eventHandlers) and fire ONLY via the FocusManager's
//     dispatchFocusEvent. We do NOT subscribe Box handlers to the renderable's
//     RenderableEvents.FOCUSED/BLURRED — renderer.focusRenderable() never emits
//     those for manager-driven focus, so doing so would be a dead path (and the
//     renderer's internal auto-blur of the previous node would double-fire blur).
//   - OpenTUI MouseEvent has no press+release pairing, so onClick is synthesized
//     here from a down→up sequence on the same renderable (no intervening drag).

import { useEffect, useSyncExternalStore } from 'react'
import {
  CliRenderEvents,
  RenderableEvents,
  type CliRenderer,
  type KeyEvent,
  type MouseEvent as OpenTuiMouseEvent,
  type Renderable,
} from '@opentui/core'
import { useRenderer } from '@opentui/react'

// ── KEEP: renderer-agnostic event classes (single source of truth) ────────────
// Re-exported verbatim from the stable ink/ source so src/ink.ts and the 643
// components resolve the SAME class identities they always have.
export { Event } from '../ink/events/event.js'
export { EventEmitter } from '../ink/events/emitter.js'
export { ClickEvent } from '../ink/events/click-event.js'
export { FocusEvent } from '../ink/events/focus-event.js'
export { TerminalFocusEvent } from '../ink/events/terminal-focus-event.js'
export type { TerminalFocusEventType } from '../ink/events/terminal-focus-event.js'

import { ClickEvent } from '../ink/events/click-event.js'
import { FocusEvent } from '../ink/events/focus-event.js'
import { KeyboardEvent } from '../ink/events/keyboard-event.js'
import type { EventTarget as EventTargetShape } from '../ink/events/terminal-event.js'
import { logError } from '../utils/log.js'
import { toParsedKey } from './input.js'
import {
  getTerminalFocused,
  setTerminalFocused,
  subscribeTerminalFocus,
} from '../ink/terminal-focus-state.js'

// ── FocusManager (retargeted from src/ink/focus.ts) ────────────────────────────

const MAX_FOCUS_STACK = 32

// Per-renderable focus metadata. Renderables don't carry Ink's
// `attributes.tabIndex`, so the Box helper records it here and the tab-order
// traversal reads it. WeakMap so entries vanish when renderables are GC'd.
const tabIndexes = new WeakMap<Renderable, number>()

/** Record/clear a renderable's tabIndex for the FocusManager traversal. */
export function setTabIndex(node: Renderable, tabIndex: number | undefined): void {
  if (typeof tabIndex === 'number') {
    tabIndexes.set(node, tabIndex)
  } else {
    tabIndexes.delete(node)
  }
}

// Per-renderable Ink focus/blur handlers. This is the OpenTUI analogue of Ink's
// `node._eventHandlers['onFocus'/'onBlur']`: the SINGLE place focus/blur Box
// handlers live, read by the FocusManager's dispatchFocusEvent. Crucially this is
// NOT the renderable's own RenderableEvents.FOCUSED/BLURRED emitter — that fires
// only when a renderable calls its own .focus()/.blur() (native <input>/<select>
// self-focus), and renderer.focusRenderable() does NOT emit it. Routing the Box
// handlers here (not through RenderableEvents) gives manager-driven focus a single,
// always-firing path and avoids the double-blur the renderer's internal auto-blur
// of the previous node would otherwise cause. WeakMap so entries vanish on GC.
type FocusHandlers = {
  onFocus?: (event: FocusEvent) => void
  onBlur?: (event: FocusEvent) => void
}
const focusHandlers = new WeakMap<Renderable, FocusHandlers>()

/** Record/clear a renderable's Ink onFocus/onBlur handlers for the manager. */
export function setFocusHandlers(node: Renderable, handlers: FocusHandlers): void {
  if (handlers.onFocus || handlers.onBlur) {
    focusHandlers.set(node, handlers)
  } else {
    focusHandlers.delete(node)
  }
}

// Per-renderable Ink onKeyDown/onKeyDownCapture — the OpenTUI analogue of Ink's
// node._eventHandlers['onKeyDown'/'onKeyDownCapture']. The Box adapter dropped these
// (no <box> analogue), leaving 27 `<Box tabIndex autoFocus onKeyDown>` dialogs/pickers
// dead to the keyboard. dispatchKeydown() bubbles a KeyboardEvent through the focused
// node's ancestor chain reading this map, replicating the forked Dispatcher (#31).
type KeyboardEventHandler = (event: KeyboardEvent) => void
type KeyHandlers = {
  onKeyDown?: KeyboardEventHandler
  onKeyDownCapture?: KeyboardEventHandler
}
const keyHandlers = new WeakMap<Renderable, KeyHandlers>()

/** Record/clear a renderable's Ink onKeyDown/onKeyDownCapture for dispatchKeydown. */
export function setKeyHandlers(node: Renderable, handlers: KeyHandlers): void {
  if (handlers.onKeyDown || handlers.onKeyDownCapture) {
    keyHandlers.set(node, handlers)
  } else {
    keyHandlers.delete(node)
  }
}

// Two-phase keydown dispatch over OpenTUI Renderables, faithful to the forked
// Dispatcher (collectListeners + processDispatchQueue): capture root→target, then
// bubble target→root, honoring stop/immediate-propagation and the at_target rule
// (a node's capture+bubble both run even after stopPropagation, breaking only when
// the node changes). Returns false if a handler called preventDefault().
export function dispatchKeydown(target: Renderable, event: KeyboardEvent): boolean {
  event._setTarget(target as unknown as EventTargetShape)

  const listeners: { node: Renderable; handler: KeyboardEventHandler; phase: 'capturing' | 'at_target' | 'bubbling' }[] = []
  let node: Renderable | null = target
  while (node) {
    const isTarget = node === target
    const hs = keyHandlers.get(node)
    if (hs?.onKeyDownCapture) {
      listeners.unshift({ node, handler: hs.onKeyDownCapture, phase: isTarget ? 'at_target' : 'capturing' })
    }
    if (hs?.onKeyDown) {
      // keydown bubbles (KeyboardEvent sets bubbles:true), so every ancestor's
      // onKeyDown is in the bubble phase; the target's own is at_target.
      listeners.push({ node, handler: hs.onKeyDown, phase: isTarget ? 'at_target' : 'bubbling' })
    }
    node = node.parent
  }

  let previousNode: Renderable | undefined
  for (const { node: n, handler, phase } of listeners) {
    if (event._isImmediatePropagationStopped()) break
    if (event._isPropagationStopped() && n !== previousNode) break
    event._setEventPhase(phase)
    event._setCurrentTarget(n as unknown as EventTargetShape)
    event._prepareForTarget(n as unknown as EventTargetShape)
    try {
      handler(event)
    } catch (error) {
      logError(error)
    }
    previousNode = n
  }
  event._setEventPhase('none')
  event._setCurrentTarget(null)
  return !event.defaultPrevented
}

// Default dispatchFocusEvent: invoke the target renderable's registered Ink
// onFocus/onBlur. Mirrors Ink, where the FocusManager dispatched through the
// Dispatcher into node._eventHandlers. Returns true (preventDefault is meaningless
// for focus/blur — they are not cancelable; see FocusEvent's cancelable:false).
//
// Note on bubbling: Ink's FocusEvent bubbles via the Dispatcher's parent walk.
// No clpzcode component relies on ancestor-observed Box focus bubbling (the focus
// hooks read activeElement directly), so this fires only the target's own handler.
// If a future component needs bubbling, walk node.parent here reading focusHandlers.
function defaultDispatchFocusEvent(target: Renderable, event: FocusEvent): boolean {
  const handlers = focusHandlers.get(target)
  const handler = event.type === 'focus' ? handlers?.onFocus : handlers?.onBlur
  handler?.(event)
  return true
}

// FocusEvent.relatedTarget is typed as the Ink-DOM EventTarget ({ parentNode }),
// but on OpenTUI the "other node" in a focus transition is a Renderable (it has
// `parent`, not `parentNode`). No clpzcode component reads relatedTarget — it
// exists only for DOM-event fidelity — so we pass the Renderable through as the
// opaque node reference it semantically is. This is the single intentional shape
// cast required by the retarget; localized here so the call sites stay clean.
function focusEvent(type: 'focus' | 'blur', related: Renderable | null): FocusEvent {
  return new FocusEvent(type, related as unknown as EventTargetShape)
}

/**
 * DOM-like focus manager, retargeted to OpenTUI Renderables.
 *
 * Pure state — tracks activeElement and a focus stack. Has no reference to the
 * tree; callers pass the root when tree walks are needed. Mirrors the exact
 * traversal ALGORITHM of src/ink/focus.ts (dedup-on-push, MAX_FOCUS_STACK cap,
 * wrap-around moveFocus, subtree-aware handleNodeRemoved).
 *
 * The renderer (optional) lets focus()/blur() sync OpenTUI's own focus pointer
 * so native focusable renderables (<input>, <select>) highlight correctly.
 *
 * dispatchFocusEvent defaults to defaultDispatchFocusEvent, which routes into the
 * per-renderable focusHandlers registry (set by wireBoxEvents). This is the SINGLE
 * focus-event path — there is no separate RenderableEvents.FOCUSED/BLURRED wiring
 * for Box handlers — so manager-driven focus (Tab, autoFocus, click) always reaches
 * the Ink onFocus/onBlur handlers, and the renderer's internal auto-blur of the
 * previous node never double-fires them.
 */
export class FocusManager {
  activeElement: Renderable | null = null
  private dispatchFocusEvent: (target: Renderable, event: FocusEvent) => boolean
  private renderer: CliRenderer | null
  private enabled = true
  private focusStack: Renderable[] = []
  // Disposer for the DESTROYED listener on the current activeElement (issue #7).
  private activeDestroyOff: (() => void) | null = null

  constructor(
    dispatchFocusEvent: (
      target: Renderable,
      event: FocusEvent,
    ) => boolean = defaultDispatchFocusEvent,
    renderer: CliRenderer | null = null,
  ) {
    this.dispatchFocusEvent = dispatchFocusEvent
    this.renderer = renderer
  }

  // Sync OpenTUI's native focus to a node (issue #16). PREFER the renderable's OWN
  // .focus() over renderer.focusRenderable(): only renderable.focus() installs the
  // keypress/paste routing (so a focused Button's onKeyDown fires) AND emits
  // RenderableEvents.FOCUSED (so Button's focus-state machine updates). It also
  // internally calls _ctx.focusRenderable(this) (and blurs the previously-focused
  // renderable), so the renderer pointer stays in sync. Non-focusable nodes (plain
  // Boxes without tabIndex) fall back to the pointer-only sync. Idempotent: the
  // renderable guards `if (this._focused) return`.
  private focusNative(node: Renderable): void {
    const focusable = (node as { focusable?: boolean }).focusable
    const focusFn = (node as { focus?: () => void }).focus
    if (focusable && typeof focusFn === 'function') focusFn.call(node)
    else this.renderer?.focusRenderable(node)
  }

  private blurNative(node: Renderable): void {
    const blurFn = (node as { blur?: () => void; focused?: boolean }).blur
    if ((node as { focused?: boolean }).focused && typeof blurFn === 'function') {
      blurFn.call(node)
    } else {
      this.renderer?.blurRenderable(node)
    }
  }

  // Watch the current activeElement for tree removal: OpenTUI's destroy() emits
  // DESTROYED before it detaches/blurs, and destroyRecursively() destroys children
  // first — so a focused node (or a focused descendant of a removed subtree) always
  // fires its own DESTROYED, letting us blur + restore focus from the stack (#7).
  private watchActiveDestroy(): void {
    this.clearActiveDestroy()
    const node = this.activeElement
    if (!node) return
    const onDestroy = (): void => {
      this.activeDestroyOff = null
      const root =
        (this.renderer?.root as unknown as Renderable | undefined) ?? topAncestor(node)
      this.handleNodeRemoved(node, root)
    }
    node.once(RenderableEvents.DESTROYED, onDestroy)
    this.activeDestroyOff = () => node.off(RenderableEvents.DESTROYED, onDestroy)
  }

  private clearActiveDestroy(): void {
    this.activeDestroyOff?.()
    this.activeDestroyOff = null
  }

  focus(node: Renderable): void {
    if (node === this.activeElement) return
    if (!this.enabled) return

    const previous = this.activeElement
    if (previous) {
      // Deduplicate before pushing to prevent unbounded growth from Tab cycling
      const idx = this.focusStack.indexOf(previous)
      if (idx !== -1) this.focusStack.splice(idx, 1)
      this.focusStack.push(previous)
      if (this.focusStack.length > MAX_FOCUS_STACK) this.focusStack.shift()
      // Ink onBlur (registry) for the previous node. The renderable-level BLURRED
      // of `previous` is emitted by node.focus()'s internal _ctx.focusRenderable →
      // previous.blur() below, so we do NOT blur it here (no double-fire).
      this.dispatchFocusEvent(previous, focusEvent('blur', node))
    }
    this.activeElement = node
    this.watchActiveDestroy()
    this.focusNative(node)
    this.dispatchFocusEvent(node, focusEvent('focus', previous))
  }

  blur(): void {
    if (!this.activeElement) return

    const previous = this.activeElement
    this.activeElement = null
    this.clearActiveDestroy()
    this.blurNative(previous)
    this.dispatchFocusEvent(previous, focusEvent('blur', null))
  }

  /**
   * Called when a node is removed from the tree. Handles both the exact node and
   * any focused descendant within the removed subtree. Dispatches blur and
   * restores focus from the stack.
   */
  handleNodeRemoved(node: Renderable, root: Renderable): void {
    // Remove the node and any descendants from the stack
    this.focusStack = this.focusStack.filter(
      n => n !== node && isInTree(n, root),
    )

    // Check if activeElement is the removed node OR a descendant
    if (!this.activeElement) return
    if (this.activeElement !== node && isInTree(this.activeElement, root)) {
      return
    }

    const removed = this.activeElement
    this.activeElement = null
    this.clearActiveDestroy()
    this.blurNative(removed)
    this.dispatchFocusEvent(removed, focusEvent('blur', null))

    // Restore focus to the most recent still-mounted element
    while (this.focusStack.length > 0) {
      const candidate = this.focusStack.pop()!
      if (isInTree(candidate, root)) {
        this.activeElement = candidate
        this.watchActiveDestroy()
        this.focusNative(candidate)
        this.dispatchFocusEvent(candidate, focusEvent('focus', removed))
        return
      }
    }
  }

  handleAutoFocus(node: Renderable): void {
    this.focus(node)
  }

  handleClickFocus(node: Renderable): void {
    if (typeof tabIndexes.get(node) !== 'number') return
    this.focus(node)
  }

  enable(): void {
    this.enabled = true
  }

  disable(): void {
    this.enabled = false
  }

  focusNext(root: Renderable): void {
    this.moveFocus(1, root)
  }

  focusPrevious(root: Renderable): void {
    this.moveFocus(-1, root)
  }

  private moveFocus(direction: 1 | -1, root: Renderable): void {
    if (!this.enabled) return

    const tabbable = collectTabbable(root)
    if (tabbable.length === 0) return

    const currentIndex = this.activeElement
      ? tabbable.indexOf(this.activeElement)
      : -1

    const nextIndex =
      currentIndex === -1
        ? direction === 1
          ? 0
          : tabbable.length - 1
        : (currentIndex + direction + tabbable.length) % tabbable.length

    const next = tabbable[nextIndex]
    if (next) {
      this.focus(next)
    }
  }
}

function collectTabbable(root: Renderable): Renderable[] {
  const result: Renderable[] = []
  walkTree(root, result)
  return result
}

function walkTree(node: Renderable, result: Renderable[]): void {
  const tabIndex = tabIndexes.get(node)
  if (typeof tabIndex === 'number' && tabIndex >= 0) {
    result.push(node)
  }

  for (const child of node.getChildren()) {
    walkTree(child, result)
  }
}

function isInTree(node: Renderable, root: Renderable): boolean {
  let current: Renderable | null = node
  while (current) {
    if (current === root) return true
    current = current.parent
  }
  return false
}

// Topmost still-attached ancestor — the fallback "root" for handleNodeRemoved when
// no renderer is bound (DESTROYED fires before destroy() detaches, so parent is live).
function topAncestor(node: Renderable): Renderable {
  let current = node
  while (current.parent) current = current.parent
  return current
}

/**
 * Programmatically focus a renderable through its owning FocusManager.
 *
 * Mirrors the standalone focus(node) the Ink components import: walk up to the
 * root that owns a FocusManager and delegate. Returns false (no-op) if the node
 * isn't attached to a tree with a manager yet.
 */
const managers = new WeakMap<Renderable, FocusManager>()

/**
 * Attach a FocusManager to a root renderable.
 *
 * PRECONDITION for the render/reconciler layer: this MUST be called with the root
 * renderable once the tree is mounted, or focus(node)/autoFocus/Tab navigation are
 * inert (getFocusManager walks up to find this entry and returns null otherwise).
 * Not yet called anywhere — the reconciler/render layer that owns the root wires it.
 */
export function setFocusManager(root: Renderable, manager: FocusManager): void {
  managers.set(root, manager)
}

/** Walk up to the root that owns a FocusManager; null if none is attached. */
export function getFocusManager(node: Renderable): FocusManager | null {
  let current: Renderable | null = node
  while (current) {
    const manager = managers.get(current)
    if (manager) return manager
    current = current.parent
  }
  return null
}

export function focus(node: Renderable): boolean {
  const manager = getFocusManager(node)
  if (!manager) return false
  manager.focus(node)
  return true
}

// ── render-layer wiring (issue #15) ─────────────────────────────────────────────
//
// The Ink class created ONE FocusManager and attached it to the root node, then its
// dispatchKeyboardEvent drove focusNext/focusPrevious on Tab/Shift+Tab (ink.tsx).
// OpenTUI has no such owner, so the render layer (render.tsx) calls this once per
// renderer: it creates a FocusManager bound to the renderer (for native <input>/
// <select> focus sync), registers it on renderer.root so getFocusManager()/focus()/
// autoFocus resolve, and subscribes Tab/Shift+Tab on renderer.keyInput to cycle focus.
//
// It also drives onKeyDown/onKeyDownCapture dispatch: each keypress bubbles a
// KeyboardEvent through the focused node's ancestor chain (the forked
// dispatchKeyboardEvent), so `<Box tabIndex autoFocus onKeyDown>` dialogs work.
// Tab cycling is the DEFAULT action, gated on !preventDefault — a handler can
// preventDefault() to keep Tab (matches Ink). Ctrl/Meta+Tab are left for the
// terminal/app. Returns a disposer the render layer calls on renderer destroy.
export function wireFocusManager(renderer: CliRenderer): () => void {
  const manager = new FocusManager(undefined, renderer)
  setFocusManager(renderer.root as unknown as Renderable, manager)

  const onKeypress = (e: KeyEvent): void => {
    if (e.eventType === 'release') return
    const root = renderer.root as unknown as Renderable
    const target = manager.activeElement ?? root
    const event = new KeyboardEvent(toParsedKey(e))
    dispatchKeydown(target, event)
    // Tab cycling is the default action — only if no handler called preventDefault().
    if (!event.defaultPrevented && e.name === 'tab' && !e.ctrl && !e.meta) {
      if (e.shift) manager.focusPrevious(root)
      else manager.focusNext(root)
    }
  }
  renderer.keyInput.on('keypress', onKeypress)

  return () => {
    renderer.keyInput.off('keypress', onKeypress)
    managers.delete(renderer.root as unknown as Renderable)
  }
}

// ── useTerminalFocus (retargeted from src/ink/hooks/use-terminal-focus.ts) ─────
//
// Original read a React Context fed by TerminalFocusProvider's useSyncExternalStore
// over the DECSET-1004 store. On OpenTUI the terminal-focus signal arrives as the
// renderer's CliRenderEvents.FOCUS/BLUR events, so this hook ALSO bridges those
// renderer events into the same store (setTerminalFocused). It still reads via
// useSyncExternalStore so the value stays identical and components are drop-in.
//
// Bridge ownership: rather than each consumer adding its own FOCUS/BLUR listener
// pair (N redundant store writes per focus event in the original review draft), a
// module-level refcount installs exactly ONE listener pair on the first mounted
// consumer and removes it when the last unmounts. This keeps the hook self-
// contained (no dependency on a render-layer provider) while matching the original
// single-bridge model. Keyed by renderer so a renderer swap re-bridges correctly.

const bridgeRefcounts = new WeakMap<CliRenderer, number>()
const bridgeDisposers = new WeakMap<CliRenderer, () => void>()

function acquireTerminalFocusBridge(renderer: CliRenderer): () => void {
  const count = bridgeRefcounts.get(renderer) ?? 0
  if (count === 0) {
    const onFocus = (): void => setTerminalFocused(true)
    const onBlur = (): void => setTerminalFocused(false)
    renderer.on(CliRenderEvents.FOCUS, onFocus)
    renderer.on(CliRenderEvents.BLUR, onBlur)
    bridgeDisposers.set(renderer, () => {
      renderer.off(CliRenderEvents.FOCUS, onFocus)
      renderer.off(CliRenderEvents.BLUR, onBlur)
    })
  }
  bridgeRefcounts.set(renderer, count + 1)

  return () => {
    const next = (bridgeRefcounts.get(renderer) ?? 1) - 1
    if (next <= 0) {
      bridgeRefcounts.delete(renderer)
      bridgeDisposers.get(renderer)?.()
      bridgeDisposers.delete(renderer)
    } else {
      bridgeRefcounts.set(renderer, next)
    }
  }
}

/**
 * Returns true if the terminal window has focus (or focus state is unknown).
 *
 * Bridges OpenTUI's renderer focus/blur events into the existing terminal-focus
 * store (once, refcounted across consumers) and subscribes to it, matching the
 * original hook's contract.
 */
export function useTerminalFocus(): boolean {
  const renderer = useRenderer()

  useEffect(() => acquireTerminalFocusBridge(renderer), [renderer])

  return useSyncExternalStore(subscribeTerminalFocus, getTerminalFocused)
}

// ── Box event/focus wiring helper ──────────────────────────────────────────────
//
// Translates Ink's Box event/focus props into OpenTUI <box> renderable props.
// Self-contained: the Box adapter spreads the returned record onto the <box>.
//   onClick        ← synthesized from onMouseDown→onMouseUp on the same node
//   onMouseEnter   ← onMouseOver
//   onMouseLeave   ← onMouseOut
//   onFocus/onBlur → recorded in the focusHandlers registry; fired by the
//                    FocusManager's dispatchFocusEvent (the single focus path).
//   tabIndex/autoFocus → recorded for the FocusManager (focusable + auto-focus)

type InkClickHandler = (event: ClickEvent) => void
type InkFocusHandler = (event: FocusEvent) => void
type InkHoverHandler = () => void

export type BoxEventProps = {
  onClick?: InkClickHandler
  onMouseEnter?: InkHoverHandler
  onMouseLeave?: InkHoverHandler
  onFocus?: InkFocusHandler
  onBlur?: InkFocusHandler
  onKeyDown?: KeyboardEventHandler
  onKeyDownCapture?: KeyboardEventHandler
  tabIndex?: number
  autoFocus?: boolean
}

// Left button in OpenTUI's MouseButton enum.
const MOUSE_BUTTON_LEFT = 0

// In-flight click press state keyed on the RENDERABLE (stable across re-renders),
// NOT the per-render wireBoxEvents closure. A re-render landing between mouse-down
// and mouse-up would otherwise rebuild the closure with pressed=false and silently
// drop the click. OpenTUI invokes mouse listeners with `this` = the renderable.
const clickPressState = new WeakMap<Renderable, { pressed: boolean; dragged: boolean }>()

/**
 * Build the OpenTUI <box> props that wire Ink's event/focus handlers.
 *
 * Returns a plain record the Box adapter merges into its <box> props, plus an
 * onRef the Box adapter calls with the mounted Renderable so tabIndex/autoFocus
 * can be registered and focus driven imperatively.
 */
export function wireBoxEvents(props: BoxEventProps): {
  boxProps: Record<string, unknown>
  onRef: (node: Renderable | null) => void
} {
  const { onClick, onMouseEnter, onMouseLeave, onFocus, onBlur, onKeyDown, onKeyDownCapture, tabIndex, autoFocus } = props

  const boxProps: Record<string, unknown> = {}

  if (onClick) {
    // OpenTUI fires no press+release click; synthesize from down→up on the same
    // renderable, suppressed if a drag happened between them (matches Ink's
    // "release without drag" rule). State is keyed on the renderable (`this`)
    // via clickPressState so it SURVIVES a re-render between down and up — the
    // per-render closure that used to hold it would be replaced and lose the press.
    boxProps.onMouseDown = function (this: Renderable, e: OpenTuiMouseEvent) {
      if (e.button !== MOUSE_BUTTON_LEFT) return
      clickPressState.set(this, { pressed: true, dragged: false })
    }
    boxProps.onMouseDrag = function (this: Renderable): void {
      const s = clickPressState.get(this)
      if (s) s.dragged = true
    }
    boxProps.onMouseUp = function (this: Renderable, e: OpenTuiMouseEvent) {
      if (e.button !== MOUSE_BUTTON_LEFT) return
      const s = clickPressState.get(this)
      clickPressState.delete(this)
      if (!s?.pressed || s.dragged) return
      // Ink's ClickEvent carries absolute screen col/row and a blank-cell flag.
      // OpenTUI gives only the hit coords; we can't cheaply probe the buffer here,
      // so cellIsBlank is false (the Box landed the hit, so a cell exists).
      onClick(new ClickEvent(e.x, e.y, false))
    }
    // A press that ends in drag-end (not a plain up) would otherwise leave a
    // stale clickPressState entry on the renderable — clear it the same way.
    boxProps.onMouseDragEnd = function (this: Renderable): void {
      clickPressState.delete(this)
    }
  }

  if (onMouseEnter) {
    boxProps.onMouseOver = function (): void {
      onMouseEnter()
    }
  }
  if (onMouseLeave) {
    boxProps.onMouseOut = function (): void {
      onMouseLeave()
    }
  }

  // tabIndex >= 0 (or any number) makes the renderable focusable in OpenTUI too.
  if (typeof tabIndex === 'number') {
    boxProps.focusable = tabIndex >= 0
  }

  // Track the last node this ref callback saw so a replacement/unmount clears the
  // prior renderable's registry entries (ref callbacks run with null on unmount and
  // with the new node on a ref-identity change). No per-render listener accumulation
  // on the renderable — handlers live in the WeakMap registries, replaced not added.
  let current: Renderable | null = null

  const onRef = (node: Renderable | null): void => {
    if (current && current !== node) {
      setTabIndex(current, undefined)
      setFocusHandlers(current, {})
      setKeyHandlers(current, {})
    }
    current = node
    if (!node) return

    setTabIndex(node, tabIndex)
    // Register the Ink onFocus/onBlur in the single focus path (the FocusManager's
    // dispatchFocusEvent reads these). NOT subscribed to RenderableEvents, which
    // renderer.focusRenderable() never emits — that was the dead-path / leak bug.
    setFocusHandlers(node, { onFocus, onBlur })
    // Register onKeyDown/onKeyDownCapture for dispatchKeydown's ancestor-chain bubble.
    setKeyHandlers(node, { onKeyDown, onKeyDownCapture })

    if (autoFocus) {
      focus(node)
    }
  }

  return { boxProps, onRef }
}
