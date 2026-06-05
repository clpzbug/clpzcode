/**
 * Early Input Capture
 *
 * This module captures terminal input that is typed before the REPL is fully
 * initialized. Users often type `claude` and immediately start typing their
 * prompt, but those early keystrokes would otherwise be lost during startup.
 *
 * Usage:
 * 1. Call startCapturingEarlyInput() as early as possible in cli.tsx
 * 2. When REPL is ready, call consumeEarlyInput() to get any buffered text
 * 3. stopCapturingEarlyInput() is called automatically when input is consumed
 */

import { lastGrapheme } from './intl.js'

// Buffer for early input characters
let earlyInputBuffer = ''
// Flag to track if we're currently capturing
let isCapturing = false
// Reference to the readable handler so we can remove it later
let readableHandler: (() => void) | null = null

// Cross-chunk escape-sequence parser state. Capability-query replies (OSC/DCS/
// APC/CSI) sent by the renderer on startup can arrive split across reads; the
// state carries across processChunk() calls so a sequence straddling a chunk
// boundary is still skipped wholesale instead of leaking its tail as text.
type EscState = 'none' | 'esc' | 'csi' | 'ss3' | 'string'
let escState: EscState = 'none'
// Inside a string sequence (OSC/DCS/…): the previous byte was ESC, so a trailing
// backslash completes the ST (ESC \) terminator.
let stringSawEsc = false

/**
 * Start capturing stdin data early, before the REPL is initialized.
 * Should be called as early as possible in the startup sequence.
 *
 * Only captures if stdin is a TTY (interactive terminal).
 */
export function startCapturingEarlyInput(): void {
  // Only capture in interactive mode: stdin must be a TTY, and we must not
  // be in print mode. Raw mode disables ISIG (terminal Ctrl+C → SIGINT),
  // which would make -p uninterruptible.
  if (
    !process.stdin.isTTY ||
    isCapturing ||
    process.argv.includes('-p') ||
    process.argv.includes('--print')
  ) {
    return
  }

  isCapturing = true
  earlyInputBuffer = ''
  escState = 'none'
  stringSawEsc = false

  // Set stdin to raw mode and use 'readable' event like Ink does
  // This ensures compatibility with how the REPL will handle stdin later
  try {
    process.stdin.setEncoding('utf8')
    process.stdin.setRawMode(true)
    process.stdin.ref()

    readableHandler = () => {
      let chunk = process.stdin.read()
      while (chunk !== null) {
        if (typeof chunk === 'string') {
          processChunk(chunk)
        }
        chunk = process.stdin.read()
      }
    }

    process.stdin.on('readable', readableHandler)
  } catch {
    // If we can't set raw mode, just silently continue without early capture
    isCapturing = false
  }
}

/**
 * Process a chunk of input data
 */
function processChunk(str: string): void {
  let i = 0
  while (i < str.length) {
    const char = str[i]!
    const code = char.charCodeAt(0)

    // ── escape-sequence skipping (stateful, spans chunks) ──────────────────────
    // The renderer queries terminal capabilities on startup (colors, version,
    // DECRQM modes, kitty keyboard/graphics, OSC 99 notifications, DA1, cursor
    // position). Those replies arrive while we're still capturing and must be
    // discarded wholesale — NOT buffered as text. The old single-pass skip
    // treated the CSI/OSC/DCS introducer ('[' ']' 'P', all in 0x40-0x7E) as the
    // terminator, so it stopped one byte in and leaked the rest of every reply
    // into the prompt. A real escape-sequence state machine fixes that.
    if (escState !== 'none') {
      switch (escState) {
        case 'esc':
          if (code === 0x5b)
            escState = 'csi' // '[' CSI
          else if (code === 0x4f)
            escState = 'ss3' // 'O' SS3 — exactly one final byte follows
          else if (code === 0x5d || code === 0x50 || code === 0x5f || code === 0x5e || code === 0x58)
            escState = 'string' // ']' OSC, 'P' DCS, '_' APC, '^' PM, 'X' SOS
          else escState = 'none' // ESC + single byte (Alt-key / two-char Fe)
          break
        case 'csi':
          // Params (0x30-0x3F) + intermediates (0x20-0x2F) precede the final
          // byte (0x40-0x7E), which ends the sequence.
          if (code >= 0x40 && code <= 0x7e) escState = 'none'
          break
        case 'ss3':
          escState = 'none' // one byte after ESC O (e.g. ESC O P = F1)
          break
        case 'string':
          // OSC/DCS/APC/PM/SOS run until BEL (0x07) or ST (ESC \).
          if (stringSawEsc) {
            stringSawEsc = false
            if (code === 0x5c) escState = 'none' // ST: ESC \
            else if (code === 0x1b) stringSawEsc = true // back-to-back ESC
          } else if (code === 0x07) {
            escState = 'none' // BEL terminator
          } else if (code === 0x1b) {
            stringSawEsc = true
          }
          break
      }
      i++
      continue
    }

    // Ctrl+C (code 3) - stop capturing and exit immediately.
    // We use process.exit here instead of gracefulShutdown because at this
    // early stage of startup, the shutdown machinery isn't initialized yet.
    if (code === 3) {
      stopCapturingEarlyInput()
      // eslint-disable-next-line custom-rules/no-process-exit
      process.exit(130) // Standard exit code for Ctrl+C
      return
    }

    // Ctrl+D (code 4) - EOF, stop capturing
    if (code === 4) {
      stopCapturingEarlyInput()
      return
    }

    // Backspace (code 127 or 8) - remove last grapheme cluster
    if (code === 127 || code === 8) {
      if (earlyInputBuffer.length > 0) {
        const last = lastGrapheme(earlyInputBuffer)
        earlyInputBuffer = earlyInputBuffer.slice(0, -(last.length || 1))
      }
      i++
      continue
    }

    // Begin an escape sequence — hand off to the state machine above.
    if (code === 27) {
      escState = 'esc'
      i++
      continue
    }

    // Skip other control characters (except tab and newline)
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      i++
      continue
    }

    // Convert carriage return to newline
    if (code === 13) {
      earlyInputBuffer += '\n'
      i++
      continue
    }

    // Add printable characters and allowed control chars to buffer
    earlyInputBuffer += char
    i++
  }
}

/**
 * Stop capturing early input.
 * Called automatically when input is consumed, or can be called manually.
 */
export function stopCapturingEarlyInput(): void {
  if (!isCapturing) {
    return
  }

  isCapturing = false

  if (readableHandler) {
    process.stdin.removeListener('readable', readableHandler)
    readableHandler = null
  }

  // Don't reset stdin state - the REPL's Ink App will manage stdin state.
  // If we call setRawMode(false) here, it can interfere with the REPL's
  // own stdin setup which happens around the same time.
}

/**
 * Consume any early input that was captured.
 * Returns the captured input and clears the buffer.
 * Automatically stops capturing when called.
 */
export function consumeEarlyInput(): string {
  stopCapturingEarlyInput()
  const input = earlyInputBuffer.trim()
  earlyInputBuffer = ''
  return input
}

/**
 * Check if there is any early input available without consuming it.
 */
export function hasEarlyInput(): boolean {
  return earlyInputBuffer.trim().length > 0
}

/**
 * Seed the early input buffer with text that will appear pre-filled
 * in the prompt input when the REPL renders. Does not auto-submit.
 */
export function seedEarlyInput(text: string): void {
  earlyInputBuffer = text
}

/**
 * Check if early input capture is currently active.
 */
export function isCapturingEarlyInput(): boolean {
  return isCapturing
}
