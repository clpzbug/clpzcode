// src/ink-opentui/alternate-screen.tsx
//
// OpenTUI-backed drop-in for src/ink/components/AlternateScreen.tsx (named export
// AlternateScreen). The forked component writes raw DEC-1049 alt-screen + SGR
// mouse-tracking escapes via TerminalWriteContext and wraps children in an Ink
// <Box> (→ <ink-box>, which the OpenTUI reconciler rejects: "Unknown component
// type: ink-box").
//
// Under OpenTUI the renderer ALREADY owns the alternate screen + mouse
// (createCliRenderer manages the screen; render.tsx sets useMouse:true), so we
// must NOT emit those raw escapes — they would fight the renderer's own screen
// management. We only reproduce the fullscreen layout container, using the
// adapter Box (→ <box>). Same named export + Props shape as the forked module.

import { createElement, useContext, type ReactNode } from 'react'
import Box from './Box.js'
import { TerminalSizeContext } from '../ink/components/TerminalSizeContext.js'

export function AlternateScreen({
  children,
  // Accepted for API parity; OpenTUI's renderer owns mouse tracking (useMouse),
  // so this is a no-op here.
  mouseTracking: _mouseTracking = true,
}: {
  children?: ReactNode
  mouseTracking?: boolean
}): ReactNode {
  const size = useContext(TerminalSizeContext) as { rows?: number } | null
  const rows = size?.rows ?? 24
  return createElement(
    Box,
    { flexDirection: 'column', height: rows, width: '100%', flexShrink: 0 },
    children,
  )
}
