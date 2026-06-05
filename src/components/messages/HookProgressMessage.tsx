import * as React from 'react';
import type { HookEvent } from 'src/entrypoints/agentSdkTypes.js';
import type { buildMessageLookups } from 'src/utils/messages.js';
import { Box, Text } from '../../ink.js';
import { MessageResponse } from '../MessageResponse.js';
type Props = {
  hookEvent: HookEvent;
  lookups: ReturnType<typeof buildMessageLookups>;
  toolUseID: string;
  verbose: boolean;
  isTranscriptMode?: boolean;
};
export function HookProgressMessage({ hookEvent, lookups, toolUseID, isTranscriptMode }: Props) {
  const inProgressHookCount = lookups.inProgressHookCounts.get(toolUseID)?.get(hookEvent) ?? 0;
  const resolvedHookCount = lookups.resolvedHookCounts.get(toolUseID)?.get(hookEvent) ?? 0;
  if (inProgressHookCount === 0) {
    return null;
  }
  if (hookEvent === "PreToolUse" || hookEvent === "PostToolUse") {
    if (isTranscriptMode) {
      return (
        <MessageResponse>
          <Box flexDirection="row">
            <Text dimColor={true}>{inProgressHookCount} </Text>
            <Text dimColor={true} bold={true}>{hookEvent}</Text>
            <Text dimColor={true}>{inProgressHookCount === 1 ? " hook" : " hooks"} ran</Text>
          </Box>
        </MessageResponse>
      );
    }
    return null;
  }
  if (resolvedHookCount === inProgressHookCount) {
    return null;
  }
  return (
    <MessageResponse>
      <Box flexDirection="row">
        <Text dimColor={true}>Running </Text>
        <Text dimColor={true} bold={true}>{hookEvent}</Text>
        <Text dimColor={true}>{inProgressHookCount === 1 ? " hook…" : " hooks…"}</Text>
      </Box>
    </MessageResponse>
  );
}
