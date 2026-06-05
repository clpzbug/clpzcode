// src/ink-opentui/controls.tsx
//
// OpenTUI-backed Button + Link — drop-in replacements for
// src/ink/components/Button.tsx and src/ink/components/Link.tsx. Same Props /
// ButtonState surface, so the 643 components import them unchanged.
//
// Button: a focusable Box with the SAME focus/hover/active state machine and
//   onAction (Enter/Space/click) contract as Ink's Button. The proven ./Box.js
//   adapter renders the visual/layout box but (M0) drops event/focus props, so
//   the interactive wiring is attached imperatively to the underlying OpenTUI
//   BoxRenderable via a ref: `focusable`, `onKeyDown`, `onMouseDown`,
//   `onMouseOver`/`onMouseOut`, and FOCUSED/BLURRED events. We read the OpenTUI
//   KeyEvent's `.name` ("return"/" ") directly (Ink read `e.key`) — same check,
//   matched to the event type OpenTUI actually delivers. No sibling adapter
//   files are imported; the small key check is duplicated, not borrowed.
//
// Link: composes ./Text.js and the native OpenTUI `a` intrinsic
//   (LinkRenderable, which sets link:{url} on the text node → OSC-8 emitted by
//   the renderer). This mirrors Ink's <Text><ink-link href>…</ink-link></Text>
//   exactly, gated on supportsHyperlinks() (reused renderer-agnostic KEEP code).

import React, {
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { Except } from 'type-fest'
import type { BoxRenderable, KeyEvent, Renderable } from '@opentui/core'
import type { DOMElement } from '../ink/dom.js'
import type { Styles } from '../ink/styles.js'
import { supportsHyperlinks } from '../ink/supports-hyperlinks.js'
import Box from './Box.js'
import Text from './Text.js'
// Route Button click-focus through the single FocusManager path (issue #16) instead
// of poking box.focus() behind the manager's back. Focus registration (tabIndex/
// autoFocus/onFocus/onBlur) flows through Box's #14 wiring via props.
import { focus as focusViaManager } from './focus-events.js'

// ── Button ─────────────────────────────────────────────────────────────────

type ButtonState = {
  focused: boolean
  hovered: boolean
  active: boolean
}

// Mirror of src/ink/components/Button.tsx Props (drop-in).
export type Props = Except<Styles, 'textWrap'> & {
  ref?: Ref<DOMElement>
  /**
   * Called when the button is activated via Enter, Space, or click.
   */
  onAction: () => void
  /**
   * Tab order index. Defaults to 0 (in tab order).
   * Set to -1 for programmatically focusable only.
   */
  tabIndex?: number
  /**
   * Focus this button when it mounts.
   */
  autoFocus?: boolean
  /**
   * Render prop receiving the interactive state. Use this to
   * style children based on focus/hover/active — Button itself
   * is intentionally unstyled.
   *
   * If not provided, children render as-is (no state-dependent styling).
   */
  children: ((state: ButtonState) => React.ReactNode) | React.ReactNode
}

function Button(props: Props) {
  const { onAction, tabIndex = 0, autoFocus, children, ref, ...style } = props

  const [isFocused, setIsFocused] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [isActive, setIsActive] = useState(false)
  const activeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Ref to the underlying OpenTUI BoxRenderable so we can wire focus/key/mouse
  // imperatively (Box.js drops these props at M0). Merged with the caller's ref.
  const boxRef = useRef<BoxRenderable | null>(null)

  useEffect(() => {
    return () => {
      if (activeTimer.current) {
        clearTimeout(activeTimer.current)
      }
    }
  }, [])

  const handleKeyDown = useCallback(
    (event: KeyEvent) => {
      // Ink checked e.key; the OpenTUI KeyEvent exposes the same value as .name
      // ("return" for Enter, " " for Space).
      if (event.name === 'return' || event.name === ' ') {
        event.preventDefault()
        setIsActive(true)
        onAction()
        if (activeTimer.current) {
          clearTimeout(activeTimer.current)
        }
        activeTimer.current = setTimeout(() => setIsActive(false), 100)
      }
    },
    [onAction],
  )

  // Wire ONLY the Enter/Space activation imperatively (issue #16): Box's event
  // adapter (#14) handles focus/tabIndex/autoFocus/hover via props below, but it has
  // no onKeyDown analogue, so the key listener still attaches to the live Renderable.
  // The keypress routing that delivers keys here is installed by the FocusManager
  // calling the renderable's own .focus() (#16). Re-run when handleKeyDown changes.
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    // Ink treats BOTH tabIndex 0 and -1 as focusable (only tab-order differs). Box's
    // #14 wiring sets focusable = tabIndex>=0, so force it true here to keep a
    // tabIndex=-1 (programmatically-focusable-only) Button focusable for key routing.
    box.focusable = true
    box.onKeyDown = handleKeyDown
    return () => {
      box.onKeyDown = undefined
    }
  }, [handleKeyDown])

  // Single focus path: route Button's focus/hover/tab through Box's #14 wiring so the
  // FocusManager owns registration (no dual setTabIndex on the same node). onFocus/
  // onBlur drive the visual state; onClick focuses+activates (Box's onClick already
  // synthesizes down→up and the FocusManager focuses a focusable Box on tabbed/click).
  const onFocus = useCallback(() => setIsFocused(true), [])
  const onBlur = useCallback(() => setIsFocused(false), [])
  const onMouseEnter = useCallback(() => setIsHovered(true), [])
  const onMouseLeave = useCallback(() => setIsHovered(false), [])
  const onClick = useCallback(() => {
    focusViaManager(boxRef.current as unknown as Renderable)
    onAction()
  }, [onAction])

  // Forward our internal ref AND the caller's ref to the same node.
  const setRef = useCallback(
    (node: BoxRenderable | null) => {
      boxRef.current = node
      if (typeof ref === 'function') {
        ;(ref as (n: unknown) => void)(node)
      } else if (ref) {
        ;(ref as { current: unknown }).current = node
      }
    },
    [ref],
  )

  const state: ButtonState = {
    focused: isFocused,
    hovered: isHovered,
    active: isActive,
  }
  const content = typeof children === 'function' ? children(state) : children

  return (
    <Box
      ref={setRef}
      tabIndex={tabIndex}
      autoFocus={autoFocus}
      onFocus={onFocus}
      onBlur={onBlur}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      {...(style as object)}
    >
      {content}
    </Box>
  )
}

// EXPORT TOPOLOGY (read before wiring the barrel):
// Button and Link live in ONE module, but an ES module has exactly ONE `default`.
// In Ink they were separate files, each a `default` export, and the barrel did
//   export { default as Button } ...   /   export { default as Link } ...
// Here we must pick which symbol is `default`. We give the `default` slot to
// **Link**, because Link is imported BOTH via the barrel AND directly as a
// DEFAULT import in ~6 call sites (e.g. src/components/FilePathLink.tsx:
//   `import Link from '.../Link.js'`). A named-only Link cannot satisfy those
// default imports; a default-only Button is needed by NO ONE (Button is only
// ever consumed as the named `{ Button }` from the barrel — verified: no direct
// `import Button from ...` exists in the repo). So:
//   • Button  → NAMED export only.   Barrel: `export { Button } from './controls.js'`
//   • Link    → DEFAULT *and* NAMED. Barrel: `export { default as Link } ...`
//               (Ink-style, unchanged shape) OR `export { Link } ...` — both work,
//               and any redirected direct `import Link from '.../controls.js'`
//               resolves to the real Link, not Button.
export { Button }
// `Props` keeps Button's Ink name; `ButtonProps` is the unambiguous alias the
// barrel re-exports (the Ink barrel did `Props as ButtonProps`).
export type { Props as ButtonProps, ButtonState }

// ── Link ─────────────────────────────────────────────────────────────────────

// Mirror of src/ink/components/Link.tsx Props (drop-in). Exported as a named
// type to avoid clobbering Button's `Props` export above.
export type LinkProps = {
  readonly children?: ReactNode
  readonly url: string
  readonly fallback?: ReactNode
}

export function Link({ children, url, fallback }: LinkProps) {
  const content = children ?? url

  if (supportsHyperlinks()) {
    // Native OpenTUI `a` intrinsic (LinkRenderable) — sets link:{url} on the
    // text node so the renderer emits the OSC-8 hyperlink. Must live inside a
    // <text>, which Text supplies. Mirrors Ink's <ink-link href> structure.
    return (
      <Text>
        <a href={url}>{content}</a>
      </Text>
    )
  }

  return <Text>{fallback ?? content}</Text>
}

// Link owns the module's `default` slot (see EXPORT TOPOLOGY note above) so that
// the ~6 default-style `import Link from '.../Link.js'` call sites resolve to the
// real Link if their paths are redirected here, while the named export keeps
// `{ Link }` / `export { default as Link }` barrel re-exports working too.
export default Link
