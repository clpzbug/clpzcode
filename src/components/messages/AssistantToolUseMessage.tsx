import type { ToolUseBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import React from 'react'
import { getDefaultCharacters } from 'src/components/Spinner/index.js'
import { AnimatedGlyphCompat } from 'src/tui/anim/Glyph.js'
import { useTerminalSize } from 'src/hooks/useTerminalSize.js'
import type { ThemeName } from 'src/utils/theme.js'
import type { Command } from '../../commands.js'
import { stringWidth } from '../../ink/stringWidth.js'
import { Box, Text, useTheme } from '../../ink.js'
import { useAppStateMaybeOutsideOfProvider } from '../../state/AppState.js'
import { findToolByName, type Tool, type ToolProgressData, type Tools } from '../../Tool.js'
import { role, toolIcon, type ColorRole } from '../../tui/design/index.js'
import type { ProgressMessage } from '../../types/message.js'
import { useIsClassifierChecking } from '../../utils/classifierApprovalsHook.js'
import { logError } from '../../utils/log.js'
import type { buildMessageLookups } from '../../utils/messages.js'
import { MessageResponse } from '../MessageResponse.js'
import { useSelectedMessageBg } from '../messageActions.js'
import { SentryErrorBoundary } from '../SentryErrorBoundary.js'
import { HookProgressMessage } from './HookProgressMessage.js'

type Props = {
  param: ToolUseBlockParam
  addMargin: boolean
  tools: Tools
  commands: Command[]
  verbose: boolean
  inProgressToolUseIDs: Set<string>
  progressMessagesForMessage: ProgressMessage[]
  shouldAnimate: boolean
  shouldShowDot: boolean
  inProgressToolCallCount?: number
  lookups: ReturnType<typeof buildMessageLookups>
  isTranscriptMode?: boolean
}

export function AssistantToolUseMessage({
  param,
  addMargin,
  tools,
  commands,
  verbose,
  inProgressToolUseIDs,
  progressMessagesForMessage,
  shouldShowDot,
  shouldAnimate,
  inProgressToolCallCount,
  lookups,
  isTranscriptMode,
}: Props): React.ReactNode {
  const terminalSize = useTerminalSize()
  const [theme] = useTheme()
  const bg = useSelectedMessageBg()
  const pendingWorkerRequest = useAppStateMaybeOutsideOfProvider(
    state => state.pendingWorkerRequest,
  )
  const isClassifierCheckingRaw = useIsClassifierChecking(param.id)
  const permissionMode = useAppStateMaybeOutsideOfProvider(
    state => state.toolPermissionContext.mode,
  )
  const hasStrippedRules = useAppStateMaybeOutsideOfProvider(
    state => !!state.toolPermissionContext.strippedDangerousRules,
  )
  const isAutoClassifier =
    permissionMode === 'auto' || (permissionMode === 'plan' && hasStrippedRules)
  const isClassifierChecking =
    false && isClassifierCheckingRaw && permissionMode !== 'auto'

  if (!tools) {
    logError(new Error(`Tools array is undefined for tool ${param.name}`))
    return null
  }
  const tool = findToolByName(tools, param.name)
  if (!tool) {
    logError(new Error(`Tool ${param.name} not found`))
    return null
  }

  const input = tool.inputSchema.safeParse(param.input)
  const inputData = input.success ? input.data : undefined
  const userFacingToolName = tool.userFacingName(inputData)
  const userFacingToolNameBackgroundColor = tool.userFacingNameBackgroundColor?.(inputData)
  const isTransparentWrapper = tool.isTransparentWrapper?.() ?? false

  const isResolved = lookups.resolvedToolUseIDs.has(param.id)
  const isQueued = !inProgressToolUseIDs.has(param.id) && !isResolved
  const isWaitingForPermission = pendingWorkerRequest?.toolUseId === param.id

  if (isTransparentWrapper) {
    if (isQueued || isResolved) {
      return null
    }
    return (
      <Box flexDirection="column" width="100%" backgroundColor={bg}>
        {renderToolUseProgressMessage(
          tool,
          tools,
          lookups,
          param.id,
          progressMessagesForMessage,
          { verbose, inProgressToolCallCount, isTranscriptMode },
          terminalSize,
        )}
      </Box>
    )
  }

  if (userFacingToolName === '') {
    return null
  }

  const renderedToolUseMessage = input.success
    ? renderToolUseMessage(tool, input.data, { theme, verbose, commands })
    : null
  if (renderedToolUseMessage === null) {
    return null
  }

  const isError = lookups.erroredToolUseIDs.has(param.id)
  // active = em curso (não-resolvido, não-fila). Resolvido/concluído = passado.
  const isActive = !isResolved && !isQueued
  const minLabelWidth = stringWidth(userFacingToolName) + (shouldShowDot ? 2 : 0)

  const renderToolUseTag =
    input.success && tool.renderToolUseTag ? tool.renderToolUseTag(input.data) : null

  return (
    <Box flexDirection="row" marginTop={addMargin ? 1 : 0} width="100%" backgroundColor={bg}>
      <Box flexDirection="column">
        <Box flexDirection="row" flexWrap="nowrap" minWidth={minLabelWidth}>
          {shouldShowDot && (
            <ToolGlyph
              toolName={param.name}
              isQueued={isQueued}
              isActive={isActive}
              isError={isError}
              shouldAnimate={shouldAnimate}
            />
          )}
          <Box flexShrink={0}>
            <Text
              wrap="truncate-end"
              backgroundColor={userFacingToolNameBackgroundColor}
              color={userFacingToolNameBackgroundColor ? 'inverseText' : undefined}
            >
              {userFacingToolName}
            </Text>
          </Box>
          {renderedToolUseMessage !== '' &&
            (React.isValidElement(renderedToolUseMessage) ? (
              <Box flexWrap="nowrap">{renderedToolUseMessage}</Box>
            ) : (
              <Box flexWrap="nowrap">
                <Text dimColor>{' · '}{renderedToolUseMessage}</Text>
              </Box>
            ))}
          {renderToolUseTag}
        </Box>
        {isActive &&
          (isClassifierChecking ? (
            <MessageResponse height={1}>
              <Text dimColor>
                {isAutoClassifier
                  ? 'Auto classifier checking…'
                  : 'Bash classifier checking…'}
              </Text>
            </MessageResponse>
          ) : isWaitingForPermission ? (
            <MessageResponse height={1}>
              <Text dimColor>Waiting for permission…</Text>
            </MessageResponse>
          ) : (
            renderToolUseProgressMessage(
              tool,
              tools,
              lookups,
              param.id,
              progressMessagesForMessage,
              { verbose, inProgressToolCallCount, isTranscriptMode },
              terminalSize,
            )
          ))}
        {!isResolved && isQueued && renderToolUseQueuedMessage(tool)}
      </Box>
    </Box>
  )
}

// Braille spinner frames for the active (running) state — same family the
// main thinking spinner uses, so a running tool reads as "happening now".
const TOOL_SPINNER_FRAMES = getDefaultCharacters()

/**
 * Marcador de tool — o ESTADO é lido num relance pela FORMA, não só pela cor:
 *   • fila      → ícone do TIPO em `faint` (⚙/→/etc, presente mas não começou)
 *   • ativa     → spinner braille animado em `accent` (movimento = "rodando agora")
 *   • concluída → `✓` em `signalOk` (verde — terminou)
 *   • erro      → `✗` em `signalError` (vermelho — falhou)
 * O TIPO da ferramenta continua legível no rótulo de texto ao lado (Bash/Read/…),
 * então trocar o ícone-de-tipo pelo estado-spinner não perde informação. Sempre
 * 2 células (gutter) para alinhar com o conteúdo abaixo. O spinner usa o clock
 * compartilhado focus-aware (pausa off-screen / reduced-motion → frame estático).
 */
function ToolGlyph({
  toolName,
  isQueued,
  isActive,
  isError,
  shouldAnimate,
}: {
  toolName: string
  isQueued: boolean
  isActive: boolean
  isError: boolean
  shouldAnimate: boolean
}): React.ReactNode {
  if (isActive && !isError) {
    return (
      <Box minWidth={2} flexShrink={0}>
        <AnimatedGlyphCompat
          frames={shouldAnimate ? TOOL_SPINNER_FRAMES : [TOOL_SPINNER_FRAMES[0]!]}
          interval={120}
          loops={0}
          color={role('accent')}
        />
      </Box>
    )
  }
  const glyph = isError ? '✗' : isQueued ? toolIcon(toolName) : '✓'
  const tone: ColorRole = isError ? 'signalError' : isQueued ? 'faint' : 'signalOk'
  return (
    <Box minWidth={2} flexShrink={0}>
      <Text color={role(tone)}>{glyph}</Text>
    </Box>
  )
}

function renderToolUseMessage(
  tool: Tool,
  input: unknown,
  { theme, verbose, commands }: { theme: ThemeName; verbose: boolean; commands: Command[] },
): React.ReactNode {
  try {
    const parsed = tool.inputSchema.safeParse(input)
    if (!parsed.success) {
      return ''
    }
    return tool.renderToolUseMessage(parsed.data, { theme, verbose, commands })
  } catch (error) {
    logError(new Error(`Error rendering tool use message for ${tool.name}: ${error}`))
    return ''
  }
}

function renderToolUseProgressMessage(
  tool: Tool,
  tools: Tools,
  lookups: ReturnType<typeof buildMessageLookups>,
  toolUseID: string,
  progressMessagesForMessage: ProgressMessage[],
  {
    verbose,
    inProgressToolCallCount,
    isTranscriptMode,
  }: { verbose: boolean; inProgressToolCallCount?: number; isTranscriptMode?: boolean },
  terminalSize: { columns: number; rows: number },
): React.ReactNode {
  const toolProgressMessages = progressMessagesForMessage.filter(
    (msg): msg is ProgressMessage<ToolProgressData> => msg.data.type !== 'hook_progress',
  )
  try {
    const toolMessages =
      tool.renderToolUseProgressMessage?.(toolProgressMessages, {
        tools,
        verbose,
        terminalSize,
        inProgressToolCallCount: inProgressToolCallCount ?? 1,
        isTranscriptMode,
      }) ?? null
    return (
      <>
        <SentryErrorBoundary>
          <HookProgressMessage
            hookEvent="PreToolUse"
            lookups={lookups}
            toolUseID={toolUseID}
            verbose={verbose}
            isTranscriptMode={isTranscriptMode}
          />
        </SentryErrorBoundary>
        {toolMessages}
      </>
    )
  } catch (error) {
    logError(
      new Error(`Error rendering tool use progress message for ${tool.name}: ${error}`),
    )
    return null
  }
}

function renderToolUseQueuedMessage(tool: Tool): React.ReactNode {
  try {
    return tool.renderToolUseQueuedMessage?.()
  } catch (error) {
    logError(new Error(`Error rendering tool use queued message for ${tool.name}: ${error}`))
    return null
  }
}
