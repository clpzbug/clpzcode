// src/ink-opentui/index.ts
//
// Barrel for the Ink→OpenTUI adapter. Mirrors the EXACT named + type surface of
// src/ink.ts, sourced from the runtime-proven adapter modules in this directory.
// Where no adapter module yet owns a given export, it is re-exported from the
// original ../ink (or ../components) source as a temporary PASSTHROUGH; replacing
// those is tracked in the follow-up tasks below (see "gaps").

// ── render lifecycle (render.tsx) ──────────────────────────────────────────────
export { render, createRoot } from './render.js'
export type { RenderOptions, Instance, Root } from './render.js'

// ── public (theme-aware) Box / Text + color (themed.tsx) ───────────────────────
// themed.tsx is ONE combined module whose `default` is ThemedBox, so the Text path
// MUST use the named `Text` export (never the default). Both are exposed under the
// ink.ts public names (Box/Text) via named exports here.
export { Box, Text, color } from './themed.js'
export type { ThemedBoxProps as BoxProps } from './themed.js'
export type { ThemedTextProps as TextProps } from './themed.js'

// ── ThemeProvider + theme hooks (PASSTHROUGH — no adapter module yet) ──────────
export {
  ThemeProvider,
  usePreviewTheme,
  useTheme,
  useThemeSetting,
} from '../components/design-system/ThemeProvider.js'

// ── base (raw, non-theme) Box / Text (Box.tsx / Text.tsx) ──────────────────────
// The adapters re-export neither BaseBox/BaseText names nor their Props types, so
// the names come from the adapter defaults and the (renderer-agnostic) Props types
// come from the exact original ink source the adapters consume.
export { default as BaseBox } from './Box.js'
export type { Props as BaseBoxProps } from '../ink/components/Box.js'
export { default as BaseText } from './Text.js'
export type { Props as BaseTextProps } from '../ink/components/Text.js'

// ── layout / text long-tail (layout-misc.tsx) ──────────────────────────────────
export {
  Ansi,
  RawAnsi,
  NoSelect,
  Spacer,
  Newline,
  measureElement,
  wrapText,
} from './layout-misc.js'
export type { NewlineProps } from './layout-misc.js'
export type { DOMElement } from './layout-misc.js'

// ── controls: Button + Link (controls.tsx) ─────────────────────────────────────
export { Button, Link } from './controls.js'
export type { ButtonProps, ButtonState, LinkProps } from './controls.js'

// ── events + focus (focus-events.tsx) ──────────────────────────────────────────
export { Event, EventEmitter, ClickEvent, TerminalFocusEvent } from './focus-events.js'
export type { TerminalFocusEventType } from './focus-events.js'
export { FocusManager } from './focus-events.js'
export { useTerminalFocus } from './focus-events.js'

// ── input: useInput / useStdin / InputEvent / Key (input.tsx) ──────────────────
// useInput is the module default; useStdin is a NAMED export (NOT the default) —
// mirror it as `useStdin`, never `default as useStdin`.
export { default as useInput, useStdin, InputEvent } from './input.js'
export type { Key } from './input.js'
// StdinProps type (PASSTHROUGH — no adapter module yet).
export type { Props as StdinProps } from '../ink/components/StdinContext.js'

// ── app + remaining hooks (hooks-extra.tsx) ────────────────────────────────────
export { default as useApp } from './hooks-extra.js'
export type { AppProps } from './hooks-extra.js'
export {
  useAnimationFrame,
  useAnimationTimer,
  useInterval,
  useSelection,
  useTabStatus,
  useTerminalTitle,
  useTerminalViewport,
  supportsTabStatus,
} from './hooks-extra.js'

// ── frame (PASSTHROUGH — no adapter module yet) ────────────────────────────────
export type { FlickerReason } from '../ink/frame.js'
