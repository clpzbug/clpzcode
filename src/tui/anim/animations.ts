// Animações curadas do clpzcode — cada entrada mapeia UM estado real do sistema.
// Princípio: frames contíguos devem ser transformações naturais do anterior.
// Três padrões base (escolhidos por coerência visual e ratings da comunidade):
//   A) Rotação densa 7-dot  ⣾→⣷  (thinking/heavy work)
//   B) Arco de 10 posições  ⠋→⠏  (tool/scan — ora default)
//   C) Pulso simétrico      ⠀→⣿→⠀ (wait/blocked)

import {
  THINK_FRAMES,
  IDLE_FRAMES,
  WAIT_FRAMES,
  SCAN_FRAMES,
  PROBE_FRAMES,
  ORBIT_FRAMES,
} from '../../constants/animGlyphs.js'
import type { AnimationSpec } from './types.js'

const spec = (s: AnimationSpec): AnimationSpec => s

/**
 * THINKING — raciocínio profundo (extended thinking ativo).
 *
 * Rotação densa ⣾→⣽→⣻→⢿→⡿→⣟→⣯→⣷: cada frame = 45° dos mesmos 7 dots.
 * Zero salto de densidade — o spinner mais bem avaliado para "trabalho cognitivo"
 * (padrão do ora v8+, listr2, cli-spinners "dots8"). fps 10 = 100ms/frame,
 * suave e não-agitado.
 */
export const THINKING = spec({
  id: 'thinking',
  frames: THINK_FRAMES,
  fps: 10,
  loop: 'infinite',
  meaning: 'O modelo está raciocinando (thinking ativo).',
})

/**
 * STREAMING — tokens chegando da resposta.
 *
 * Onda diagonal ping-pong: ⣀→⣄→⣦→⡆→⡇→⠇→⠃→⠁→(retorno).
 * Cada frame adiciona ou remove dots de forma diagonal contínua —
 * lê como "fluxo entrando" sem saltos de posição.
 */
export const STREAMING = spec({
  id: 'streaming',
  frames: ['⣀', '⣄', '⣅', '⣦', '⡦', '⡆', '⡇', '⠇', '⠃', '⠁', '⠃', '⠇', '⡇', '⡦', '⣦', '⣅', '⣄'],
  fps: 12,
  loop: 'infinite',
  meaning: 'Texto da resposta sendo transmitido (streaming de tokens).',
})

/**
 * TOOL_RUNNING — ferramenta executando.
 *
 * Arco de 10 posições ⠋→⠙→⠹→⠸→⠼→⠴→⠦→⠧→⠇→⠏: o "dots" do cli-spinners,
 * padrão do ora. Cada frame = dot avança ~36° no círculo virtual.
 */
export const TOOL_RUNNING = spec({
  id: 'tool-running',
  frames: SCAN_FRAMES,
  fps: 10,
  loop: 'infinite',
  meaning: 'Uma ferramenta (tool) está executando.',
})

/**
 * SUBAGENT — sub-agente/teammate trabalhando em paralelo.
 *
 * Órbita leve de 1 dot: presença viva com baixíssimo peso visual.
 * Distinto do THINKING denso — sinaliza "outro contexto ativo, não eu".
 */
export const SUBAGENT = spec({
  id: 'subagent',
  frames: IDLE_FRAMES,
  fps: 12,
  loop: 'infinite',
  meaning: 'Um sub-agente / teammate está ativo.',
})

/**
 * PROBE — checagem leve (lint, lookup, validação rápida).
 *
 * 1 dot varrendo coluna esquerda: operação curta, peso visual mínimo.
 */
export const PROBE = spec({
  id: 'probe',
  frames: PROBE_FRAMES,
  fps: 12,
  loop: 'infinite',
  meaning: 'Checagem leve em andamento.',
})

/**
 * WAITING — bloqueado aguardando recurso externo (rede, permissão, lock).
 *
 * Pulso simétrico: ⠀→⠤→⠶→⣶→⣾→⣿→(retorno).
 * Expansão e contração puras sem drift lateral — "respirando/parado".
 * fps 7 (lento) reforça espera, não trabalho ativo.
 */
export const WAITING = spec({
  id: 'waiting',
  frames: WAIT_FRAMES,
  fps: 7,
  loop: 'infinite',
  meaning: 'Bloqueado/aguardando algo externo.',
})

/**
 * PROGRESS_INDETERMINATE — trabalho em curso sem fim previsível.
 *
 * Bolinha em trilha de 3 posições (ping-pong):
 * ▰▱▱ → ▱▰▱ → ▱▱▰ → ▱▰▱
 * Trilha fixa anchora o olho; settle centrado para reduced-motion equilibrado.
 */
export const PROGRESS_INDETERMINATE = spec({
  id: 'progress-indeterminate',
  frames: ['▰▱▱', '▱▰▱', '▱▱▰', '▱▰▱'],
  fps: 7,
  loop: 'infinite',
  settle: '▱▰▱',
  meaning: 'Progresso indeterminado (single-glyph). Para cauda de luminância use <CometBar/>.',
})

/**
 * SETTLE_SUCCESS — transição para sucesso; dissolve e para. loop=1.
 *
 * Cresce até o cheio, depois dissolve simetricamente:
 * ⠁→⠃→⠇→⡇→⣧→⣷→⣿→⣾→⣶→⠶→⠤→⠀
 * Lê como "confirmou e fechou limpo".
 */
export const SETTLE_SUCCESS = spec({
  id: 'settle-success',
  frames: ['⠁', '⠃', '⠇', '⡇', '⣧', '⣷', '⣿', '⣾', '⣶', '⠶', '⠤', '⠀'],
  fps: 11,
  loop: 1,
  settle: '⠀',
  meaning: 'Transição para sucesso; dissolve e para.',
})

// ORBIT (ORTHOGRAM spinner): a pen tracing a fixed 3-column cell. Registry entry
// only — the live consumer SpinnerAnimationRow is react-compiled, so wiring it
// into the running spinner is deferred rather than editing compiled output.
export const ORBIT = spec({
  id: 'orbit',
  frames: [...ORBIT_FRAMES],
  fps: 12.5,
  loop: 'infinite',
  settle: ORBIT_FRAMES[0],
  meaning: 'Caneta traçando uma célula fixa (spinner ORTHOGRAM).',
})

// Registro nomeado para seleção por estado de forma tipada.
export const ANIMATIONS = {
  thinking: THINKING,
  streaming: STREAMING,
  toolRunning: TOOL_RUNNING,
  subagent: SUBAGENT,
  probe: PROBE,
  waiting: WAITING,
  progressIndeterminate: PROGRESS_INDETERMINATE,
  settleSuccess: SETTLE_SUCCESS,
  orbit: ORBIT,
} as const

export type AnimationName = keyof typeof ANIMATIONS
