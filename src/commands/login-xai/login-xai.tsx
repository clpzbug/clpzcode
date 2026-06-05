import * as React from 'react'
import type { LocalJSXCommandContext } from '../../commands.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { Spinner } from '../../components/Spinner.js'
import { useXaiOAuthFlow } from '../../components/useXaiOAuthFlow.js'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { switchProviderEnvForModel } from '../../utils/model/multiProviderOptions.js'

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: LocalJSXCommandContext,
): Promise<React.ReactNode> {
  return <XaiLogin onDone={onDone} />
}

function XaiLogin({
  onDone,
}: {
  onDone: LocalJSXCommandOnDone
}): React.ReactNode {
  const onAuthenticated = React.useCallback(
    (_tokens: unknown, persistCredentials: () => void) => {
      persistCredentials()
      switchProviderEnvForModel('grok-4.3')
      onDone('xAI login successful. Use /model to select a Grok model.')
    },
    [onDone],
  )

  const status = useXaiOAuthFlow({ onAuthenticated })

  return (
    <Dialog
      title="xAI Login"
      onCancel={() => onDone('xAI login cancelled')}
    >
      {status.state === 'starting' && (
        <Box gap={1}>
          <Spinner />
          <Text>Starting xAI OAuth…</Text>
        </Box>
      )}
      {status.state === 'waiting' && (
        <Box flexDirection="column" gap={1}>
          <Text>Sign in with xAI in your browser:</Text>
          <Text color="suggestion">{status.authUrl}</Text>
          {status.browserOpened === false && (
            <Text dimColor>
              Could not open browser — open the URL above manually.
            </Text>
          )}
          <Box gap={1}>
            <Spinner />
            <Text dimColor>Waiting for authentication…</Text>
          </Box>
        </Box>
      )}
      {status.state === 'error' && (
        <Box flexDirection="column" gap={1}>
          <Text color="error">xAI login failed: {status.message}</Text>
          <Text dimColor>Press Esc to close.</Text>
        </Box>
      )}
    </Dialog>
  )
}
