// src/ink-opentui/render.tsx
//
// OpenTUI-backed reimplementation of the render lifecycle from src/ink/root.ts.
// This is the spine of the Ink→OpenTUI adapter: it owns the OpenTUI renderer and
// exposes the SAME render()/createRoot()/Instance/Root/RenderOptions surface the
// 643 clpzcode components (via src/ink.ts) already depend on, so they mount on
// OpenTUI unchanged.
//
// Key divergences from Ink (PoC-verified, see docs/OPENTUI-ADAPTER-SPEC.md §3):
//   - createCliRenderer(config) is ASYNC and owns stdin/stdout + raw mode.
//   - @opentui/react createRoot(RENDERER) returns a SYNC { render, unmount } only;
//     waitUntilExit/rerender/cleanup are synthesized here.
//   - We force exitOnCtrlC:false (clpzcode handles Ctrl+C via useInput) and
//     consoleMode:'disabled' (clpzcode patches console itself; the OpenTUI console
//     overlay would corrupt the frame).

import { Stream } from 'stream'
import { createElement, Fragment, type ReactNode, useEffect } from 'react'
import {
  createCliRenderer,
  CliRenderEvents,
  type CliRenderer,
  type CliRendererConfig,
  type MouseEvent as OpenTuiMouseEvent,
} from '@opentui/core'
import { createRoot as openTuiCreateRoot, type Root as OpenTuiRoot } from '@opentui/react'
import {
  ThemeProvider,
  useTheme,
} from '../components/design-system/ThemeProvider.js'
import { getTheme } from '../utils/theme.js'
import type { FrameEvent } from '../ink/frame.js'
import type { Color } from '../ink/styles.js'
import { AdapterApp } from './app.js'
import { toOpenTuiColor } from './color.js'
import { wireFocusManager } from './focus-events.js'
import { wireSuspendResume } from './input.js'
import { SelectionController } from './selection-controller.js'

/**
 * Paints the renderer's whole canvas with the active theme's background so the
 * TUI is a solid, structured surface instead of transparent text floating over
 * the terminal's background image. Rendered INSIDE ThemeProvider so it tracks
 * /theme changes, and set via the renderer's public setBackgroundColor (the
 * config can't be read at renderer-construction time — "accessed before
 * allowed"). Renders nothing.
 */
function CanvasBackground({ renderer }: { renderer: CliRenderer }): null {
  const [themeName] = useTheme()
  useEffect(() => {
    try {
      // Decoupled canvas role: dark themes => "transparent" (terminal shows through); theme.background stays for panels/messages.
      const color = toOpenTuiColor(getTheme(themeName).canvasBackground as Color)
      if (color) renderer.setBackgroundColor(color)
    } catch {
      /* leave transparent if the color can't be resolved */
    }
  }, [renderer, themeName])
  return null
}

// ── surface mirrored from src/ink/root.ts ─────────────────────────────────────

export type RenderOptions = {
  stdout?: NodeJS.WriteStream
  stdin?: NodeJS.ReadStream
  stderr?: NodeJS.WriteStream
  /** Kept for API parity; clpzcode owns Ctrl+C via useInput so the OpenTUI gate
   *  is always disabled (we never let the renderer self-destroy on Ctrl+C). */
  exitOnCtrlC?: boolean
  /** Kept for API parity; clpzcode patches console itself. */
  patchConsole?: boolean
  onFrame?: (event: FrameEvent) => void
}

export type Instance = {
  rerender: (node: ReactNode) => void
  unmount: () => void
  waitUntilExit: () => Promise<void>
  cleanup: () => void
}

export type Root = {
  render: (node: ReactNode) => void
  unmount: () => void
  waitUntilExit: () => Promise<void>
}

// ── instances map (mirrors src/ink/instances.ts) ──────────────────────────────
// Keyed by stdout so external code that looks an instance up by stream (external
// editor pause/resume, alt-screen, redraw) can still find the live renderer.
// The Ink class is gone; the leaked surface it exposed (enterAlternateScreen/
// exitAlternateScreen/forceRedraw/invalidatePrevFrame/pause/resume/suspendStdin/
// resumeStdin/onHyperlinkClick) is re-attached on each map value here, backed by
// the OpenTUI renderer's own lifecycle API. Callers reach these via
// `instances.get(process.stdout)?.<method>()` exactly as they did the Ink instance.
//
// Mapping to the renderer (the Ink class did its own escape-string + JS-diff
// bookkeeping; OpenTUI's native core owns the alt screen, terminal setup, mouse,
// stdin raw mode and frame diffing, so each method delegates to the renderer):
//   enterAlternateScreen / exitAlternateScreen — external terminal-editor (vi,
//     nano) handoff. renderer.suspend() releases the terminal + stdin + mouse and
//     drops raw mode (so the editor owns the TTY); renderer.resume() re-acquires
//     it, re-runs setupTerminal for the current screenMode, and repaints. This is
//     the OpenTUI analogue of Ink's pause()+suspendStdin()+escapes / re-enter+
//     resumeStdin()+repaint dance — without us emitting any raw escapes (which
//     would fight the native renderer's own screen management).
//   pause / suspendStdin (GUI-editor path) — renderer.pause() stops the render
//     loop; releasing stdin for a GUI editor is handled by suspend() too, but the
//     paired call sites (promptEditor) call pause()+suspendStdin() then
//     resumeStdin()+resume(), so we keep all four and route the stdin pair through
//     suspend()/resume() (the only renderer primitives that release/re-acquire the
//     TTY). resume() also restarts the render loop.
//   forceRedraw / invalidatePrevFrame — Ink reset its JS cell-diff's prev frame so
//     the next paint was full-damage. OpenTUI's native renderer owns its own diff
//     (no stale-blit prev-frame problem to clear), so both reduce to asking the
//     renderer for a fresh frame: renderer.requestRender().
//   onHyperlinkClick — FullscreenLayout assigns a click handler the Ink class
//     invoked on OSC-8 hyperlink activation. OpenTUI routes link clicks through
//     mouse hit-testing on link runs, not a single instance callback, so this is a
//     stored-but-unwired field (assignment is a no-op sink) — file:// open / browser
//     open still works through the normal Link/Button onClick path. Kept settable so
//     FullscreenLayout's effect (set on mount, clear on unmount) type-checks and runs.

export type AdapterInstance = {
  renderer: CliRenderer
  root: OpenTuiRoot
  /** Cell-grid text selection host (M3) — the OpenTUI analogue of the forked-Ink
   *  ink.selection surface. Drives useSelection/useHasSelection via controllerFor. */
  selection: SelectionController
  enterAlternateScreen: () => void
  exitAlternateScreen: () => void
  pause: () => void
  resume: () => void
  suspendStdin: () => void
  resumeStdin: () => void
  forceRedraw: () => void
  invalidatePrevFrame: () => void
  // gracefulShutdown.ts calls these on the instances-map value — omitting them
  // threw a TypeError on every shutdown.
  isAltScreenActive: boolean
  unmount: () => void
  drainStdin: () => void
  detachForShutdown: () => void
  /** OSC-8 hyperlink click sink (see note above). Stored, not wired. */
  onHyperlinkClick: ((url: string) => void) | undefined
}

// Build the instances-map value: the renderer + root plus the Ink-leaked surface,
// each method delegating to the OpenTUI renderer. `suspend`/`resume` are typed
// private on CliRenderer but are present at runtime (renderer.d.ts §lifecycle);
// the localized casts here keep every call site clean.
function makeAdapterInstance(renderer: CliRenderer, root: OpenTuiRoot): AdapterInstance {
  const r = renderer as unknown as {
    suspend: () => void
    resume: () => void
    pause: () => void
    requestRender: () => void
  }
  // Cell-grid selection host. Native selection is suppressed by leaving every
  // adapter renderable non-selectable (so OpenTUI never auto-starts its own
  // selection on left-down); all mouse events bubble to the root onMouse below
  // and drive this controller. Created per renderer, keyed in the instances map.
  const selection = new SelectionController(renderer)
  wireRootMouse(renderer, selection)
  let altActive = true
  renderer.once(CliRenderEvents.DESTROY, () => {
    altActive = false
    selection.destroy()
  })
  const stdin = (renderer as unknown as { stdin?: NodeJS.ReadStream }).stdin ?? process.stdin
  return {
    renderer,
    root,
    selection,
    enterAlternateScreen: () => r.suspend(),
    exitAlternateScreen: () => r.resume(),
    pause: () => r.pause(),
    resume: () => r.resume(),
    suspendStdin: () => r.suspend(),
    resumeStdin: () => r.resume(),
    forceRedraw: () => r.requestRender(),
    invalidatePrevFrame: () => r.requestRender(),
    get isAltScreenActive() {
      return altActive
    },
    unmount: () => {
      altActive = false
      try {
        renderer.destroy()
      } catch {}
    },
    // Best-effort: clear pending input + detach so the shell gets a clean stdin
    // on exit (renderer.destroy already restores terminal modes).
    drainStdin: () => {
      try {
        while (stdin.read() !== null) {}
      } catch {}
    },
    detachForShutdown: () => {
      try {
        stdin.removeAllListeners('data')
        stdin.pause()
      } catch {}
    },
    onHyperlinkClick: undefined,
  }
}

const instances = new Map<NodeJS.WriteStream, AdapterInstance>()
export { instances }

// Resolve the SelectionController for a renderer (used by useSelection/
// useHasSelection/NoSelect). Scans the instances map for the matching renderer —
// there is one instance per process in practice, so this is O(1) typical.
export function controllerFor(renderer: CliRenderer): SelectionController | null {
  for (const inst of instances.values()) {
    if (inst.renderer === renderer) return inst.selection
  }
  return null
}

// Attach the single root-level mouse handler that drives the selection
// controller. OpenTUI dispatches every (unconsumed) mouse event to the hit
// renderable and bubbles it up via Renderable.processMouseEvent → parent, so the
// root renderable's onMouse receives all down/drag/drag-end/up. Native selection
// is suppressed (no renderable is selectable), so these never get consumed first.
//
// Coexists with the per-element onClick/hover handlers wired in focus-events.tsx:
// those fire during dispatch on the hit node and do NOT stopPropagation, so the
// event still bubbles here. We act only on the left button (button 0) for
// down/drag; up/drag-end always finish an in-flight drag (terminals encode
// release with varying button codes). move/over/out/scroll are left to the
// hover/wheel paths.
function wireRootMouse(renderer: CliRenderer, selection: SelectionController): void {
  renderer.root.onMouse = (e: OpenTuiMouseEvent): void => {
    switch (e.type) {
      case 'down':
        if (e.button !== 0) return
        selection.onMouseDown(e.x, e.y, e.modifiers.alt)
        return
      case 'drag':
        if (e.button !== 0) return
        selection.onMouseDrag(e.x, e.y)
        return
      case 'up':
      case 'drag-end':
        selection.onMouseUp()
        return
      default:
        return
    }
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

// Wrap every render with ThemeProvider so ThemedBox/ThemedText resolve without
// each call site mounting it — identical to src/ink.ts withTheme.
function withTheme(node: ReactNode): ReactNode {
  return createElement(ThemeProvider, null, node)
}

// Wrap with the full provider stack (AdapterApp: Stdin/App/TerminalSize/Focus/
// Clock/CursorDeclaration/TerminalWrite) + ThemeProvider — the same contexts the
// forked-Ink <App>+Ink class mount, so components' useContext calls resolve.
function withApp(renderer: CliRenderer, node: ReactNode): ReactNode {
  // CanvasBackground sits INSIDE withTheme (ThemeProvider) so it can read the
  // live theme; it paints the renderer canvas opaque.
  return createElement(
    AdapterApp,
    { renderer },
    withTheme(
      createElement(
        Fragment,
        null,
        createElement(CanvasBackground, { renderer }),
        node,
      ),
    ),
  )
}

function toConfig(opts: RenderOptions): CliRendererConfig {
  return {
    stdin: opts.stdin ?? process.stdin,
    stdout: opts.stdout ?? process.stdout,
    exitOnCtrlC: false,
    consoleMode: 'disabled',
    openConsoleOnError: false,
    useMouse: true,
  }
}

// waitUntilExit resolves when the renderer fires DESTROY. Memoized so repeated
// calls share one promise (matches Ink's waitUntilExit contract).
function makeWaitUntilExit(renderer: CliRenderer): () => Promise<void> {
  let promise: Promise<void> | null = null
  return () => {
    if (!promise) {
      promise = new Promise<void>(resolve => {
        renderer.once(CliRenderEvents.DESTROY, () => resolve())
      })
    }
    return promise
  }
}

// Ink's getOptions: a bare WriteStream arg means "use this as stdout".
function normalizeOptions(options?: NodeJS.WriteStream | RenderOptions): RenderOptions {
  if (!options) return {}
  if (options instanceof Stream) return { stdout: options as NodeJS.WriteStream }
  return options as RenderOptions
}

// ── public API (mirrors src/ink.ts render/createRoot) ─────────────────────────

export async function render(
  node: ReactNode,
  options?: NodeJS.WriteStream | RenderOptions,
): Promise<Instance> {
  const opts = normalizeOptions(options)
  const stdout = opts.stdout ?? process.stdout
  // Preserve the microtask boundary the old `await loadYoga()`/createCliRenderer
  // provided so the first frame settles after async startup (see ink/root.ts).
  const renderer = await createCliRenderer(toConfig(opts))
  // renderer.keyInput is the singleton key bus EVERY useInput() subscribes to
  // (keypress + paste). A real REPL mounts >10 input hooks, tripping Node's default
  // 10-listener leak warning (it bled into the rendered prompt). These are legit,
  // unmount-cleaned subscriptions on a central bus, so lift the cap to a finite,
  // generous 256 (not 0=unlimited) so a genuine runaway leak still trips the warning.
  renderer.keyInput.setMaxListeners(256)
  // Attach a FocusManager to renderer.root + Tab/Shift+Tab cycling (issue #15) so
  // focus(node)/autoFocus resolve and Tab navigation works (the Ink class did this).
  const disposeFocus = wireFocusManager(renderer)
  // Ctrl+Z → emit suspend/resume on the shared stdin emitter (issue #19).
  const disposeSuspend = wireSuspendResume(renderer)
  renderer.once(CliRenderEvents.DESTROY, () => {
    disposeFocus()
    disposeSuspend()
    // Match the forked-Ink contract (ink.tsx unmount → instances.delete): drop
    // the stdout-keyed entry on EVERY teardown path (unmount, useApp().exit(),
    // AdapterApp exit all fire DESTROY). Otherwise instances.get(stdout) keeps
    // returning an AdapterInstance whose renderer is already destroyed, and
    // repeated render()/createRoot() (staticRender, /export, /context, /plan)
    // each leak one dead entry + retained renderer graph — unbounded growth.
    // Guard by identity: a concurrent render() on the same stdout overwrites
    // the entry, and this older renderer's DESTROY must not delete the newer.
    if (instances.get(stdout) === self) instances.delete(stdout)
  })
  const root = openTuiCreateRoot(renderer)
  const self = makeAdapterInstance(renderer, root)
  instances.set(stdout, self)
  root.render(withApp(renderer, node))
  const waitUntilExit = makeWaitUntilExit(renderer)
  return {
    rerender: next => root.render(withApp(renderer, next)),
    unmount: () => renderer.destroy(),
    waitUntilExit,
    cleanup: () => instances.delete(stdout),
  }
}

export async function createRoot(options?: RenderOptions): Promise<Root> {
  const opts = options ?? {}
  const stdout = opts.stdout ?? process.stdout
  const renderer = await createCliRenderer(toConfig(opts))
  // See render(): central key bus, >10 useInput subscribers, lift the leak cap.
  renderer.keyInput.setMaxListeners(256)
  const disposeFocus = wireFocusManager(renderer)
  const disposeSuspend = wireSuspendResume(renderer)
  renderer.once(CliRenderEvents.DESTROY, () => {
    disposeFocus()
    disposeSuspend()
    // Match the forked-Ink contract (ink.tsx unmount → instances.delete): drop
    // the stdout-keyed entry on EVERY teardown path (unmount, useApp().exit(),
    // AdapterApp exit all fire DESTROY). Otherwise instances.get(stdout) keeps
    // returning an AdapterInstance whose renderer is already destroyed, and
    // repeated render()/createRoot() (staticRender, /export, /context, /plan)
    // each leak one dead entry + retained renderer graph — unbounded growth.
    // Guard by identity: a concurrent render() on the same stdout overwrites
    // the entry, and this older renderer's DESTROY must not delete the newer.
    if (instances.get(stdout) === self) instances.delete(stdout)
  })
  const root = openTuiCreateRoot(renderer)
  const self = makeAdapterInstance(renderer, root)
  instances.set(stdout, self)
  const waitUntilExit = makeWaitUntilExit(renderer)
  return {
    render: node => root.render(withApp(renderer, node)),
    unmount: () => renderer.destroy(),
    waitUntilExit,
  }
}
