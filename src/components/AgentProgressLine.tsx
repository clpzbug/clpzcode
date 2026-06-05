import * as React from 'react'
import { useMemo } from 'react'
import { Box, Text } from '../ink.js'
import { Glyph, SUBAGENT } from '../tui/anim/index.js'
import { GLYPH, role, weight } from '../tui/design/index.js'
import { formatNumber } from '../utils/format.js'
import type { Theme } from '../utils/theme.js'

type Props = {
  agentType: string
  description?: string
  name?: string
  descriptionColor?: keyof Theme
  taskDescription?: string
  toolUseCount: number
  tokens: number | null
  color?: keyof Theme
  isLast: boolean
  isResolved: boolean
  isError: boolean
  isAsync?: boolean
  shouldAnimate: boolean
  lastToolInfo?: string | null
  hideType?: boolean
}

/**
 * Accent dessaturado do sub-agente — roxo recuado (rgb(150,135,175)), mais
 * fraco que o accent principal rgb(178,145,220). Sinaliza "outro contexto
 * ativo" sem roubar o foco do leader. Raw rgb por design: mapeia um ATOR
 * distinto, não um papel do tema. <Text color> aceita rgb() direto (color.ts
 * faz bypass do lookup de tema para valores que começam com "rgb(").
 */
const SUBAGENT_ACCENT = 'rgb(150,135,175)'

/**
 * Sub-agente em UMA linha:
 *
 *   ⤷ nome · atividade <spinner> · 3 tool uses · 1.2k tokens
 *
 * • Em curso  → glyph ANIMADO (SUBAGENT, órbita leve) + atividade ao vivo.
 * • Terminal  → colapsa num "selo" estático de 1 linha: ∙ (ok) ou ✕ (erro),
 *               sem spinner e sem a sub-árvore ├─/└─ do layout antigo.
 * • Background → mostra só a descrição da tarefa (sem contagem de tools).
 *
 * A LÓGICA de estado (statusText, isBackgrounded) é preservada 1:1 do
 * componente anterior; mudou apenas a APRESENTAÇÃO (árvore → linha única Zen)
 * e a FORMA (fonte limpa, sem _c()/$[]).
 */
export function AgentProgressLine({
  agentType,
  description,
  name,
  taskDescription,
  toolUseCount,
  tokens,
  isResolved,
  isError,
  isAsync = false,
  shouldAnimate,
  lastToolInfo,
  hideType = false,
}: Props): React.ReactNode {
  const isBackgrounded = isAsync && isResolved

  // PRESERVADO de getStatusText() — mesma precedência, mesmas strings.
  const statusText = !isResolved
    ? lastToolInfo || 'Initializing…'
    : isBackgrounded
      ? taskDescription ?? 'Running in the background'
      : 'Done'

  // Rótulo do agente. Mantém a precedência name → description → agentType e o
  // par "name: description". Zen: sem backgroundColor/inverseText; o destaque
  // vem do accent dessaturado + peso de título, não de um bloco colorido.
  const label = useMemo(() => {
    if (hideType) {
      return (
        <>
          <Text color={SUBAGENT_ACCENT} {...weight('title')}>
            {name ?? description ?? agentType}
          </Text>
          {name && description ? (
            <Text {...weight('secondary')}>: {description}</Text>
          ) : null}
        </>
      )
    }
    return (
      <>
        <Text color={SUBAGENT_ACCENT} {...weight('title')}>
          {agentType}
        </Text>
        {description ? (
          <Text {...weight('secondary')}> ({description})</Text>
        ) : null}
      </>
    )
  }, [hideType, name, description, agentType])

  // Glyph: animado enquanto trabalha; estático (selo) ao concluir.
  // Resolvido OK → ∙ verde (signalOk). Erro → ✕ vermelho (signalError). Em curso
  // → órbita SUBAGENT, tingida de signalError quando há erro em voo. O estado
  // terminal carrega a cor do resultado (mesma regra do tool-use principal).
  const animate = shouldAnimate && !isResolved
  const glyph = animate ? (
    <Glyph spec={SUBAGENT} color={isError ? role('signalError') : undefined} />
  ) : (
    <Text color={isError ? role('signalError') : role('signalOk')}>
      {isError ? GLYPH.toolError : GLYPH.toolDone}
    </Text>
  )

  // Contagem de tools/tokens — só quando NÃO está em background (preservado).
  const stats = !isBackgrounded ? (
    <Text {...weight('secondary')}>
      {' · '}
      {toolUseCount} tool {toolUseCount === 1 ? 'use' : 'uses'}
      {tokens !== null ? <> · {formatNumber(tokens)} tokens</> : null}
    </Text>
  ) : null

  return (
    <Box flexDirection="row" marginLeft={2} gap={1}>
      <Text color={SUBAGENT_ACCENT}>{GLYPH.subagent}</Text>
      <Box flexDirection="row">
        {label}
        <Text {...weight('secondary')}> · {statusText} </Text>
        {glyph}
        {stats}
      </Box>
    </Box>
  )
}
