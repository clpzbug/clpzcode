// src/tui/anim/CometBar.tsx
//
// CometBar — o loader de maior retorno (doc 2.1). NÃO é um glyph trocando de
// frame: é LUZ se movendo sobre matéria fixa. Três células de largura FIXA
// (não empurra layout), um "foco" varrendo 0→1→2→1 (ping-pong, sem o "pop" do
// loop linear), e cada célula recebe a cor pela DISTÂNCIA ao foco — cauda de
// luminância de 3 tons.
//
// Ink-aware: não há alpha. Os 3 tons são SÓLIDOS, pré-misturados com o fundo
// preto a 100% / 72% / 22% — uma vez, memoizados. Monocromático puro: um único
// matiz (o accent) em três intensidades. Determinístico: deriva tudo de (índice
// do foco, célula); roda no clock COMPARTILHADO via useFrameClock — sem timer
// próprio. Respeita prefersReducedMotion (assenta no frame de repouso, parado).

import * as React from 'react'
import { useMemo } from 'react'
import { Box, Text } from '../../ink.js'
import { useAccent } from '../design/index.js'
import { getInitialSettings } from '../../utils/settings/settings.js'
import type { Color } from '../../ink/styles.js'
import type { Theme } from '../../utils/theme.js'
import type { AnimationSpec } from './types.js'
import { useFrameClock } from './useFrameClock.js'

// Posição do foco por tick — ping-pong sobre 3 células. As "frames" são índices
// como string só p/ satisfazer o AnimationSpec (o glyph real é montado por
// célula, abaixo). fps 8 ≈ 120ms: a "respiração" rápida de ATIVIDADE do Zen.
const FOCUS: readonly number[] = [0, 1, 2, 1]

/**
 * Spec do CometBar — exposto para registro/telemetria coerente com os demais.
 * O `id` segue o padrão kebab dos outros specs; meaning documenta o estado.
 */
export const COMET_BAR: AnimationSpec = {
  id: 'comet-bar',
  frames: ['0', '1', '2', '1'],
  fps: 8,
  loop: 'infinite',
  meaning: 'Atividade em curso, com direção (progresso indeterminado vivo).',
}

// Glyph por distância ao foco: foco/cauda-1 = bloco cheio, cauda-2 = quadrado
// miúdo (a "poeira" do rastro). Box-drawing só onde a semântica de barra pede.
const GLYPH_NEAR = '■'
const GLYPH_FAR = '⬝'

/** Reduced motion lido UMA vez no mount (igual ao Glyph). */
function useReducedMotion(): boolean {
  return useMemo(() => getInitialSettings().prefersReducedMotion ?? false, [])
}

/**
 * Mistura um rgb(r,g,b) com preto a `k` (0..1) — pré-composição sólida que
 * substitui o alpha que o Ink não tem. Retorna a string rgb() pronta p/ <Text>.
 * Só roda quando `accent` é rgb(...) (temas truecolor). Pura e barata.
 */
function premixOnBlack(accent: string, k: number): string | null {
  const m = accent.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/)
  if (!m) return null
  const r = Math.round(Number(m[1]) * k)
  const g = Math.round(Number(m[2]) * k)
  const b = Math.round(Number(m[3]) * k)
  return `rgb(${r},${g},${b})`
}

type CometBarProps = {
  /** Força reduced motion (default: lê das settings). */
  reducedMotion?: boolean
}

/**
 * Três células, foco em ping-pong, cauda de luminância. Largura fixa = 3.
 *
 * @example
 * <Row gap="tight">
 *   <CometBar />
 *   <Text {...weight('secondary')}>pensando</Text>
 * </Row>
 */
export function CometBar({ reducedMotion }: CometBarProps): React.ReactNode {
  const settingRM = useReducedMotion()
  const rm = reducedMotion ?? settingRM
  const accent = useAccent()
  const { ref, index } = useFrameClock(COMET_BAR, undefined, rm)

  // Os 3 tons (foco→cauda1→cauda2), por distância. Pré-misturados sólidos
  // quando o accent é rgb(); senão, ramp de papéis (mantém luminância sem
  // exigir mistura numérica em temas ansi). Memoizado por accent.
  const tones = useMemo<readonly [string, string, string]>(() => {
    const t1 = premixOnBlack(accent, 0.72)
    const t2 = premixOnBlack(accent, 0.22)
    if (t1 && t2) return [accent, t1, t2]
    // Fallback (accent não-rgb, ex.: temas ansi): luminância via papéis.
    return [accent, 'inactive', 'subtle']
  }, [accent])

  // Em reduced motion o foco congela no centro (índice 1 = posição de repouso):
  // a barra existe, mas não se move. Zero re-render por animação.
  const focus = rm ? 1 : (FOCUS[index] ?? 0)

  return (
    <Box ref={ref}>
      {[0, 1, 2].map((cell) => {
        const dist = Math.abs(focus - cell)
        const glyph = dist < 2 ? GLYPH_NEAR : GLYPH_FAR
        const color = tones[Math.min(dist, 2)] as Color | keyof Theme
        return (
          <Text key={cell} color={color}>
            {glyph}
          </Text>
        )
      })}
    </Box>
  )
}
