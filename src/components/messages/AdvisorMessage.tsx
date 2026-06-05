import figures from 'figures';
import React from 'react';
import { Box, Text } from '../../ink.js';
import type { AdvisorBlock } from '../../utils/advisor.js';
import { renderModelName } from '../../utils/model/model.js';
import { jsonStringify } from '../../utils/slowOperations.js';
import { CtrlOToExpand } from '../CtrlOToExpand.js';
import { MessageResponse } from '../MessageResponse.js';
import { ToolUseLoader } from '../ToolUseLoader.js';
type Props = {
  block: AdvisorBlock;
  addMargin: boolean;
  resolvedToolUseIDs: Set<string>;
  erroredToolUseIDs: Set<string>;
  shouldAnimate: boolean;
  verbose: boolean;
  advisorModel?: string;
};
export function AdvisorMessage({
  block,
  addMargin,
  resolvedToolUseIDs,
  erroredToolUseIDs,
  shouldAnimate,
  verbose,
  advisorModel
}: Props) {
  if (block.type === "server_tool_use") {
    const input = block.input && Object.keys(block.input).length > 0 ? jsonStringify(block.input) : null;
    const isUnresolved = !resolvedToolUseIDs.has(block.id);
    const isError = erroredToolUseIDs.has(block.id);
    return (
      <Box marginTop={addMargin ? 1 : 0} paddingRight={2} flexDirection="row">
        <ToolUseLoader shouldAnimate={shouldAnimate} isUnresolved={isUnresolved} isError={isError} />
        <Text bold={true}>Advising</Text>
        {advisorModel ? <Text dimColor={true}> using {renderModelName(advisorModel)}</Text> : null}
        {input ? <Text dimColor={true}> · {input}</Text> : null}
      </Box>
    );
  }
  let body;
  switch (block.content.type) {
    case "advisor_tool_result_error":
      {
        body = <Text color="error">Advisor unavailable ({block.content.error_code})</Text>;
        break;
      }
    case "advisor_result":
      {
        body = verbose ? <Text dimColor={true}>{block.content.text}</Text> : <Text dimColor={true}>{figures.tick} Advisor has reviewed the conversation and will apply the feedback <CtrlOToExpand /></Text>;
        break;
      }
    case "advisor_redacted_result":
      {
        body = <Text dimColor={true}>{figures.tick} Advisor has reviewed the conversation and will apply the feedback</Text>;
      }
  }
  return <Box paddingRight={2}><MessageResponse>{body}</MessageResponse></Box>;
}
