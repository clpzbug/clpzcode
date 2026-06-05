import * as React from 'react';
import { useContext } from 'react';
import { Box, NoSelect, Text } from '../ink.js';
import { Ratchet } from './design-system/Ratchet.js';
type Props = {
  children: React.ReactNode;
  height?: number;
};
export function MessageResponse({ children, height }: Props) {
  const isMessageResponse = useContext(MessageResponseContext);
  if (isMessageResponse) {
    return children;
  }
  const content = (
    <MessageResponseProvider>
      <Box flexDirection="row" height={height} overflowY="hidden">
        <NoSelect fromLeftEdge={true} flexShrink={0}><Text dimColor={true}>{" "}└   </Text></NoSelect>
        <Box flexShrink={1} flexGrow={1}>{children}</Box>
      </Box>
    </MessageResponseProvider>
  );
  if (height !== undefined) {
    return content;
  }
  return <Ratchet lock="offscreen">{content}</Ratchet>;
}

// Width of the "  └  " prefix rendered by MessageResponse.
// Exported so children that need to adjust their own column calculations
// (e.g. TaskListV2) can subtract this when inside a MessageResponse.
export const MESSAGE_RESPONSE_PREFIX_WIDTH = 5;

// This is a context that is used to determine if the message response
// is rendered as a descendant of another MessageResponse. We use it
// to avoid rendering nested └ characters.
export const MessageResponseContext = React.createContext(false);
function MessageResponseProvider({ children }: { children: React.ReactNode }) {
  return <MessageResponseContext.Provider value={true}>{children}</MessageResponseContext.Provider>;
}
