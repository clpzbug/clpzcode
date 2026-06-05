// src/tui/design/glyphs.ts
//
// Vocabulário de glyphs Zen. REGRA: cada glyph é um SUBSTANTIVO de estado real
// do sistema — nunca decoração. Um glyph estático = um estado terminal; um
// glyph animado (em animGlyphs.ts) = um estado em curso. Esta tabela cobre os
// estados terminais/estruturais; a animação cobre os transientes.
//
// Reusa figures.ts onde já existe vocabulário equivalente, para não divergir
// do resto da TUI.

import {
  BLACK_CIRCLE,
  BLOCKQUOTE_BAR,
  BULLET_OPERATOR,
} from '../../constants/figures.js'
import type { ColorRole } from './tokens.js'

/**
 * Os glyphs da linguagem, indexados por SIGNIFICADO (não por aparência).
 * Trocar o caractere aqui troca em toda a UI de forma coerente.
 */
export const GLYPH = {
  /** Tool/turno CONCLUÍDO — ponto-médio leve (∙). Discreto, "já passou".
   *  Recebe a cor do RESULTADO no render (signalOk = ok, signalError = erro);
   *  o estado é lido pela cor, não pelo peso do glyph. */
  toolDone: BULLET_OPERATOR, // ∙
  /** Tool concluída com ERRO — cruz leve (✕). Único estado terminal que ganha
   *  forma própria (além da cor) porque erro PRECISA ser notado num relance. */
  toolError: '✕', // ✕
  /** CONCLUÍDO (estados não-tool, ex.: nós de workflow) — check leve (✓), mesmo
   *  peso de hairline que ∙ ✕ ◦. Canônico p/ todo "ok terminal" fora do feed. */
  done: '✓', // ✓
  /** Tool ATIVO — círculo cheio (● / ⏺). Único ponto que "pesa" na linha. */
  toolActive: BLACK_CIRCLE, // ● (⏺ no macOS)
  /** Sub-agente / delegação — descida em garfo (⤷). Fluxo saindo para outro ator
   *  (distinto de → que é leitura/ingresso). */
  subagent: '⤷', // ⤷
  /** Limite de TURNO — barra fina vertical (▎). Separa turnos sem linha cheia. */
  turnBar: BLOCKQUOTE_BAR, // ▎
  /** PROMPT / entrada do usuário — chevron (›). Convite minimalista a digitar. */
  prompt: '›', // ›
  /** Item pendente / não-iniciado — anel vazio (◦). Presença sem peso. */
  pending: '◦', // ◦
} as const

export type GlyphName = keyof typeof GLYPH

/**
 * Mapa de ESTADO DE TOOL → glyph estático. Para o estado `running` use a
 * animação (PROBE/THINK/etc. em animGlyphs.ts) — aqui só os estados parados.
 */
export type ToolState = 'pending' | 'active' | 'done'

export function toolGlyph(state: ToolState): string {
  switch (state) {
    case 'active':
      return GLYPH.toolActive
    case 'done':
      return GLYPH.toolDone
    case 'pending':
      return GLYPH.pending
  }
}

/**
 * Papel de COR sugerido para cada estado de tool. Segue a regra do accent
 * único: só o estado ATIVO recebe o roxo; o resto é dim. Retorna um ColorRole
 * de tokens.ts (não a cor crua) para manter a coerência.
 */
export function toolGlyphRole(state: ToolState): ColorRole {
  return state === 'active' ? 'accent' : 'muted'
}

/**
 * Ícone por TIPO de ferramenta (porte do opencode): um glyph por tool, lido num
 * relance. O ESTADO é codificado pela COR no render (accent=ativo, muted=feito,
 * signalError=falhou, ~ pending) — nunca por uma forma diferente. Mantém o feed
 * de tools sem decoração mas instantaneamente legível.
 */
export const TOOL_ICON: Record<string, string> = {
  bash: '⚙', // the one intentionally-heavy mark: "execution"
  shell: '⚙',
  grep: '✦',
  glob: '✦',
  search: '✦',
  ls: '✦',
  webfetch: '◇',
  websearch: '◇',
  web: '◇',
  read: '→',
  notebookread: '→',
  write: '←',
  edit: '✎',
  multiedit: '✎',
  notebookedit: '✎',
  task: '▢',
  agent: '▢',
  workflow: '▢',
  todowrite: '✓',
  default: '∙',
}

/** Resolve o ícone de uma ferramenta pelo nome (case-insensitive). */
export function toolIcon(name: string): string {
  return TOOL_ICON[name.toLowerCase()] ?? TOOL_ICON.default!
}

/**
 * Status dot por estado de serviço/conexão (chips de footer: MCP/LSP/IDE).
 * A cor acompanha (success/error/warning/muted) — ver statusDotRole.
 */
export const STATUS_DOT = {
  connected: '●',
  failed: '⊙',
  needsAuth: '△',
  disabled: '◦',
} as const

export type StatusKind = keyof typeof STATUS_DOT

export function statusDotRole(kind: StatusKind): ColorRole {
  switch (kind) {
    case 'connected':
      return 'signalOk'
    case 'failed':
      return 'signalError'
    case 'needsAuth':
      return 'signalWarn'
    case 'disabled':
      return 'faint'
  }
}
