// src/tui/startup/WelcomeHero.tsx
//
// Minimal welcome: the wordmark/hero art has been removed so the empty-state
// boot goes straight to a clean prompt. Kept as a no-op component so the REPL
// mount site (which still renders <WelcomeHero compact={...} />) stays valid.

import type * as React from 'react'

export function WelcomeHero(_props: { compact?: boolean } = {}): React.ReactNode {
  return null
}
