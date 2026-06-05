// src/ink-opentui/app.tsx
//
// The provider stack the forked-Ink <App> (src/ink/components/App.tsx) + the Ink
// class (src/ink/ink.tsx:1472) mount around every rendered tree. Components read
// these contexts (useApp, useStdin, useTerminalNotification, the clock, terminal
// focus/size), so the OpenTUI render path MUST mount the same ones or the app
// throws (e.g. "useTerminalNotification must be used within TerminalWriteProvider").
//
// The context objects themselves are renderer-agnostic React contexts — we REUSE
// them from ../ink/components and only supply OpenTUI-backed values. This also
// mounts ClockProvider (fixes the frozen-animation gap) and TerminalFocusProvider.

import { createElement, useEffect, useMemo, useState, type ReactNode } from 'react'
import { CliRenderEvents, type CliRenderer } from '@opentui/core'
import AppContext from '../ink/components/AppContext.js'
import { ClockProvider } from '../ink/components/ClockContext.js'
import CursorDeclarationContext from '../ink/components/CursorDeclarationContext.js'
import StdinContext from '../ink/components/StdinContext.js'
import { TerminalFocusProvider } from '../ink/components/TerminalFocusContext.js'
import { TerminalSizeContext } from '../ink/components/TerminalSizeContext.js'
import { TerminalWriteProvider } from '../ink/useTerminalNotification.js'
import { getStdinEmitter } from './input.js'

export function AdapterApp({
  renderer,
  children,
}: {
  renderer: CliRenderer
  children?: ReactNode
}): ReactNode {
  // SAME per-renderer emitter useStdin() returns, so anything reading StdinContext
  // directly shares the emitter the render-layer Ctrl+Z handler emits on (issue #19).
  const emitter = useMemo(() => getStdinEmitter(renderer), [renderer])
  const stdinValue = useMemo(
    () => ({
      stdin: renderer.stdin ?? process.stdin,
      // The OpenTUI renderer owns raw mode; setRawMode is a no-op (see input.tsx).
      setRawMode: (_mode: boolean): void => {},
      isRawModeSupported: true,
      internal_exitOnCtrlC: false,
      internal_eventEmitter: emitter,
      // OSC capability querier: intentionally null under OpenTUI. The querier
      // needs to be fed parsed terminal RESPONSES (DA1/OSC-11/DECRPM) off stdin,
      // but OpenTUI owns the stdin raw-mode + its own parser; tapping that stream
      // to extract responses would race its key parsing. Graceful degradation
      // (verified): ThemeProvider returns early when !internal_querier, so
      // `theme:'auto'` seeds once from $COLORFGBG and stays static (no live OSC-11
      // re-query); explicit themes are unaffected. Not a TODO — a deliberate scope
      // boundary for the Bun/OpenTUI input model.
      internal_querier: null,
    }),
    [renderer, emitter],
  )
  const exit = useMemo(
    () =>
      (_error?: Error | number | null): void => {
        try {
          renderer.destroy()
        } catch {
          /* already torn down */
        }
      },
    [renderer],
  )
  // TerminalWrite: out-of-band escapes (notifications, tab status) go to the
  // renderer's OWN stdout so they land on the same stream as the frames even under a
  // custom opts.stdout (issue #22). CliRenderer types stdout private but it is present
  // at runtime carrying render.tsx's configured stream; fall back to process.stdout.
  const writeRaw = useMemo(() => {
    const out =
      (renderer as unknown as { stdout?: NodeJS.WriteStream }).stdout ?? process.stdout
    return (data: string): void => {
      out.write(data)
    }
  }, [renderer])

  // Reactive terminal size: forked-Ink re-rendered <App> with fresh dims on every
  // resize; here we track it in state and refresh on the renderer's RESIZE event,
  // so the ~73 useTerminalSize consumers don't see frozen first-mount dimensions.
  const [size, setSize] = useState(() => ({ columns: renderer.width, rows: renderer.height }))
  useEffect(() => {
    const onResize = (): void => setSize({ columns: renderer.width, rows: renderer.height })
    renderer.on(CliRenderEvents.RESIZE, onResize)
    return () => {
      renderer.off(CliRenderEvents.RESIZE, onResize)
    }
  }, [renderer])

  return createElement(
    TerminalSizeContext.Provider,
    { value: size },
    createElement(
      AppContext.Provider,
      { value: { exit } },
      createElement(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        StdinContext.Provider,
        { value: stdinValue as never },
        createElement(
          TerminalFocusProvider,
          null,
          createElement(
            ClockProvider,
            null,
            createElement(
              CursorDeclarationContext.Provider,
              { value: () => {} },
              createElement(TerminalWriteProvider, { value: writeRaw }, children),
            ),
          ),
        ),
      ),
    ),
  )
}
