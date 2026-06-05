import * as React from 'react'
import { Box, Text } from 'src/ink.js'
import {
  AGENT_COLOR_TO_THEME_COLOR,
  AGENT_COLORS,
  type AgentColorName,
} from 'src/tools/AgentTool/agentColorManager.js'
import type { PromptInputMode } from 'src/types/textInputTypes.js'
import { getTeammateColor } from 'src/utils/teammate.js'
import type { Theme } from 'src/utils/theme.js'
import { isAgentSwarmsEnabled } from '../../utils/agentSwarmsEnabled.js'
import { GLYPH, role } from '../../tui/design/index.js'

type Props = {
  mode: PromptInputMode
  isLoading: boolean
  viewingAgentName?: string
  viewingAgentColor?: AgentColorName
}

/**
 * Theme color key for the teammate's assigned color.
 * Returns undefined if not a teammate or if the color is invalid.
 */
function getTeammateThemeColor(): keyof Theme | undefined {
  if (!isAgentSwarmsEnabled()) {
    return undefined
  }
  const colorName = getTeammateColor()
  if (!colorName) {
    return undefined
  }
  if (AGENT_COLORS.includes(colorName as AgentColorName)) {
    return AGENT_COLOR_TO_THEME_COLOR[colorName as AgentColorName]
  }
  return undefined
}

type PromptCharProps = {
  isLoading: boolean
  // Dead code elimination: parameter named themeColor to avoid "teammate" string in external builds
  themeColor?: keyof Theme
}

/**
 * Prompt chevron (›) — convite minimalista a digitar (GLYPH.prompt).
 *
 * Cor: accent único (roxo) por padrão. Uma cor de teammate, quando presente, é
 * um ESTADO real (você está digitando para outro ator) e por isso sobrepõe o
 * accent — segue a regra "cor semântica só para sinal". `isLoading` dim mantém
 * o comportamento original (o chevron recua enquanto o turno corre).
 */
function PromptChar({ isLoading, themeColor }: PromptCharProps): React.ReactNode {
  const color = themeColor ?? role('accent')
  return (
    <Text color={color} dimColor={isLoading}>
      {GLYPH.prompt}
    </Text>
  )
}

export function PromptInputModeIndicator({
  mode,
  isLoading,
  viewingAgentName,
  viewingAgentColor,
}: Props): React.ReactNode {
  // Stable for the session — read once (matches the memoized original).
  const teammateColor = React.useMemo(() => getTeammateThemeColor(), [])
  const viewedTeammateThemeColor = viewingAgentColor
    ? AGENT_COLOR_TO_THEME_COLOR[viewingAgentColor]
    : undefined

  return (
    <Box
      alignItems="flex-start"
      alignSelf="flex-start"
      flexWrap="nowrap"
      justifyContent="flex-start"
      marginRight={1}
    >
      {viewingAgentName ? (
        <PromptChar isLoading={isLoading} themeColor={viewedTeammateThemeColor} />
      ) : mode === 'bash' ? (
        // Modo como PALAVRA, não símbolo solto. Mantém a cor de modo (bashBorder).
        <Text color="bashBorder" dimColor={isLoading}>
          bash
        </Text>
      ) : (
        <PromptChar
          isLoading={isLoading}
          themeColor={isAgentSwarmsEnabled() ? teammateColor : undefined}
        />
      )}
    </Box>
  )
}
