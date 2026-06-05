// src/tui/design/tokens.ts
//
// Zen minimalista — design tokens (pure data, no React).
//
// Princípio: UM único accent (o roxo do tema, `theme.claude`/`theme.autoAccept`
// = rgb(178,145,220) no dark). Todo o resto é hierarquia de peso e de dim —
// nunca uma segunda cor decorativa. Cores semânticas (success/error/warning)
// existem para SINAL, não para enfeite, e só aparecem em estados reais.
//
// Estes tokens são `keyof Theme`, então resolvem automaticamente em qualquer
// tema (dark/light/ansi/pentest) via ThemedText/color(). Nada de RGB aqui.

import type { Theme } from '../../utils/theme.js'

/**
 * Escala de espaçamento horizontal/vertical, em CÉLULAS de terminal.
 * Base = gutter de 2. Use SEMPRE estes degraus em `gap`, `marginLeft`,
 * `paddingX` etc. — nunca números soltos. Mantém o ritmo vertical consistente.
 *
 *   none  0  — colado
 *   tight 1  — separador inline (glyph→label)
 *   gutter 2 — indentação padrão de um bloco / coluna
 *   loose 3  — separação entre grupos relacionados
 *   block 4  — separação entre seções
 */
export const SPACE = {
  none: 0,
  tight: 1,
  gutter: 2,
  loose: 3,
  block: 4,
} as const

export type SpaceStep = keyof typeof SPACE

/** O gutter canônico. Indentação de qualquer conteúdo sob um marcador. */
export const GUTTER = SPACE.gutter // 2

/**
 * Papéis de cor da linguagem. São APELIDOS semânticos sobre `keyof Theme`,
 * então passam direto para `<Text color={...}>`. A intenção é restringir o
 * vocabulário: a UI minimalista usa quase só `accent`, `text` e `muted`.
 *
 * - accent  → o roxo único. Use com PARCIMÔNIA: estado ativo, prompt, foco.
 * - text    → conteúdo normal (sem dim).
 * - muted   → tudo que é secundário/concluído. Esta é a cor "padrão" da UI Zen.
 * - faint   → cromo de fundo (divisor-fantasma, hints). Quase invisível.
 * - signal* → SÓ para estados reais (ok/erro/atenção). Nunca decorativo.
 */
export const ROLE = {
  accent: 'claude',
  text: 'text',
  muted: 'inactive',
  faint: 'subtle',
  signalOk: 'success',
  signalError: 'error',
  signalWarn: 'warning',
} as const satisfies Record<string, keyof Theme>

export type ColorRole = keyof typeof ROLE

/** Resolve um papel para a `keyof Theme` concreta (para color() / <Text color>). */
export function role(r: ColorRole): keyof Theme {
  return ROLE[r]
}

/**
 * Hierarquia de PESO. Regra Zen: quase nada de bold. O destaque vem de COR
 * (accent) e de DIM (recuo do secundário), não de peso. `bold` fica reservado
 * a no máximo um título por tela.
 *
 * Cada nível mapeia para as props que você passa a `<Text>`:
 *   primary   — conteúdo em foco: cor de texto cheia, sem dim, sem bold.
 *   secondary — o "padrão" da UI: dimColor. Sereno, recuado.
 *   title     — único uso legítimo de bold. Um por tela.
 */
export type WeightLevel = 'primary' | 'secondary' | 'title'

export type TextWeight = {
  readonly dimColor?: boolean
  readonly bold?: boolean
}

export const WEIGHT: Record<WeightLevel, TextWeight> = {
  primary: { dimColor: false, bold: false },
  secondary: { dimColor: true, bold: false },
  title: { dimColor: false, bold: true },
}

/** Spread-helper: `<Text {...weight('secondary')}>`. */
export function weight(level: WeightLevel): TextWeight {
  return WEIGHT[level]
}
