import * as React from 'react'
import { useMemo } from 'react'
import { Box, Text } from '../../ink.js'
import { getInitialSettings } from '../../utils/settings/settings.js'
import type { Color } from '../../ink/styles.js'
import type { Theme } from '../../utils/theme.js'
import type { AnimationSpec, GlyphColor, LoopPolicy } from './types.js'
import { useFrameClock, msToFps } from './useFrameClock.js'

/**
 * Reduced motion lido UMA vez no mount (sem useSettings() => sem re-render
 * por mudança de settings). Mesma estratégia do AnimatedAsterisk.
 */
function useReducedMotion(): boolean {
  return useMemo(() => getInitialSettings().prefersReducedMotion ?? false, [])
}

// ── Caminho novo (recomendado): passe um AnimationSpec curado ──────────────
type SpecProps = {
  spec: AnimationSpec
  /** Sobrescreve fps do spec (raro; prefira editar o spec). */
  fps?: number
  /** Cor do tema (monocromático/accent). Ausente => dimColor. */
  color?: GlyphColor
  /** Força reduced motion (default: lê das settings). */
  reducedMotion?: boolean
}

export function Glyph({ spec, fps, color, reducedMotion }: SpecProps): React.ReactNode {
  const settingRM = useReducedMotion()
  const rm = reducedMotion ?? settingRM
  const { ref, char } = useFrameClock(spec, fps, rm)
  return (
    <Box ref={ref}>
      {color ? <Text color={color}>{char}</Text> : <Text dimColor>{char}</Text>}
    </Box>
  )
}

// ── Camada de compat: assinatura IDÊNTICA ao AnimatedGlyph atual ───────────
// Permite trocar o import sem tocar nas ~70 tool UIs. Converte frames/loops/
// interval para um AnimationSpec efêmero e roda no clock compartilhado.
type LegacyProps = {
  frames: readonly string[]
  /** ms por frame. Default 80 (igual ao AnimatedGlyph). */
  interval?: number
  /** voltas; 0 = infinito (igual ao AnimatedGlyph). Default 1. */
  loops?: number
  settle?: string
  color?: keyof Theme | Color
}

export function AnimatedGlyphCompat({
  frames,
  interval = 80,
  loops = 1,
  settle,
  color,
}: LegacyProps): React.ReactNode {
  const settingRM = useReducedMotion()
  const loop: LoopPolicy = loops === 0 ? 'infinite' : loops
  const spec = useMemo<AnimationSpec>(
    () => ({ id: 'legacy', frames, fps: msToFps(interval), loop, settle, meaning: 'legacy' }),
    [frames, interval, loop, settle],
  )
  const { ref, char } = useFrameClock(spec, undefined, settingRM)
  return (
    <Box ref={ref}>
      {color ? <Text color={color}>{char}</Text> : <Text dimColor>{char}</Text>}
    </Box>
  )
}

// ── Progresso DETERMINADO — barra ASCII com fração conhecida ───────────────
// Estático por natureza (sem clock): re-renderiza só quando `value` muda.
// Mapeia trabalho com total conhecido (download, N de M tarefas, budget).
type ProgressBarProps = {
  /** Fração 0..1. */
  value: number
  /** Largura em células. Default 20. */
  width?: number
  color?: GlyphColor
}

export function ProgressBar({ value, width = 20, color }: ProgressBarProps): React.ReactNode {
  const clamped = Math.max(0, Math.min(1, value))
  const filled = Math.round(clamped * width)
  const bar = '▰'.repeat(filled) + '▱'.repeat(width - filled)
  return color ? <Text color={color}>{bar}</Text> : <Text dimColor>{bar}</Text>
}
