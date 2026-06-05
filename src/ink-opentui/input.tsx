// src/ink-opentui/input.tsx
//
// OpenTUI-backed keyboard/stdin layer. Reimplements the public surface of
//   src/ink/hooks/use-input.ts   (useInput)
//   src/ink/hooks/use-stdin.ts   (useStdin)
//   src/ink/events/input-event.ts (InputEvent, Key)
// so the 643 clpzcode components that destructure `(input, key)` from useInput
// mount on OpenTUI unchanged.
//
// THE TRANSLATION (the riskiest part). In real Ink, the <App> parses raw stdin
// bytes via parse-keypress.ts and emits a clpzcode InputEvent on an internal
// EventEmitter; useInput listens there. Under OpenTUI, the RENDERER owns stdin
// parsing and emits its OWN KeyEvent on renderer.keyInput ("keypress"). We do
// NOT reparse bytes. Instead we map each OpenTUI KeyEvent → a clpzcode ParsedKey
// (the two parsers share the same key-name vocabulary: "up"/"down"/"left"/
// "right"/"pageup"/"pagedown"/"return"/"escape"/"tab"/"backspace"/"delete"/
// "home"/"end" + the printable char), then hand that ParsedKey to clpzcode's
// existing InputEvent constructor — which runs the PROVEN parseKey() to derive
// the exact Key object and `input` string the handlers expect. Reusing
// InputEvent means the Key shape, the meta/escape coupling, the
// nonAlphanumericKeys input-clearing, and the ctrl/shift rules are byte-for-byte
// identical to the forked Ink. We only own the KeyEvent→ParsedKey adaptation.
//
// Capabilities NOT available from an OpenTUI KeyEvent are set false on the
// ParsedKey: `fn` (no fn field on KeyEvent) and wheelUp/wheelDown (OpenTUI has
// no wheel keys — scroll is a mouse event, routed elsewhere). parseKey() only
// sets key.wheelUp/wheelDown when name === "wheelup"/"wheeldown", which our
// translation never produces, so those land false automatically.

import { useLayoutEffect, useMemo } from 'react'
import { useEventCallback } from 'usehooks-ts'
import { useRenderer } from '@opentui/react'
import {
  decodePasteBytes,
  type CliRenderer,
  type KeyEvent,
  type PasteEvent,
} from '@opentui/core'
import { InputEvent, type Key } from '../ink/events/input-event.js'
import type { ParsedKey } from '../ink/parse-keypress.js'
import { EventEmitter } from '../ink/events/emitter.js'
import type { Props as StdinContextProps } from '../ink/components/StdinContext.js'

// ── per-renderer stdin event emitter (shared) ──────────────────────────────────
// REPL attaches its suspend/resume (and terminalfocus) listeners to the emitter it
// gets from useStdin().internal_eventEmitter. For the render-layer Ctrl+Z handler
// (wireSuspendResume) to reach those listeners, every useStdin() call for a given
// renderer MUST return the SAME emitter — so we key one emitter per renderer here
// instead of minting a fresh one per call site. WeakMap so it's GC'd with the
// renderer. (Identity stays stable across renders → REPL's effect dep won't churn.)
const stdinEmitters = new WeakMap<CliRenderer, EventEmitter>()

export function getStdinEmitter(renderer: CliRenderer): EventEmitter {
  let emitter = stdinEmitters.get(renderer)
  if (!emitter) {
    emitter = new EventEmitter()
    stdinEmitters.set(renderer, emitter)
  }
  return emitter
}

// Re-export the canonical Key type and InputEvent so callers importing them
// from the adapter (mirroring src/ink.ts) get the SAME identities the rest of
// the KEEP code uses — no parallel Key shape is ever introduced.
export { InputEvent }
export type { Key }

type Handler = (input: string, key: Key, event: InputEvent) => void

type Options = {
  /**
   * Enable or disable capturing of user input.
   * Useful when there are multiple useInput hooks used at once to avoid handling the same input several times.
   *
   * @default true
   */
  isActive?: boolean
}

// Map one OpenTUI KeyEvent onto a clpzcode ParsedKey. The two share key names,
// so `name` passes through verbatim (parseKey keys all its arrow/return/etc.
// detection off `name`). Modifiers pass through; `super` is optional on the
// OpenTUI event (?? false). `fn` is unavailable on a KeyEvent → false. `code`
// is forwarded only when present (parseKey uses it to suppress unmapped
// function-key sequences). `kind`/`isPasted` are the literals parseKey expects;
// OpenTUI surfaces pastes on a separate "paste" channel, so a keypress is never
// a paste here.
export function toParsedKey(e: KeyEvent): ParsedKey {
  return {
    kind: 'key',
    name: e.name,
    fn: false,
    ctrl: e.ctrl,
    meta: e.meta,
    shift: e.shift,
    option: e.option,
    super: e.super ?? false,
    sequence: e.sequence,
    raw: e.raw,
    code: e.code,
    isPasted: false,
  }
}

// Build the clpzcode paste ParsedKey from pasted text. Mirrors the (module-private)
// createPasteKey in parse-keypress.ts: a single event with the WHOLE pasted string
// in `sequence` (parseKey derives input = sequence) and isPasted:true so handlers
// can branch on key.isPasted (issue #18). No key modifiers/name on a paste.
function toPasteKey(content: string): ParsedKey {
  return {
    kind: 'key',
    name: '',
    fn: false,
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    super: false,
    sequence: content,
    raw: content,
    isPasted: true,
  }
}

/**
 * This hook is used for handling user input.
 * It's a more convenient alternative to using `StdinContext` and listening to `data` events.
 * The callback you pass to `useInput` is called for each character when user enters any input.
 * However, if user pastes text and it's more than one character, the callback will be called only once and the whole string will be passed as `input`.
 *
 * ```
 * import {useInput} from 'ink';
 *
 * const UserInput = () => {
 *   useInput((input, key) => {
 *     if (input === 'q') {
 *       // Exit program
 *     }
 *
 *     if (key.leftArrow) {
 *       // Left arrow key pressed
 *     }
 *   });
 *
 *   return …
 * };
 * ```
 */
const useInput = (inputHandler: Handler, options: Options = {}) => {
  const renderer = useRenderer()
  // The renderer owns raw mode under OpenTUI, so the Ink setRawMode effect is
  // gone (it would fight the renderer for the TTY). The keyInput EventEmitter
  // is the only subscription surface we need.

  // Mirror Ink's stable-listener discipline: register once with a stable
  // reference (useEventCallback reads the latest isActive/inputHandler from the
  // closure) so the slot in keyInput's listener array never moves on
  // isActive false→true. Like Ink's plain emit('input'), every active hook fires
  // for each key — there is NO stopPropagation between useInput hooks (that lives
  // only in the dropped onKeyDown DOM-bubbling path); the stable order still
  // matters because OpenTUI's keyInput honors a KeyEvent's propagationStopped
  // between listeners in registration order.
  const handleKeypress = useEventCallback((e: KeyEvent) => {
    if (options.isActive === false) {
      return
    }
    // OpenTUI emits press + repeat on "keypress" (release goes to a separate
    // "keyrelease" channel). Defensively skip release in case a caller injects
    // one — Ink's useInput never fired on key release.
    if (e.eventType === 'release') {
      return
    }

    // Build the clpzcode InputEvent from the translated ParsedKey. Its
    // constructor runs the proven parseKey() to produce {key, input}, so the
    // Key shape and input derivation match forked Ink exactly.
    const event = new InputEvent(toParsedKey(e))
    const { input, key } = event

    // clpzcode owns Ctrl+C (render.tsx sets exitOnCtrlC:false on the renderer),
    // so it always flows through to the handler — matching the real useInput
    // path where internal_exitOnCtrlC is false. We keep the guard shape for
    // parity but the renderer never self-exits on Ctrl+C.
    inputHandler(input, key, event)
  })

  // Bracketed paste arrives on a SEPARATE "paste" channel under OpenTUI (the
  // KeyHandler emits a PasteEvent), not interleaved into "keypress" bytes the way
  // forked Ink's parser produced an isPasted ParsedKey. Decode the bytes to text
  // and feed it as ONE InputEvent with isPasted:true so useInput callbacks see the
  // whole paste in `input` and can branch on event.keypress.isPasted — matching
  // Ink's contract (and usePasteHandler, which reads event.keypress.isPasted). (#18)
  const handlePaste = useEventCallback((e: PasteEvent) => {
    if (options.isActive === false) return
    // Emit even for an EMPTY paste — forked Ink does (parse-keypress.ts), and
    // usePasteHandler's macOS image-paste branch fires exactly on isPasted &&
    // input.length === 0.
    const content = decodePasteBytes(e.bytes)
    const event = new InputEvent(toPasteKey(content))
    inputHandler(event.input, event.key, event)
  })

  // useLayoutEffect (not useEffect): register synchronously during commit so no
  // keypress slips through after the renderer is live but before the listener
  // attaches — same rationale as Ink's use-input.ts.
  useLayoutEffect(() => {
    const keyInput = renderer.keyInput
    keyInput.on('keypress', handleKeypress)
    keyInput.on('paste', handlePaste)
    return () => {
      keyInput.off('keypress', handleKeypress)
      keyInput.off('paste', handlePaste)
    }
  }, [renderer, handleKeypress, handlePaste])
}

export default useInput

// ── useStdin (mirrors src/ink/hooks/use-stdin.ts + StdinContext value shape) ──
//
// Ink's useStdin reads StdinContext, whose value <App> supplies. Under OpenTUI
// there is no <App>/StdinContext provider, and the renderer owns the TTY, so we
// synthesize the same value shape directly off the renderer. The return type IS
// the canonical StdinContext `Props` (reused via `import type`), so every field
// the 643 components (and the two real KEEP consumers below) destructure exists
// and matches Ink's identities exactly:
//   - stdin: the renderer's stdin stream.
//   - setRawMode: a REFCOUNTING NO-OP. The renderer holds the TTY in raw mode
//     for its lifetime; components that call setRawMode(true)/(false) (via the
//     Ink useInput effect they may still carry, or directly) must not toggle the
//     terminal out from under the renderer. We track the depth so the contract
//     ("balanced true/false calls, never disables while still requested") is
//     observable, but we never touch the real TTY.
//   - isRawModeSupported: true (a live renderer always has a raw-mode TTY).
//   - internal_exitOnCtrlC: false (render.tsx forces exitOnCtrlC:false).
//   - internal_eventEmitter: a stable, real clpzcode EventEmitter (the SAME
//     class Ink uses). REPL.tsx does `internal_eventEmitter?.on('suspend'|
//     'resume', …)`, so it must be a live emitter for those listeners to attach
//     without throwing. Under OpenTUI there is no Ink <App> SIGTSTP handler to
//     EMIT 'suspend'/'resume' (the renderer owns the TTY and Ctrl+Z handling),
//     so the listeners simply never fire — Ctrl+Z suspend/resume is a residual
//     gap, not a crash. The emitter is memoized per renderer so the identity is
//     stable across renders (REPL's effect dep `[internal_eventEmitter]` must
//     not re-run every commit).
//   - internal_querier: null. ThemeProvider.tsx reads `internal_querier` and
//     guards with `!internal_querier`, so OSC-11 live auto-theme is gracefully
//     disabled (the seed-from-$COLORFGBG path still works). The OpenTUI renderer
//     does not expose clpzcode's TerminalQuerier; wiring one would require
//     reparsing the renderer's stdin, which is out of scope for this module.

// EXPORT-SHAPE CONTRACT FOR THE BARREL:
// `src/ink.ts` re-exports useStdin as `export { default as useStdin } from
// '.../use-stdin.js'` (Ink's use-stdin.ts has useStdin as its DEFAULT). This
// combined module's DEFAULT is `useInput`, so the barrel CANNOT pull useStdin
// from the default here. useStdin is therefore exposed as a NAMED export and the
// barrel MUST mirror it as `export { useStdin } from './ink-opentui/input.js'`
// (NOT `{ default as useStdin }`). Likewise useInput stays the default export so
// the barrel's `export { default as useInput }` resolves correctly.

export const useStdin = (): StdinContextProps => {
  const renderer = useRenderer()

  return useMemo<StdinContextProps>(() => {
    // Refcount raw-mode requests but never touch the TTY — the renderer owns it.
    let rawModeDepth = 0
    const setRawMode = (value: boolean): void => {
      rawModeDepth += value ? 1 : -1
      if (rawModeDepth < 0) rawModeDepth = 0
    }

    return {
      stdin: renderer.stdin as NodeJS.ReadStream,
      setRawMode,
      isRawModeSupported: true,
      internal_exitOnCtrlC: false,
      // Shared per-renderer emitter so the render-layer Ctrl+Z handler
      // (wireSuspendResume, issue #19) emits 'suspend'/'resume' on the SAME
      // emitter REPL listens on.
      internal_eventEmitter: getStdinEmitter(renderer),
      // No TerminalQuerier under OpenTUI; ThemeProvider guards with `!querier`.
      internal_querier: null,
    }
  }, [renderer])
}

// ── suspend/resume (Ctrl+Z) wiring (issue #19) ──────────────────────────────────
//
// Forked Ink's <App> caught Ctrl+Z, emitted 'suspend' on internal_eventEmitter,
// SIGSTOP'd the process, and on SIGCONT re-enabled the TTY + emitted 'resume'
// (App.tsx handleSuspend). OpenTUI owns the TTY and has no such handler, so the
// render layer calls this once per renderer: it watches keyInput for Ctrl+Z and
// runs the same suspend→SIGSTOP→SIGCONT→resume dance, emitting on the renderer's
// shared stdin emitter so REPL's suspend/resume listeners fire.
//
// SIGSTOP/SIGCONT are POSIX-only (App gated on platform !== 'win32'). The renderer
// destroy on suspend would tear down the frame; instead we leave the renderer alone
// and just stop the process — on SIGCONT we request a fresh render so the frame
// repaints over the shell prompt. Returns a disposer for the render layer.
export function wireSuspendResume(renderer: CliRenderer): () => void {
  if (process.platform === 'win32') return () => {}

  const emitter = getStdinEmitter(renderer)

  const onKeypress = (e: KeyEvent): void => {
    if (e.eventType === 'release') return
    if (!(e.name === 'z' && e.ctrl)) return

    emitter.emit('suspend')

    const resumeHandler = (): void => {
      process.removeListener('SIGCONT', resumeHandler)
      // Repaint the frame after returning from the shell (the renderer's buffer is
      // intact; just force a redraw over whatever the shell left on screen).
      renderer.requestRender()
      emitter.emit('resume')
    }
    process.once('SIGCONT', resumeHandler)
    process.kill(process.pid, 'SIGSTOP')
  }

  renderer.keyInput.on('keypress', onKeypress)
  return () => {
    renderer.keyInput.off('keypress', onKeypress)
  }
}
