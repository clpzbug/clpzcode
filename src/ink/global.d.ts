// Stub — global types for Ink renderer
// Augment React.JSX (required for jsx: react-jsx transform)
import type {} from 'react'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'ink-box': Record<string, unknown>
      'ink-text': Record<string, unknown>
      'ink-root': Record<string, unknown>
      'ink-virtual-text': Record<string, unknown>
      'ink-link': Record<string, unknown>
      'ink-progress': Record<string, unknown>
      'ink-raw-ansi': Record<string, unknown>
    }
  }
}
