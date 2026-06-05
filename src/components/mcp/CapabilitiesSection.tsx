import React from 'react';
import { Box, Text } from '../../ink.js';
import { Byline } from '../design-system/Byline.js';
type Props = {
  serverToolsCount: number;
  serverPromptsCount: number;
  serverResourcesCount: number;
};
export function CapabilitiesSection({
  serverToolsCount,
  serverPromptsCount,
  serverResourcesCount
}: Props) {
  const capabilities: string[] = [];
  if (serverToolsCount > 0) {
    capabilities.push("tools");
  }
  if (serverResourcesCount > 0) {
    capabilities.push("resources");
  }
  if (serverPromptsCount > 0) {
    capabilities.push("prompts");
  }
  return (
    <Box>
      <Text bold={true}>Capabilities: </Text>
      <Text color="text">{capabilities.length > 0 ? <Byline>{capabilities}</Byline> : "none"}</Text>
    </Box>
  );
}
