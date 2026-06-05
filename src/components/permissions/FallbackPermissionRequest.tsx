import React from 'react';
import { getOriginalCwd } from '../../bootstrap/state.js';
import { Box, Text, useTheme } from '../../ink.js';
import { sanitizeToolNameForAnalytics } from '../../services/analytics/metadata.js';
import { env } from '../../utils/env.js';
import { shouldShowAlwaysAllowOptions } from '../../utils/permissions/permissionsLoader.js';
import { truncateToLines } from '../../utils/stringUtils.js';
import { logUnaryEvent } from '../../utils/unaryLogging.js';
import { type UnaryEvent, usePermissionRequestLogging } from './hooks.js';
import { PermissionDialog } from './PermissionDialog.js';
import { PermissionPrompt, type PermissionPromptOption, type ToolAnalyticsContext } from './PermissionPrompt.js';
import type { PermissionRequestProps } from './PermissionRequest.js';
import { PermissionRuleExplanation } from './PermissionRuleExplanation.js';
type FallbackOptionValue = 'yes' | 'yes-dont-ask-again' | 'no';
export function FallbackPermissionRequest({
  toolUseConfirm,
  onDone,
  onReject,
  workerBadge
}: PermissionRequestProps) {
  const [theme] = useTheme();
  const originalUserFacingName = toolUseConfirm.tool.userFacingName(toolUseConfirm.input as never);
  const userFacingName = originalUserFacingName.endsWith(" (MCP)") ? originalUserFacingName.slice(0, -6) : originalUserFacingName;
  const unaryEvent: UnaryEvent = {
    completion_type: "tool_use_single",
    language_name: "none"
  };
  usePermissionRequestLogging(toolUseConfirm, unaryEvent);
  const handleSelect = (value: FallbackOptionValue, feedback?: string) => {
    switch (value) {
      case "yes":
        {
          logUnaryEvent({
            completion_type: "tool_use_single",
            event: "accept",
            metadata: {
              language_name: "none",
              message_id: toolUseConfirm.assistantMessage.message.id,
              platform: env.platform
            }
          });
          toolUseConfirm.onAllow(toolUseConfirm.input, [], feedback);
          onDone();
          break;
        }
      case "yes-dont-ask-again":
        {
          logUnaryEvent({
            completion_type: "tool_use_single",
            event: "accept",
            metadata: {
              language_name: "none",
              message_id: toolUseConfirm.assistantMessage.message.id,
              platform: env.platform
            }
          });
          toolUseConfirm.onAllow(toolUseConfirm.input, [{
            type: "addRules",
            rules: [{
              toolName: toolUseConfirm.tool.name
            }],
            behavior: "allow",
            destination: "localSettings"
          }]);
          onDone();
          break;
        }
      case "no":
        {
          logUnaryEvent({
            completion_type: "tool_use_single",
            event: "reject",
            metadata: {
              language_name: "none",
              message_id: toolUseConfirm.assistantMessage.message.id,
              platform: env.platform
            }
          });
          toolUseConfirm.onReject(feedback);
          onReject();
          onDone();
        }
    }
  };
  const handleCancel = () => {
    logUnaryEvent({
      completion_type: "tool_use_single",
      event: "reject",
      metadata: {
        language_name: "none",
        message_id: toolUseConfirm.assistantMessage.message.id,
        platform: env.platform
      }
    });
    toolUseConfirm.onReject();
    onReject();
    onDone();
  };
  const originalCwd = getOriginalCwd();
  const showAlwaysAllowOptions = shouldShowAlwaysAllowOptions();
  const options: PermissionPromptOption<FallbackOptionValue>[] = [{
    label: "Yes",
    value: "yes",
    feedbackConfig: {
      type: "accept"
    }
  }];
  if (showAlwaysAllowOptions) {
    options.push({
      label: <Text>Yes, and don't ask again for {<Text bold={true}>{userFacingName}</Text>}{" "}commands in {<Text bold={true}>{originalCwd}</Text>}</Text>,
      value: "yes-dont-ask-again"
    });
  }
  options.push({
    label: "No",
    value: "no",
    feedbackConfig: {
      type: "reject"
    }
  });
  const toolAnalyticsContext: ToolAnalyticsContext = {
    toolName: sanitizeToolNameForAnalytics(toolUseConfirm.tool.name),
    isMcp: toolUseConfirm.tool.isMcp ?? false
  };
  return (
    <PermissionDialog title="Tool use" workerBadge={workerBadge}>
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text>{userFacingName}({toolUseConfirm.tool.renderToolUseMessage(toolUseConfirm.input as never, {
          theme,
          verbose: true
        })}){originalUserFacingName.endsWith(" (MCP)") ? <Text dimColor={true}> (MCP)</Text> : ""}</Text>
        <Text dimColor={true}>{truncateToLines(toolUseConfirm.description, 3)}</Text>
      </Box>
      <Box flexDirection="column">
        <PermissionRuleExplanation permissionResult={toolUseConfirm.permissionResult} toolType="tool" />
        <PermissionPrompt options={options} onSelect={handleSelect} onCancel={handleCancel} toolAnalyticsContext={toolAnalyticsContext} />
      </Box>
    </PermissionDialog>
  );
}
