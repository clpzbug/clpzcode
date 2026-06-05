// src/tui/startup/BootReveal.tsx
//
// Linha de inicialização do TUI: "clpzcode v<versão>".
//
// Porte opencode: a MARCA recebe a cor do accent (no tema clpzcode = roxo pastel)
// + peso de título, com uma régua sub-pixel ▔ na mesma cor por baixo —
// um "mark" de marca enxuto, sem arte ASCII arriscada. Versão em peso dim.

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { role, weight } from '../design/index.js'

type BootRevealProps = {
  /** Marca exibida ao lado do mark. @default 'clpzcode' */
  brand?: string
  /** Versão (ex.: "1.2.3"), exibida dim após a marca. Omitir = sem versão. */
  version?: string
}

/**
 * Linha única de boot:  clpzcode  v1.2.3
 * Marca em peso de título; versão dim.
 */
export function BootReveal({
  brand = 'clpzcode',
  version,
}: BootRevealProps): React.ReactNode {
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1} alignItems="center">
        <Text color={role('accent')} {...weight('title')}>
          {brand}
        </Text>
        {version ? <Text color={role('faint')}>v{version}</Text> : null}
      </Box>
      <Text color={role('accent')} dimColor>{'▔'.repeat(brand.length)}</Text>
    </Box>
  )
}
