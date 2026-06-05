// src/tui/anim/AmbientField.tsx
//
// Campo ambiente PASTEL atrás/ao redor de um bloco de conteúdo (ex.: as specs
// do boot). Calm-tech: a região está viva, mas você não consegue apontar o que
// se mexe. Inspiração de intenção (não cópia): o campo de partículas calmo do
// "ultracode". A nossa versão é mais clean e em pastéis suaves.
//
// COMPOSIÇÃO POR REGIÃO (escolha, não limitação): emolduramos o bloco — as
// partículas ocupam linhas ACIMA e ABAIXO do conteúdo e colunas-gutter à
// ESQUERDA/DIREITA, e a região do texto (children) fica intocada. Mantém o
// componente idêntico no Ink-fallback e no OpenTUI (que SUPORTA absolute/zIndex/
// alpha) com zero corrupção de alinhamento e zero medição do texto dinâmico.
//
// DETERMINISMO: tom e glyph de cada célula derivam de (i, tick) — sem RNG. A
// fórmula é a mesma do "céu estrelado" (ZEN-TUI-DESIGN 2.7):
//   pick = (i*7 + tick*3 + i*tick) % N
// O produto i*tick quebra a periodicidade → parece orgânico, é 100% testável.
//
// TIMING: AMBIENTE lento (~900ms/tick). Nunca a cadência de atividade (~120ms).
//
// reducedMotion: o useFrameClock congela no settle (tick fixo) → campo estático
// calmo, sem ticks nem re-render. Respeita prefersReducedMotion.

import * as React from 'react'
import { useMemo } from 'react'
import { Box, Text } from '../../ink.js'
import { getInitialSettings } from '../../utils/settings/settings.js'
import type { Theme } from '../../utils/theme.js'
import type { AnimationSpec } from './types.js'
import { useFrameClock } from './useFrameClock.js'

// ── Paleta pastel (papéis do tema, resolvidos por ThemedText) ───────────────
// Ordem == "frequência" no campo: lavanda (afim ao accent) domina; rosa é raro.
const PASTELS: readonly (keyof Theme)[] = [
  'ambientLavender',
  'ambientPeriwinkle',
  'ambientLavender',
  'ambientMint',
  'ambientPeriwinkle',
  'ambientRose',
] as const

// Vocabulário pequeno e leve de glyphs. Maioria de espaços → campo esparso e
// calmo (densidade ~1 partícula a cada ~3 células). '·'/'⋅'/'∙' são pontos
// finos de pesos crescentes; ' ' é vazio.
const GLYPHS: readonly string[] = [' ', '·', ' ', '⋅', ' ', '∙', ' ', '·'] as const

// Ciclo de tick longo o bastante para não revelar a "costura" do loop, mas
// finito e determinístico. fps lento → ~900ms por tick (timing AMBIENTE).
const TICK_CYCLE = 48
const SPEC: AnimationSpec = {
  id: 'ambient-field',
  frames: Array.from({ length: TICK_CYCLE }, (_, i) => String(i)),
  fps: 1.1, // ~909ms por frame: calmo, não nervoso (>= 800-900ms)
  loop: 'infinite',
  settle: '0', // reducedMotion → tick 0 fixo (campo estático)
  meaning: 'Campo ambiente pastel ao redor de um bloco (decorativo calmo).',
}

/** Reduced motion lido UMA vez no mount (sem re-render por mudança de settings). */
function useReducedMotion(): boolean {
  return useMemo(() => getInitialSettings().prefersReducedMotion ?? false, [])
}

// Tom de uma célula por (i, tick). Determinístico, sem RNG. Espelha 2.7.
function pastelFor(i: number, tick: number): keyof Theme {
  const idx = ((i * 7 + tick * 3 + i * tick) % PASTELS.length + PASTELS.length) % PASTELS.length
  return PASTELS[idx]!
}

// Glyph de uma célula por (i, tick). Offset de seed distinto do tom para que
// cor e forma não cintilem em lockstep (parece mais orgânico).
function glyphFor(i: number, tick: number): string {
  const idx = ((i * 5 + tick * 2 + i * tick + 1) % GLYPHS.length + GLYPHS.length) % GLYPHS.length
  return GLYPHS[idx]!
}

// Uma linha do campo: `width` células, cada uma derivada de (seed+col, tick).
// Memoizável por (seed, width, tick). Glyphs com largura 1 → string previsível.
function FieldLine({
  seed,
  width,
  tick,
}: {
  seed: number
  width: number
  tick: number
}): React.ReactNode {
  // Agrupa células consecutivas de mesmo tom num único <Text> (menos spans).
  const spans = useMemo(() => {
    const out: { color: keyof Theme; text: string }[] = []
    for (let col = 0; col < width; col++) {
      const i = seed + col
      const color = pastelFor(i, tick)
      const g = glyphFor(i, tick)
      const last = out[out.length - 1]
      if (last && last.color === color) last.text += g
      else out.push({ color, text: g })
    }
    return out
  }, [seed, width, tick])

  return (
    <Text>
      {spans.map((s, k) => (
        <Text key={k} color={s.color}>
          {s.text}
        </Text>
      ))}
    </Text>
  )
}

type AmbientFieldProps = {
  /** O conteúdo a emoldurar (ex.: o bloco de specs). Fica intocado no centro. */
  children: React.ReactNode
  /** Largura total do campo em células (inclui os gutters laterais). */
  width: number
  /** Linhas de partículas acima do conteúdo. @default 1 */
  rowsTop?: number
  /** Linhas de partículas abaixo do conteúdo. @default 1 */
  rowsBottom?: number
  /** Largura de cada gutter lateral de partículas. @default 2 */
  sideWidth?: number
  /** Número estimado de linhas que o conteúdo ocupa (p/ pintar os gutters). @default 5 */
  contentLines?: number
}

/**
 * Emoldura `children` num campo calmo de partículas pastel. Composição por
 * REGIÃO (Ink não tem layering): partículas acima/abaixo + gutters laterais; o
 * conteúdo no centro fica limpo.
 *
 * Responsivo: < 80 col remove os gutters laterais; < 60 col some por completo
 * (só os children), evitando poluição em telas estreitas.
 *
 * @example
 * <AmbientField width={dataWidth + 8} contentLines={5}>
 *   <Box flexDirection="column"> ...specs... </Box>
 * </AmbientField>
 */
export function AmbientField({
  children,
  width,
  rowsTop = 1,
  rowsBottom = 1,
  sideWidth = 2,
  contentLines = 5,
}: AmbientFieldProps): React.ReactNode {
  const reducedMotion = useReducedMotion()
  // Degrade responsivo. < 60 col: campo desligado (telas muito estreitas).
  // tooNarrow entra como pausa p/ o clock dormir quando o campo não renderiza.
  const tooNarrow = width < 60
  const { ref, index } = useFrameClock(SPEC, undefined, reducedMotion || tooNarrow)
  const tick = index // 0..TICK_CYCLE-1 (ou 0 fixo em reducedMotion)

  const withSides = width >= 80 && sideWidth > 0

  // Seeds distintos por linha p/ não repetir o mesmo padrão verticalmente.
  // Banda superior: seeds 0..; inferior: continua a contagem (campo contínuo).
  const topRows = useMemo(
    () => Array.from({ length: Math.max(0, rowsTop) }, (_, r) => r),
    [rowsTop],
  )
  const bottomRows = useMemo(
    () =>
      Array.from(
        { length: Math.max(0, rowsBottom) },
        (_, r) => rowsTop + contentLines + r,
      ),
    [rowsBottom, rowsTop, contentLines],
  )
  const sideRows = useMemo(
    () => Array.from({ length: Math.max(0, contentLines) }, (_, r) => r),
    [contentLines],
  )

  if (tooNarrow) {
    // Sem campo: só o conteúdo (sem ref → não subscreve o clock).
    return <>{children}</>
  }

  const fullWidth = Math.max(0, width)

  return (
    <Box flexDirection="column" ref={ref}>
      {/* banda superior de partículas */}
      {topRows.map(seedRow => (
        <FieldLine key={`t${seedRow}`} seed={seedRow * 13} width={fullWidth} tick={tick} />
      ))}

      {/* faixa central: [gutter] conteúdo [gutter], ou só conteúdo se estreito */}
      {withSides ? (
        <Box flexDirection="row">
          <Box flexDirection="column" marginRight={1}>
            {sideRows.map(r => (
              <FieldLine key={`l${r}`} seed={100 + r * 7} width={sideWidth} tick={tick} />
            ))}
          </Box>
          <Box flexDirection="column" flexGrow={1}>
            {children}
          </Box>
          <Box flexDirection="column" marginLeft={1}>
            {sideRows.map(r => (
              <FieldLine key={`r${r}`} seed={200 + r * 7} width={sideWidth} tick={tick} />
            ))}
          </Box>
        </Box>
      ) : (
        children
      )}

      {/* banda inferior de partículas */}
      {bottomRows.map(seedRow => (
        <FieldLine key={`b${seedRow}`} seed={seedRow * 13} width={fullWidth} tick={tick} />
      ))}
    </Box>
  )
}
