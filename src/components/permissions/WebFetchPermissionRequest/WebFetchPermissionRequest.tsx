import React, { useMemo } from 'react';
import { PRODUCT_DISPLAY_NAME } from '../../../constants/product.js';
import { Box, Text, useTheme } from '../../../ink.js';
import { WebFetchTool } from '../../../tools/WebFetchTool/WebFetchTool.js';
import { shouldShowAlwaysAllowOptions } from '../../../utils/permissions/permissionsLoader.js';
import { type OptionWithDescription, Select } from '../../CustomSelect/select.js';
import { type UnaryEvent, usePermissionRequestLogging } from '../hooks.js';
import { PermissionDialog } from '../PermissionDialog.js';
import type { PermissionRequestProps } from '../PermissionRequest.js';
import { PermissionRuleExplanation } from '../PermissionRuleExplanation.js';
import { logUnaryPermissionEvent } from '../utils.js';
function inputToPermissionRuleContent(input: {
  [k: string]: unknown;
}): string {
  try {
    const parsedInput = WebFetchTool.inputSchema.safeParse(input);
    if (!parsedInput.success) {
      return `input:${input.toString()}`;
    }
    const {
      url
    } = parsedInput.data;
    const hostname = new URL(url).hostname;
    return `domain:${hostname}`;
  } catch {
    return `input:${input.toString()}`;
  }
}
export function WebFetchPermissionRequest({
  toolUseConfirm,
  onDone,
  onReject,
  verbose,
  workerBadge
}: PermissionRequestProps) {
  const [theme] = useTheme();
  const {
    url
  } = toolUseConfirm.input as {
    url: string;
  };
  const hostname = useMemo(() => new URL(url).hostname, [url]);
  const unaryEvent: UnaryEvent = {
    completion_type: "tool_use_single",
    language_name: "none"
  };
  usePermissionRequestLogging(toolUseConfirm, unaryEvent);
  const showAlwaysAllowOptions = shouldShowAlwaysAllowOptions();
  const options = useMemo(() => {
    const result: OptionWithDescription<string>[] = [{
      label: "Yes",
      value: "yes"
    }];
    if (showAlwaysAllowOptions) {
      result.push({
        label: <Text>Yes, and don't ask again for <Text bold={true}>{hostname}</Text></Text>,
        value: "yes-dont-ask-again-domain"
      });
    }
    result.push({
      label: <Text>No, and tell {PRODUCT_DISPLAY_NAME} what to do differently <Text bold={true}>(esc)</Text></Text>,
      value: "no"
    });
    return result;
  }, [hostname, showAlwaysAllowOptions]);
  const onChange = useMemo(() => function onChange(newValue: string) {
    bb8: switch (newValue) {
      case "yes":
        {
          logUnaryPermissionEvent("tool_use_single", toolUseConfirm, "accept");
          toolUseConfirm.onAllow(toolUseConfirm.input, []);
          onDone();
          break bb8;
        }
      case "yes-dont-ask-again-domain":
        {
          logUnaryPermissionEvent("tool_use_single", toolUseConfirm, "accept");
          const ruleContent = inputToPermissionRuleContent(toolUseConfirm.input);
          const ruleValue = {
            toolName: toolUseConfirm.tool.name,
            ruleContent
          };
          toolUseConfirm.onAllow(toolUseConfirm.input, [{
            type: "addRules",
            rules: [ruleValue],
            behavior: "allow",
            destination: "localSettings"
          }]);
          onDone();
          break bb8;
        }
      case "no":
        {
          logUnaryPermissionEvent("tool_use_single", toolUseConfirm, "reject");
          toolUseConfirm.onReject();
          onReject();
          onDone();
        }
    }
  }, [onDone, onReject, toolUseConfirm]);
  const message = useMemo(() => WebFetchTool.renderToolUseMessage(toolUseConfirm.input as {
    url: string;
    prompt: string;
  }, {
    theme,
    verbose
  }), [theme, toolUseConfirm.input, verbose]);
  return <PermissionDialog title="Fetch" workerBadge={workerBadge}>
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text>{message}</Text>
        <Text dimColor={true}>{toolUseConfirm.description}</Text>
      </Box>
      <Box flexDirection="column">
        <PermissionRuleExplanation permissionResult={toolUseConfirm.permissionResult} toolType="tool" />
        <Text>Do you want to allow {PRODUCT_DISPLAY_NAME} to fetch this content?</Text>
        <Select options={options} onChange={onChange} onCancel={() => onChange("no")} />
      </Box>
    </PermissionDialog>;
}
