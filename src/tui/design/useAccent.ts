// src/tui/design/useAccent.ts
//
// O accent ÚNICO da TUI, resolvido para o tema atual. Use só quando precisar
// da string de cor crua (helpers não-React, animações). Em JSX prefira
// `<Text color={role('accent')}>`, que já resolve via ThemedText.

import { useTheme } from '../../ink.js'
import { getTheme } from '../../utils/theme.js'
import { ROLE } from './tokens.js'

/** Cor crua do accent (ex.: "rgb(178,145,220)" no dark) para o tema atual. */
export function useAccent(): string {
  const [themeName] = useTheme()
  return getTheme(themeName)[ROLE.accent]
}
