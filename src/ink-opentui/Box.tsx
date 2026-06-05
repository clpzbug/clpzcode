// src/ink-opentui/Box.tsx
//
// OpenTUI-backed BaseBox: same prop surface as src/ink/components/Box.tsx (Ink's
// flexbox Box), emitting the OpenTUI <box> intrinsic. clpzcode's layout props are
// Ink's `Styles`, whose names are IDENTICAL to OpenTUI's LayoutOptions (Yoga
// underneath both) — so layout is a pass-through. Only the deltas are translated:
//   - borderStyle present → { border:true, borderStyle: mapped } (+ borderColor)
//   - display:'none'       → visible:false
//   - gap/rowGap/columnGap → gap/rowGap/columnGap (eixos separados, 1:1)
// Event/focus props (onClick/onFocus/onKeyDown/tabIndex/autoFocus/onMouseEnter…)
// are accepted for drop-in type-compat but not wired yet — that's M1 (focus/mouse).

import React, {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
  type PropsWithChildren,
} from 'react'
import type { BorderCharacters, BorderStyle, Renderable } from '@opentui/core'
// Reuse Ink Box's EXACT Props type so this is a drop-in replacement.
import type { Props as InkBoxProps } from '../ink/components/Box.js'
import type { Color } from '../ink/styles.js'
// Normalize clpzcode's rgb()/ansi256()/ansi: Color forms to #hex so a NON-themed
// border/background color doesn't hit OpenTUI's magenta hex-fallback (issue #17).
import { dimColor, toOpenTuiColor } from './color.js'
// Translate Ink's onClick/onMouseEnter/onMouseLeave/onFocus/onBlur/tabIndex/
// autoFocus props into OpenTUI <box> props + a registration callback (issue #14).
import { wireBoxEvents, type BoxEventProps } from './focus-events.js'


// OpenTUI <box> props with no Ink Styles equivalent, exposed so callers (Panel,
// AmbientField, modals) can set them type-safely. opacity/zIndex/title/bottomTitle/
// customBorderChars already pass through ...layout at runtime; focusedBorderColor
// is a color and is normalized (toOpenTuiColor) so a theme value doesn't hit
// OpenTUI's magenta hex-fallback. Resolved Color (rgb()/#hex/ansi:) — ThemedBox
// resolves theme keys upstream, same as borderColor.
export type OpenTuiBoxExtras = {
  opacity?: number
  zIndex?: number
  title?: string
  titleAlignment?: 'left' | 'center' | 'right'
  bottomTitle?: string
  bottomTitleAlignment?: 'left' | 'center' | 'right'
  focusedBorderColor?: Color
  customBorderChars?: BorderCharacters
}

type BaseBoxProps = InkBoxProps & OpenTuiBoxExtras

// Ink borderStyle vocabulary → OpenTUI's 4 styles (single|double|rounded|heavy).
const BORDER_STYLE_MAP: Record<string, BorderStyle> = {
  single: 'single',
  double: 'double',
  round: 'rounded',
  bold: 'heavy',
  // Ink extras with no exact OpenTUI equivalent → nearest.
  singleDouble: 'double',
  doubleSingle: 'double',
  classic: 'single',
  arrow: 'single',
}

export function mapBoxProps(props: PropsWithChildren<BaseBoxProps>): Record<string, unknown> {
  const {
    children: _children,
    // deltas handled explicitly
    borderStyle,
    borderTop,
    borderBottom,
    borderLeft,
    borderRight,
    borderColor,
    focusedBorderColor,
    backgroundColor,
    opaque,
    display,
    gap,
    columnGap,
    rowGap,
    // event/focus props — handled by wireBoxEvents (issue #14), not <box> props
    tabIndex: _tabIndex,
    autoFocus: _autoFocus,
    onClick: _onClick,
    onFocus: _onFocus,
    // onFocusCapture/onBlurCapture/onKeyDown(Capture) have no OpenTUI <box> analogue
    // (capture-phase + box-level keydown were Ink Dispatcher features) → dropped.
    onFocusCapture: _onFocusCapture,
    onBlur: _onBlur,
    onBlurCapture: _onBlurCapture,
    onKeyDown: _onKeyDown,
    onKeyDownCapture: _onKeyDownCapture,
    onMouseEnter: _onMouseEnter,
    onMouseLeave: _onMouseLeave,
    // everything else is layout with matching names → pass through
    ...layout
  } = props as Record<string, unknown> & BaseBoxProps

  const out: Record<string, unknown> = { ...layout }
  if (display === 'none') out.visible = false
  if (borderStyle) {
    out.borderStyle = BORDER_STYLE_MAP[borderStyle as string] ?? 'single'
    // Ink draws a side unless its borderX is explicitly false (default true).
    const sides = (['top', 'right', 'bottom', 'left'] as const).filter(s => {
      const v = { top: borderTop, right: borderRight, bottom: borderBottom, left: borderLeft }[s]
      return v !== false
    })
    out.border = sides.length === 4 ? true : sides
  }
  if (borderColor != null) {
    // Ink borderDimColor (+ per-side) → darken the resolved border color;
    // OpenTUI has no faint-border attr. Per-side dim collapses to one global.
    const p = props as Record<string, unknown>
    const wantsDim =
      p.borderDimColor === true ||
      p.borderTopDimColor === true ||
      p.borderBottomDimColor === true ||
      p.borderLeftDimColor === true ||
      p.borderRightDimColor === true
    out.borderColor = wantsDim ? dimColor(borderColor) : toOpenTuiColor(borderColor)
  }
  // Strip the dim flags so they never leak as dead props onto <box>.
  delete (out as Record<string, unknown>).borderDimColor
  delete (out as Record<string, unknown>).borderTopDimColor
  delete (out as Record<string, unknown>).borderBottomDimColor
  delete (out as Record<string, unknown>).borderLeftDimColor
  delete (out as Record<string, unknown>).borderRightDimColor
  if (focusedBorderColor != null) out.focusedBorderColor = toOpenTuiColor(focusedBorderColor)
  if (backgroundColor != null) out.backgroundColor = toOpenTuiColor(backgroundColor)
  // Ink's `opaque` maps to OpenTUI's shouldFill. By the owner's design we do NOT
  // inject any fallback surface: the UI stays fully transparent so the terminal
  // background shows through every overlay/dialog. With shouldFill set but no
  // backgroundColor, OpenTUI draws nothing (a transparent fill is a no-op) — the
  // desired see-through panel. A box that wants a fill passes its own backgroundColor.
  if (opaque) {
    out.shouldFill = true
  }
  if (gap != null) out.gap = gap
  if (columnGap != null) out.columnGap = columnGap
  if (rowGap != null) out.rowGap = rowGap
  // Non-selectable so OpenTUI never auto-starts native selection on a box drag
  // (the SelectionController owns selection via the root mouse handler).
  out.selectable = false
  return out
}

// Pull the Ink event/focus props into a BoxEventProps for wireBoxEvents.
function pickEventProps(props: InkBoxProps): BoxEventProps {
  const p = props as Record<string, unknown>
  return {
    onClick: p.onClick as BoxEventProps['onClick'],
    onMouseEnter: p.onMouseEnter as BoxEventProps['onMouseEnter'],
    onMouseLeave: p.onMouseLeave as BoxEventProps['onMouseLeave'],
    onFocus: p.onFocus as BoxEventProps['onFocus'],
    onBlur: p.onBlur as BoxEventProps['onBlur'],
    onKeyDown: p.onKeyDown as BoxEventProps['onKeyDown'],
    onKeyDownCapture: p.onKeyDownCapture as BoxEventProps['onKeyDownCapture'],
    tabIndex: p.tabIndex as number | undefined,
    autoFocus: p.autoFocus as boolean | undefined,
  }
}

const Box = forwardRef<unknown, PropsWithChildren<BaseBoxProps>>(function Box(props, ref) {
  const eventProps = pickEventProps(props)

  // autoFocus is a MOUNT-only intent (matches Ink's commitMount handleAutoFocus):
  // fire it on the first registration only, never on re-render — otherwise a Box
  // would yank focus back from wherever the user tabbed every commit. Re-registration
  // (handler/tabIndex updates) therefore runs with autoFocus stripped.
  const didMountRef = useRef(false)

  // Latest event handlers, read by the stable ref + layout effect so onClick/
  // onFocus/onBlur/tabIndex stay current without churning the ref callback.
  const eventPropsRef = useRef(eventProps)
  eventPropsRef.current = eventProps
  const nodeRef = useRef<Renderable | null>(null)

  // Build the OpenTUI mouse/focusable props fresh each render (handler identities
  // change); these are plain <box> props so updating them per render is fine.
  const { boxProps } = wireBoxEvents(eventProps)

  const register = useCallback((node: Renderable | null) => {
    const first = !didMountRef.current
    didMountRef.current = true
    // Strip autoFocus after the first registration so re-renders don't re-focus.
    const props = first
      ? eventPropsRef.current
      : { ...eventPropsRef.current, autoFocus: false }
    wireBoxEvents(props).onRef(node)
  }, [])

  const setRef = useCallback(
    (node: Renderable | null) => {
      nodeRef.current = node
      register(node)
      // Forward to the caller's ref (themed.tsx / measureElement / Button read it).
      if (typeof ref === 'function') ref(node)
      else if (ref) (ref as React.MutableRefObject<unknown>).current = node
    },
    [ref, register],
  )

  // React reuses the same host Renderable across re-renders, so setRef is only
  // re-invoked on mount/unmount or ref-identity change — not when only handlers
  // change. Re-run the latest registration each render against the live node so
  // updated onClick/onFocus/onBlur/tabIndex take effect (WeakMap writes, idempotent).
  useLayoutEffect(() => {
    if (nodeRef.current) register(nodeRef.current)
  })

  // boxProps (synthesized onMouseDown/Up/Over/Out + focusable) merge AFTER the
  // layout props so the wired mouse handlers reach the <box> intrinsic.
  return React.createElement(
    'box',
    { ...mapBoxProps(props), ...boxProps, ref: setRef },
    props.children,
  )
})

export default Box
