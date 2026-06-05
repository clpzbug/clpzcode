// src/tui/design/Row.tsx
//
// Primitivas de layout Zen, tipadas sobre Box/Text de ink.js. Todas consomem
// a escala (SPACE/GUTTER), os papéis de cor (role) e o vocabulário (GLYPH) —
// nenhum número mágico ou caractere solto fora de tokens.ts/glyphs.ts.

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import {
  GLYPH,
  type GlyphName,
  toolGlyph,
  toolGlyphRole,
  type ToolState,
} from './glyphs.js'
import {
  type ColorRole,
  GUTTER,
  role,
  SPACE,
  type SpaceStep,
  weight,
  type WeightLevel,
} from './tokens.js'

/* ------------------------------------------------------------------ Row -- */

type RowProps = {
  children: React.ReactNode
  /** Empurra `trailing` para a borda direita (flexGrow no meio). */
  trailing?: React.ReactNode
  /** Espaço entre filhos, pela escala. @default 'tight' */
  gap?: SpaceStep
  /** Ocupa a largura toda (necessário para `trailing` alinhar à direita). */
  fill?: boolean
  /** Alinhamento vertical dos filhos. @default 'center' */
  align?: 'center' | 'flex-start' | 'flex-end'
}

/**
 * Linha horizontal. Com `trailing`, alinha o conteúdo à esquerda e o trailing
 * à direita — a primitiva de "label … valor" da statusline e dos cabeçalhos.
 *
 * @example
 * <Row trailing={<Text dimColor>2.3s</Text>} fill>
 *   <ZenGlyph name="toolActive" role="accent" />
 *   <Text>Reading file</Text>
 * </Row>
 */
export function Row({
  children,
  trailing,
  gap = 'tight',
  fill = false,
  align = 'center',
}: RowProps): React.ReactNode {
  return (
    <Box
      flexDirection="row"
      gap={SPACE[gap]}
      alignItems={align}
      {...(fill ? { width: '100%' as const } : {})}
    >
      {children}
      {trailing ? (
        <>
          <Box flexGrow={1} />
          {trailing}
        </>
      ) : null}
    </Box>
  )
}

/* --------------------------------------------------------------- Gutter -- */

type GutterProps = {
  children: React.ReactNode
  /** Largura do recuo à esquerda, pela escala. @default GUTTER (2). */
  size?: SpaceStep
}

/**
 * Indentação canônica de um bloco — recuo de `GUTTER` (2) à esquerda. Use para
 * aninhar conteúdo sob um marcador (output de tool sob o ToolMarker, etc.).
 */
export function Gutter({ children, size }: GutterProps): React.ReactNode {
  const ml = size ? SPACE[size] : GUTTER
  return <Box marginLeft={ml}>{children}</Box>
}

/* --------------------------------------------------------- GhostDivider -- */

type GhostDividerProps = {
  /** Largura em células. @default 24 (curto e discreto, não atravessa a tela). */
  width?: number
}

/**
 * Divisor-fantasma: régua de pontos finos na cor `faint`. Separa grupos sem o
 * peso de uma linha cheia. Prefira isto ao Divider de `─` na UI minimalista —
 * a tela respira. Curto por padrão: um respiro, não uma régua de margem.
 */
export function GhostDivider({ width = 8 }: GhostDividerProps): React.ReactNode {
  return (
    <Text color={role('faint')}>{'·'.repeat(Math.max(0, width))}</Text>
  )
}

/* ------------------------------------------------------------- ZenGlyph -- */

type ZenGlyphProps = {
  /** Qual glyph do vocabulário. */
  name: GlyphName
  /** Papel de cor. @default 'muted' (regra do accent único). */
  role?: Parameters<typeof role>[0]
  /** Espaço após o glyph (separa do label que vem em seguida). */
  withSpace?: boolean
}

/**
 * Um glyph do vocabulário Zen com o papel de cor certo, em uma chamada.
 * Default `muted` — o accent é exceção, não regra.
 */
export function ZenGlyph({
  name,
  role: r = 'muted',
  withSpace = false,
}: ZenGlyphProps): React.ReactNode {
  return (
    <Text color={role(r)}>
      {GLYPH[name]}
      {withSpace ? ' ' : ''}
    </Text>
  )
}

/* ----------------------------------------------------------- ToolMarker -- */

type ToolMarkerProps = {
  /** Estado parado da tool. Para `running`, anime sobre este componente. */
  state: ToolState
  /** Rótulo da tool (ex.: "Read", "Bash"). */
  children: React.ReactNode
  /** Conteúdo alinhado à direita (duração, contagem…). */
  trailing?: React.ReactNode
}

/**
 * Marcador de tool — o caso de uso central da linguagem. Aplica de uma vez:
 *   • o glyph certo por estado (●/∙/◦),
 *   • a regra do accent único (só `active` recebe roxo; resto é dim),
 *   • a hierarquia de peso (label `primary` quando ativa, `secondary` senão).
 *
 * @example
 * <ToolMarker state="active" trailing={<Text dimColor>1.2s</Text>}>Bash</ToolMarker>
 * <ToolMarker state="done">Read package.json</ToolMarker>
 */
export function ToolMarker({
  state,
  children,
  trailing,
}: ToolMarkerProps): React.ReactNode {
  const labelWeight: WeightLevel = state === 'active' ? 'primary' : 'secondary'
  return (
    <Row gap="tight" fill={!!trailing} trailing={trailing}>
      <Text color={role(toolGlyphRole(state))}>{toolGlyph(state)}</Text>
      <Text {...weight(labelWeight)}>{children}</Text>
    </Row>
  )
}

/* --------------------------------------------------------------- Rail -- */

type RailProps = {
  children: React.ReactNode
  /** Cor do trilho = SEMÂNTICA: 'signalError' (erro), 'signalWarn' (atenção),
   *  'accent' (ativo/foco), 'muted'/'faint' (neutro). @default 'muted' */
  tone?: ColorRole
  /** Espaço entre o trilho e o corpo, pela escala. @default 'tight' */
  gap?: SpaceStep
  /** Nº de linhas que o trilho cobre (uma ▎ por linha). @default 1 */
  lines?: number
}

/**
 * Trilho vertical à esquerda — a primitiva de SINAL portada do opencode. Uma
 * coluna de ▎ na cor semântica carrega o destaque (erro/atenção/ativo) enquanto
 * o corpo permanece calmo (muted). Substitui caixas emolduradas: o trilho fala,
 * o texto não grita. Para conteúdo de N linhas, passe `lines={N}`.
 *
 * @example
 * <Rail tone="signalError"><Text {...weight('secondary')}>Permission denied</Text></Rail>
 */
export function Rail({
  children,
  tone = 'muted',
  gap = 'tight',
  lines = 1,
}: RailProps): React.ReactNode {
  const n = Math.max(1, Math.floor(lines))
  return (
    <Box flexDirection="row" gap={SPACE[gap]} alignItems="flex-start">
      <Box flexDirection="column" flexShrink={0}>
        {Array.from({ length: n }, (_, i) => (
          <Text key={i} color={role(tone)}>
            {GLYPH.turnBar}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {children}
      </Box>
    </Box>
  )
}
