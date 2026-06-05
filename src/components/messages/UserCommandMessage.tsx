import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import figures from 'figures';
import * as React from 'react';
import { COMMAND_MESSAGE_TAG } from '../../constants/xml.js';
import { Box, Text } from '../../ink.js';
import { extractTag } from '../../utils/messages.js';
type Props = {
  addMargin: boolean;
  param: TextBlockParam;
};
export function UserCommandMessage({ addMargin, param }: Props) {
  const { text } = param;
  const commandMessage = extractTag(text, COMMAND_MESSAGE_TAG);
  const args = extractTag(text, "command-args");
  const isSkillFormat = extractTag(text, "skill-format") === "true";
  if (!commandMessage) {
    return null;
  }
  if (isSkillFormat) {
    return (
      <Box flexDirection="column" marginTop={addMargin ? 1 : 0} backgroundColor="commandMessageBackground" paddingRight={1}>
        <Text><Text color="subtle">{figures.pointer} </Text><Text color="text">Skill({commandMessage})</Text></Text>
      </Box>
    );
  }
  const content = `/${[commandMessage, args].filter(Boolean).join(" ")}`;
  return (
    <Box flexDirection="column" marginTop={addMargin ? 1 : 0} backgroundColor="commandMessageBackground" paddingRight={1}>
      <Text><Text color="subtle">{figures.pointer} </Text><Text color="text">{content}</Text></Text>
    </Box>
  );
}
