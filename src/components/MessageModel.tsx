import React from 'react';
import { stringWidth } from '../ink/stringWidth.js';
import { Box, Text } from '../ink.js';
import type { NormalizedMessage } from '../types/message.js';
type Props = {
  message: NormalizedMessage;
  isTranscriptMode: boolean;
};
export function MessageModel({ message, isTranscriptMode }: Props) {
  const shouldShowModel = isTranscriptMode && message.type === "assistant" && message.message.model && message.message.content.some(_temp);
  if (!shouldShowModel) {
    return null;
  }
  const minWidth = stringWidth(message.message.model) + 8;
  return <Box minWidth={minWidth}><Text dimColor={true}>{message.message.model}</Text></Box>;
}
function _temp(c) {
  return c.type === "text";
}
