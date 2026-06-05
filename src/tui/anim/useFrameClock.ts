import { useRef } from 'react'
import { useAnimationFrame } from '../../ink.js'
import type { DOMElement } from '../../ink/dom.js'
import type { AnimationSpec, FrameState } from './types.js'

/** Converte ms-por-frame (API antiga) para fps. */
export function msToFps(intervalMs: number): number {
  return intervalMs > 0 ? 1000 / intervalMs : 0
}

type FrameClockResult = FrameState & {
  /** Ref p/ anexar ao Box que contém o glifo — habilita a pausa por viewport. */
  ref: (element: DOMElement | null) => void
}

/**
 * Coração do engine. UMA fonte de tempo (o clock compartilhado via
 * useAnimationFrame). Não cria timers próprios: deriva o índice de frame da
 * FASE decorrida desde o mount, igual ao AnimatedAsterisk. Resultado:
 *
 *  - todas as animações ficam sincronizadas no mesmo tick;
 *  - pausam sozinhas quando saem do viewport (via `ref`);
 *  - respeitam prefersReducedMotion congelando no settle (sem movimento);
 *  - loops finitos "assentam" e param de pedir ticks (clock dorme).
 *
 * @param spec        Especificação da animação.
 * @param fpsOverride Sobrescreve spec.fps (p/ a camada de compat ms→fps).
 * @param reducedMotion Quando true, congela: zero re-render por animação.
 */
export function useFrameClock(
  spec: AnimationSpec,
  fpsOverride?: number,
  reducedMotion = false,
): FrameClockResult {
  const fps = fpsOverride ?? spec.fps
  const frameCount = spec.frames.length
  const intervalMs = fps > 0 ? 1000 / fps : Infinity
  const isInfinite = spec.loop === 'infinite'
  const totalFrames = isInfinite
    ? Infinity
    : frameCount * Math.max(0, spec.loop as number)

  // Fase: âncora capturada do PRIMEIRO tick (não do mount em wall-clock),
  // para que a animação comece sempre no frame 0 com o clock compartilhado.
  const startRef = useRef<number | null>(null)
  const doneRef = useRef(false)

  // Reduced motion: nunca subscreve o clock (intervalMs=null => sem ticks).
  // Loop finito que já terminou: idem, deixa o clock dormir.
  const paused = reducedMotion || doneRef.current
  const [ref, time] = useAnimationFrame(paused ? null : intervalMs)

  // Caminho estático (reduced motion ou frames vazios): settle imediato.
  if (reducedMotion || frameCount === 0) {
    const settled = spec.settle ?? spec.frames[frameCount - 1] ?? ''
    // Resolve o ÍNDICE do settle (não o último frame): consumidores como
    // AmbientField/WelcomeHero dirigem o render por `index`, e declaram
    // settle:'0' esperando congelar no tick 0 sob reduced-motion. Cai no último
    // frame só quando o settle não é um frame (ex.: SETTLE_ERROR).
    const settleIdx = spec.settle != null ? spec.frames.indexOf(spec.settle) : -1
    const index = settleIdx >= 0 ? settleIdx : Math.max(0, frameCount - 1)
    return { ref, char: settled, index, done: true }
  }

  if (startRef.current === null) startRef.current = time
  const elapsed = time - startRef.current
  const ticked = Math.max(0, Math.floor(elapsed / intervalMs))

  if (!isInfinite && ticked >= totalFrames) {
    doneRef.current = true
    const settled = spec.settle ?? spec.frames[frameCount - 1] ?? ''
    // settle pelo ÍNDICE (consumidores dirigem o render por `index`), não o último frame
    const settleIdx = spec.settle != null ? spec.frames.indexOf(spec.settle) : -1
    const index = settleIdx >= 0 ? settleIdx : Math.max(0, frameCount - 1)
    return { ref, char: settled, index, done: true }
  }

  const index = ((ticked % frameCount) + frameCount) % frameCount
  return { ref, char: spec.frames[index] ?? spec.frames[0] ?? '', index, done: false }
}
