// src/ink-opentui/scrollbox.tsx
//
// OpenTUI-backed ScrollBox: a drop-in replacement for the forked-Ink
// src/ink/components/ScrollBox.tsx. Same default export, same `ScrollBoxProps`
// and `ScrollBoxHandle` surfaces, so the consumers that import it directly
// (FullscreenLayout, btw, Tabs) and the handle callers (ScrollKeybindingHandler,
// useUnseenDivider) stay drop-in under the build alias.
//
// WHY A REWRITE (not a thin shim): the forked ScrollBox is welded to Ink's DOM.
// It emits <ink-box>, mutates Ink-DOM-only node fields (scrollTop,
// pendingScrollDelta, scrollAnchor, scrollViewportHeight, scrollClampMin/Max,
// yogaNode) and pokes the Ink renderer's throttle (markDirty/scheduleRenderFrom/
// markCommitStart from ../dom.js + ../reconciler.js, plus markScrollActivity).
// None of those exist under OpenTUI — there the live node IS an OpenTUI
// `ScrollBoxRenderable`, which already owns scroll state, clamping, and the
// sticky-to-bottom follow. So this adapter emits the OpenTUI <scrollbox>
// intrinsic and backs every ScrollBoxHandle method with the renderable's own
// API. No manual throttle/dirty plumbing: OpenTUI re-renders on its own frame
// loop after each scroll mutation.
//
// ── HANDLE FIDELITY (read before relying on it; M3 selection depends on parity)
// EXACT (1:1 with the renderable's own state, no staleness — OpenTUI lays out
//        synchronously via Yoga so reads are always fresh):
//   getScrollTop        → renderable.scrollTop      (verticalScrollBar.scrollPosition)
//   getScrollHeight     → renderable.scrollHeight   (content.height)
//   getFreshScrollHeight→ renderable.scrollHeight   (same value; no throttle to bypass)
//   getViewportHeight   → renderable.viewport.height
//   getViewportTop      → renderable.viewport.y (absolute first-visible row)
//   scrollTo / scrollBy → renderable.scrollTo / scrollBy (both clamp to
//                         [0, scrollHeight-viewportHeight]; both break stickiness
//                         exactly like the Ink version cleared stickyScroll)
//   scrollToBottom      → re-pin: stickyScroll=true + scrollTo(maxScroll)
//   isSticky            → mirrors the renderable's pinned-to-bottom state
//   subscribe           → fires on every imperative scrollTo/By/ToBottom
//
// APPROXIMATED (behavior intentionally differs; documented so callers know):
//   getPendingDelta  → ALWAYS 0. The Ink version accumulated wheel deltas into a
//       node field that the renderer drained over several frames; OpenTUI applies
//       every scroll synchronously and clamps immediately, so there is never an
//       undrained delta. Every caller reads `getScrollTop() + getPendingDelta()`
//       — with pending≡0 that is just the live (already-correct) scrollTop, so
//       the call sites stay correct. The only loss is the multi-frame "smear" of
//       a single fast flick, which OpenTUI's own scroll-acceleration replaces.
//   scrollToElement  → renderable.scrollChildIntoView(el.id). The Ink version put
//       the element's TOP at the viewport top (+offset), deferring the read to
//       paint time. OpenTUI's scrollChildIntoView brings the child to the NEAREST
//       edge (no top-pin, ignores `offset`). Same intent (reveal the element),
//       different landing position. Currently only used by StickyPromptHeader's
//       click-to-jump (offset 0) — acceptable; a top-pin variant is a follow-up.
//   setClampBounds   → no-op. The Ink clamp existed solely to stop burst scrollTo
//       calls from racing past React's async virtual-scroll re-render and painting
//       blank spacer. OpenTUI clamps natively to real content bounds and lays out
//       synchronously, so that race can't happen and the bound is unnecessary.

import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  type PropsWithChildren,
  type Ref,
} from 'react'
import type { Renderable, ScrollBoxRenderable } from '@opentui/core'
// Reuse the Ink ScrollBox's EXACT public types so this is a drop-in replacement.
// ScrollBoxHandle.scrollToElement is typed against Ink's DOMElement (a hand-rolled
// vnode struct with no `.id`); we mirror that exact param type for interface
// compatibility, then runtime-cast to the OpenTUI Renderable (what actually flows
// here under the alias) to read its `.id`.
import type {
  ScrollBoxHandle,
  ScrollBoxProps,
} from '../ink/components/ScrollBox.js'
import type { DOMElement } from '../ink/dom.js'

export type { ScrollBoxHandle, ScrollBoxProps } from '../ink/components/ScrollBox.js'

// Muted scrollbar thumb (vs OpenTUI's bright rgb(154,158,163) default) — subtle
// on a dark canvas yet still visible while scrolling a long transcript.
const SCROLLBAR_THUMB = '#5a5a5e'
// Full-height track, lifted above OpenTUI's near-canvas #252527 default so the
// bar visibly spans to the top (the thumb alone read as a faint floating square).
const SCROLLBAR_TRACK = '#303033'

// maxScroll for vertical: the largest valid scrollTop. The renderable clamps to
// this itself; we recompute it for scrollToBottom's eager-write and for nothing
// else (callers compute their own max from getScrollHeight/getViewportHeight).
function maxScrollTop(node: ScrollBoxRenderable): number {
  return Math.max(0, node.scrollHeight - node.viewport.height)
}

function ScrollBox(
  {
    children,
    // `ref` is declared on the Ink Props type (React-19 ref-as-prop), but under
    // forwardRef React routes the JSX `ref` to the 2nd arg below — so this is
    // always undefined here. Destructured only to keep it out of `...style`.
    ref: _ref,
    stickyScroll,
    ...style
  }: PropsWithChildren<ScrollBoxProps>,
  forwardedRef: Ref<ScrollBoxHandle>,
): React.ReactNode {
  const nodeRef = useRef<ScrollBoxRenderable | null>(null)
  const listenersRef = useRef(new Set<() => void>())

  const notify = useCallback(() => {
    for (const l of listenersRef.current) l()
  }, [])

  useImperativeHandle(
    forwardedRef,
    (): ScrollBoxHandle => ({
      scrollTo(y: number) {
        const node = nodeRef.current
        if (!node) return
        // Setting scrollTop marks the renderable _hasManualScroll=true, which
        // breaks the sticky-to-bottom follow — exactly the Ink semantics
        // (stickyScroll=false). Clamp is applied inside the setter.
        node.scrollTo(Math.max(0, Math.floor(y)))
        notify()
      },
      scrollToElement(el: DOMElement, _offset = 0) {
        const node = nodeRef.current
        // Under the OpenTUI alias the caller hands us a live Renderable (has `.id`),
        // though the interface types it as Ink's DOMElement (which doesn't). Cast.
        const id = (el as unknown as Renderable | null)?.id
        if (!node || !id) return
        // APPROXIMATED: nearest-edge reveal, ignores offset (see file header).
        node.scrollChildIntoView(id)
        notify()
      },
      scrollBy(dy: number) {
        const node = nodeRef.current
        if (!node) return
        // Applies + clamps synchronously; breaks stickiness via _hasManualScroll.
        node.scrollBy(Math.floor(dy))
        notify()
      },
      scrollToBottom() {
        const node = nodeRef.current
        if (!node) return
        // Re-pin: turn sticky back on so content growth follows, AND eager-write
        // scrollTop=max so the position is correct this frame (recalculateBarProps
        // re-pins on the next layout pass, but callers read scrollTop immediately).
        node.stickyScroll = true
        node.scrollTo(maxScrollTop(node))
        notify()
      },
      getScrollTop() {
        return nodeRef.current?.scrollTop ?? 0
      },
      getPendingDelta() {
        // APPROXIMATED: always 0 — OpenTUI has no undrained-delta accumulator.
        return 0
      },
      getScrollHeight() {
        return nodeRef.current?.scrollHeight ?? 0
      },
      getFreshScrollHeight() {
        // Read live Yoga (content height after the last layout), not the cached
        // scrollHeight — useAssistantHistory's prepend anchor reads this in a
        // layout effect before the cache refreshes, so a stale value jumped the
        // viewport. Fall back to scrollHeight if the yogaNode isn't reachable.
        const node = nodeRef.current
        const live = (
          node?.content as { yogaNode?: { getComputedHeight?: () => number } } | undefined
        )?.yogaNode?.getComputedHeight?.()
        return typeof live === 'number' && live > 0 ? live : (node?.scrollHeight ?? 0)
      },
      getViewportHeight() {
        return nodeRef.current?.viewport.height ?? 0
      },
      getViewportTop() {
        // Absolute screen-buffer row of the first visible content line. The Ink
        // version tracked this via scrollViewportTop; OpenTUI's `y` getter walks
        // the full parent chain summing each node's Yoga-relative offset, so it's
        // the absolute row and is fresh as soon as Yoga has laid out (unlike
        // `screenY`, which reads a parent's render-pass-cached value).
        return nodeRef.current?.viewport.y ?? 0
      },
      isSticky() {
        const node = nodeRef.current
        // Cold default true: a fresh list is pinned to bottom (matches
        // useVirtualScroll's ref-null default; adapter returned false → mismatch).
        if (!node) return true
        // Pinned-to-bottom is true when sticky is on AND scroll is at/near max.
        // Mirrors the Ink flag's meaning ("at bottom, following growth"). Using
        // the live position (not a private _hasManualScroll) keeps it robust:
        // scrollToBottom re-pins, manual scroll away moves off max → false.
        if (!node.stickyScroll) return false
        const max = maxScrollTop(node)
        return max === 0 || node.scrollTop >= max - 1
      },
      subscribe(listener: () => void) {
        listenersRef.current.add(listener)
        return () => {
          listenersRef.current.delete(listener)
        }
      },
      setClampBounds(_min, _max) {
        // No-op: OpenTUI clamps to real content bounds synchronously (see header).
      },
    }),
    // Closes only over refs + the stable `notify` — empty deps avoids rebuilding
    // the handle every render (which would re-register the ref = churn). Mirrors
    // the Ink source's empty-deps useImperativeHandle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [notify],
  )

  // The OpenTUI <scrollbox> intrinsic maps to ScrollBoxRenderable. It already
  // builds its own viewport/content/scrollbar subtree and clamps + follows. We
  // pass the layout `style` straight through (Ink Styles names == OpenTUI layout
  // option names) and set stickyStart='bottom' so stickyScroll follows the
  // BOTTOM (the chat-tail behavior the Ink version's sticky implemented). scrollX
  // is disabled (the message list never scrolls horizontally; the Ink version's
  // overflowX:'scroll' was paired with flexWrap:'nowrap' to avoid wrapping, not
  // to actually scroll sideways).
  const { flexDirection, flexGrow, flexShrink, ...rest } = style as Record<
    string,
    unknown
  >

  return React.createElement(
    'scrollbox',
    {
      ref: (node: ScrollBoxRenderable | null) => {
        nodeRef.current = node
      },
      flexDirection: flexDirection ?? 'column',
      flexGrow: flexGrow ?? 0,
      flexShrink: flexShrink ?? 1,
      // Visible full-height track + clear thumb. The OpenTUI defaults made the
      // bar read as a faint lone square that never seemed to reach the top
      // (track #252527 ~= canvas; thumb rgb 154,158,163 too bright). A gently-lit
      // track shows the bar spanning top-to-bottom; the mid-gray thumb marks
      // position without shouting. Only shows when content > viewport (the
      // near-empty welcome stays bare). Caller can override via ...rest.
      verticalScrollbarOptions: { trackOptions: { foregroundColor: SCROLLBAR_THUMB, backgroundColor: SCROLLBAR_TRACK } },
      ...rest,
      scrollX: false,
      scrollY: true,
      stickyScroll: stickyScroll ?? false,
      ...(stickyScroll ? { stickyStart: 'bottom' as const } : {}),
    },
    children,
  )
}

export default forwardRef(ScrollBox)
