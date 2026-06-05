import React from 'react';
import { Box, Text } from '../ink.js';
type Props = {
  query: string;
  placeholder?: string;
  isFocused: boolean;
  isTerminalFocused: boolean;
  prefix?: string;
  width?: number | string;
  cursorOffset?: number;
  borderless?: boolean;
};
export function SearchBox({
  query,
  placeholder = "Search…",
  isFocused,
  isTerminalFocused,
  prefix = "⌕",
  width,
  cursorOffset,
  borderless = false
}: Props) {
  const offset = cursorOffset ?? query.length;
  const content = isFocused ? <>{query ? isTerminalFocused ? <><Text>{query.slice(0, offset)}</Text><Text inverse={true}>{offset < query.length ? query[offset] : " "}</Text>{offset < query.length && <Text>{query.slice(offset + 1)}</Text>}</> : <Text>{query}</Text> : isTerminalFocused ? <><Text inverse={true}>{placeholder.charAt(0)}</Text><Text dimColor={true}>{placeholder.slice(1)}</Text></> : <Text dimColor={true}>{placeholder}</Text>}</> : query ? <Text>{query}</Text> : <Text>{placeholder}</Text>;
  const inner = <Text dimColor={!isFocused}>{prefix}{" "}{content}</Text>;
  return <Box flexShrink={0} borderStyle={borderless ? undefined : "round"} borderColor={isFocused ? "suggestion" : undefined} borderDimColor={!isFocused} paddingX={borderless ? 0 : 1} width={width}>{inner}</Box>;
}
