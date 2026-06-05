// src/components/PromptInput/PromptInputChrome.tsx
//
// Chrome do input (estilo grok): rampa de profundidade (painel → campo) com um
// trilho esquerdo sólido e a linha [indicador de modo + slot de edição]. A engine
// de edição (TextInput/VimTextInput) entra como `children`, intacta.

import * as React from 'react'
import { Box, type ClickEvent } from '../../ink.js'
import type { PromptInputMode } from '../../types/textInputTypes.js'
import { PromptInputModeIndicator } from './PromptInputModeIndicator.js'

type Props = {
  mode: PromptInputMode
  isLoading: boolean
  viewingAgentName?: string
  viewingAgentColor?: Parameters<typeof PromptInputModeIndicator>[0]['viewingAgentColor']
  /** Click no slot de edição (mover cursor / focar). */
  onInputClick: (e: ClickEvent) => void
  /** A engine de edição (TextInput ou VimTextInput), já configurada. */
  children: React.ReactNode
}

export function PromptInputChrome({
  mode,
  isLoading,
  viewingAgentName,
  viewingAgentColor,
  onInputClick,
  children,
}: Props): React.ReactNode {
  // Left rail removed by the owner's request: no colored stripe in any state
  // (it painted a purple block while the agent was working). The 1-cell column
  // stays as an INVISIBLE spacer so the prompt's horizontal alignment is
  // unchanged — it just never gets a background now.
  return (
    <Box flexDirection="column" width="100%">
      <Box flexDirection="row" alignItems="stretch">
        <Box width={1} flexShrink={0} />
        <Box
          flexDirection="row"
          alignItems="flex-start"
          justifyContent="flex-start"
          flexGrow={1}
          marginLeft={1}
        >
          <PromptInputModeIndicator
            mode={mode}
            isLoading={isLoading}
            viewingAgentName={viewingAgentName}
            viewingAgentColor={viewingAgentColor}
          />
          <Box flexGrow={1} flexShrink={1} onClick={onInputClick}>
            {children}
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
