import React from 'react';
import { logError } from 'src/utils/log.js';
import { getOriginalCwd } from '../../../bootstrap/state.js';
import { PRODUCT_DISPLAY_NAME } from '../../../constants/product.js';
import { Box, Text } from '../../../ink.js';
import { sanitizeToolNameForAnalytics } from '../../../services/analytics/metadata.js';
import { SKILL_TOOL_NAME } from '../../../tools/SkillTool/constants.js';
import { SkillTool } from '../../../tools/SkillTool/SkillTool.js';
import { env } from '../../../utils/env.js';
import { shouldShowAlwaysAllowOptions } from '../../../utils/permissions/permissionsLoader.js';
import { logUnaryEvent } from '../../../utils/unaryLogging.js';
import { type UnaryEvent, usePermissionRequestLogging } from '../hooks.js';
import { PermissionDialog } from '../PermissionDialog.js';
import { PermissionPrompt, type PermissionPromptOption } from '../PermissionPrompt.js';
import type { PermissionRequestProps } from '../PermissionRequest.js';
import { PermissionRuleExplanation } from '../PermissionRuleExplanation.js';
type SkillOptionValue = 'yes' | 'yes-exact' | 'yes-prefix' | 'no';
function parseInput(input: unknown): string {
  const result = SkillTool.inputSchema.safeParse(input);
  if (!result.success) {
    logError(new Error(`Failed to parse skill tool input: ${result.error.message}`));
    return '';
  }
  return result.data.skill;
}
export function SkillPermissionRequest(props: PermissionRequestProps): React.ReactNode {
  const { toolUseConfirm, onDone, onReject, workerBadge } = props;
  const skill = parseInput(toolUseConfirm.input);
  const commandObj = toolUseConfirm.permissionResult.behavior === 'ask' && toolUseConfirm.permissionResult.metadata && 'command' in toolUseConfirm.permissionResult.metadata ? toolUseConfirm.permissionResult.metadata.command : undefined;
  const unaryEvent: UnaryEvent = {
    completion_type: 'tool_use_single',
    language_name: 'none'
  };
  usePermissionRequestLogging(toolUseConfirm, unaryEvent);
  const originalCwd = getOriginalCwd();
  const showAlwaysAllowOptions = shouldShowAlwaysAllowOptions();
  const baseOptions: PermissionPromptOption<SkillOptionValue>[] = [{
    label: 'Yes',
    value: 'yes',
    feedbackConfig: {
      type: 'accept'
    }
  }];
  const alwaysAllowOptions: PermissionPromptOption<SkillOptionValue>[] = [];
  if (showAlwaysAllowOptions) {
    alwaysAllowOptions.push({
      label: <Text>Yes, and don't ask again for {<Text bold={true}>{skill}</Text>} in{' '}{<Text bold={true}>{originalCwd}</Text>}</Text>,
      value: 'yes-exact'
    });
    const spaceIndex = skill.indexOf(' ');
    if (spaceIndex > 0) {
      const commandPrefix = skill.substring(0, spaceIndex);
      alwaysAllowOptions.push({
        label: <Text>Yes, and don't ask again for{' '}{<Text bold={true}>{commandPrefix + ':*'}</Text>} commands in{' '}{<Text bold={true}>{originalCwd}</Text>}</Text>,
        value: 'yes-prefix'
      });
    }
  }
  const noOption: PermissionPromptOption<SkillOptionValue> = {
    label: 'No',
    value: 'no',
    feedbackConfig: {
      type: 'reject'
    }
  };
  const options = [...baseOptions, ...alwaysAllowOptions, noOption];
  const toolAnalyticsContext = {
    toolName: sanitizeToolNameForAnalytics(toolUseConfirm.tool.name),
    isMcp: toolUseConfirm.tool.isMcp ?? false
  };
  const handleSelect = (value: SkillOptionValue, feedback?: string) => {
    switch (value) {
      case 'yes':
        {
          logUnaryEvent({
            completion_type: 'tool_use_single',
            event: 'accept',
            metadata: {
              language_name: 'none',
              message_id: toolUseConfirm.assistantMessage.message.id,
              platform: env.platform
            }
          });
          toolUseConfirm.onAllow(toolUseConfirm.input, [], feedback);
          onDone();
          break;
        }
      case 'yes-exact':
        {
          logUnaryEvent({
            completion_type: 'tool_use_single',
            event: 'accept',
            metadata: {
              language_name: 'none',
              message_id: toolUseConfirm.assistantMessage.message.id,
              platform: env.platform
            }
          });
          toolUseConfirm.onAllow(toolUseConfirm.input, [{
            type: 'addRules',
            rules: [{
              toolName: SKILL_TOOL_NAME,
              ruleContent: skill
            }],
            behavior: 'allow',
            destination: 'localSettings'
          }]);
          onDone();
          break;
        }
      case 'yes-prefix':
        {
          logUnaryEvent({
            completion_type: 'tool_use_single',
            event: 'accept',
            metadata: {
              language_name: 'none',
              message_id: toolUseConfirm.assistantMessage.message.id,
              platform: env.platform
            }
          });
          const spaceIndex = skill.indexOf(' ');
          const commandPrefix = spaceIndex > 0 ? skill.substring(0, spaceIndex) : skill;
          toolUseConfirm.onAllow(toolUseConfirm.input, [{
            type: 'addRules',
            rules: [{
              toolName: SKILL_TOOL_NAME,
              ruleContent: `${commandPrefix}:*`
            }],
            behavior: 'allow',
            destination: 'localSettings'
          }]);
          onDone();
          break;
        }
      case 'no':
        {
          logUnaryEvent({
            completion_type: 'tool_use_single',
            event: 'reject',
            metadata: {
              language_name: 'none',
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
      completion_type: 'tool_use_single',
      event: 'reject',
      metadata: {
        language_name: 'none',
        message_id: toolUseConfirm.assistantMessage.message.id,
        platform: env.platform
      }
    });
    toolUseConfirm.onReject();
    onReject();
    onDone();
  };
  return <PermissionDialog title={`Use skill "${skill}"?`} workerBadge={workerBadge}>
      <Text>{PRODUCT_DISPLAY_NAME} may use instructions, code, or files from this Skill.</Text>
      <Box flexDirection="column" paddingX={2} paddingY={1}><Text dimColor={true}>{commandObj?.description}</Text></Box>
      <Box flexDirection="column">
        <PermissionRuleExplanation permissionResult={toolUseConfirm.permissionResult} toolType="tool" />
        <PermissionPrompt options={options} onSelect={handleSelect} onCancel={handleCancel} toolAnalyticsContext={toolAnalyticsContext} />
      </Box>
    </PermissionDialog>;
}
