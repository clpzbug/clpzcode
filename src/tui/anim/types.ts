// Engine de animação ASCII — tipos centrais.
// Self-contained: sem deps de runtime, só tipos.

import type { Theme } from '../../utils/theme.js'

/**
 * Cor de uma animação. Monocromático por padrão (dimColor quando ausente);
 * no máximo 1 accent vindo do tema. Nunca cor crua obrigatória.
 */
export type GlyphColor = keyof Theme | undefined

/**
 * Política de loop de uma animação baseada em frames.
 * - 'infinite' : roda até desmontar (estados contínuos: pensando, streaming…)
 * - número N   : roda N voltas completas e então "assenta" (transições)
 */
export type LoopPolicy = 'infinite' | number

/**
 * Especificação declarativa e imutável de uma animação ASCII.
 * Cada spec mapeia UM estado real do sistema — nunca decorativo.
 */
export type AnimationSpec = {
  /** Identificador estável (debug / telemetria / seleção por nome). */
  readonly id: string
  /** Sequência de glifos. Ordem == ordem temporal. */
  readonly frames: readonly string[]
  /** Velocidade em frames por segundo. Curada por animação. */
  readonly fps: number
  /** Política de loop. Default conceitual: 'infinite' para estados contínuos. */
  readonly loop: LoopPolicy
  /**
   * Glifo final após a última volta (só relevante quando loop é finito).
   * Cai para o último frame quando ausente. Use ' '/'⠀' p/ saída limpa.
   */
  readonly settle?: string
  /** Significado: que estado do sistema esta animação representa. */
  readonly meaning: string
}

/** Estado computado por tick que o hook de baixo nível devolve. */
export type FrameState = {
  /** Glifo a renderizar neste tick. */
  readonly char: string
  /** Índice do frame atual dentro de `frames`. */
  readonly index: number
  /** True quando uma animação de loop finito terminou (assentou). */
  readonly done: boolean
}
