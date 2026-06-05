import React from 'react';
import { handlePlanModeTransition } from '../../../bootstrap/state.js';
import { PRODUCT_DISPLAY_NAME } from '../../../constants/product.js';
import { Box, Text } from '../../../ink.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from '../../../services/analytics/index.js';
import { useAppState } from '../../../state/AppState.js';
import { isPlanModeInterviewPhaseEnabled } from '../../../utils/planModeV2.js';
import { Select } from '../../CustomSelect/index.js';
import { PermissionDialog } from '../PermissionDialog.js';
import type { PermissionRequestProps } from '../PermissionRequest.js';

export function EnterPlanModePermissionRequest({
  toolUseConfirm,
  onDone,
  onReject,
  workerBadge
}: PermissionRequestProps) {
  const toolPermissionContextMode = useAppState(s => s.toolPermissionContext.mode);

  const handleResponse = function handleResponse(value: 'yes' | 'no') {
    if (value === "yes") {
      logEvent("tengu_plan_enter", {
        interviewPhaseEnabled: isPlanModeInterviewPhaseEnabled(),
        entryMethod: "tool" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      handlePlanModeTransition(toolPermissionContextMode, "plan");
      onDone();
      toolUseConfirm.onAllow({}, [{
        type: "setMode",
        mode: "plan",
        destination: "session"
      }]);
    } else {
      onDone();
      onReject();
      toolUseConfirm.onReject();
    }
  };

  const options = [
    {
      label: "Yes, enter plan mode",
      value: "yes" as const
    },
    {
      label: "No, start implementing now",
      value: "no" as const
    }
  ];

  return (
    <PermissionDialog color="planMode" title="Enter plan mode?" workerBadge={workerBadge}>
      <Box flexDirection="column" marginTop={1} paddingX={1}>
        <Text>{PRODUCT_DISPLAY_NAME} wants to enter plan mode to explore and design an implementation approach.</Text>
        <Box marginTop={1} flexDirection="column">
          <Text dimColor={true}>In plan mode, {PRODUCT_DISPLAY_NAME} will:</Text>
          <Text dimColor={true}> · Explore the codebase thoroughly</Text>
          <Text dimColor={true}> · Identify existing patterns</Text>
          <Text dimColor={true}> · Design an implementation strategy</Text>
          <Text dimColor={true}> · Present a plan for your approval</Text>
        </Box>
        <Box marginTop={1}><Text dimColor={true}>No code changes will be made until you approve the plan.</Text></Box>
        <Box marginTop={1}>
          <Select options={options} onChange={handleResponse} onCancel={() => handleResponse("no")} />
        </Box>
      </Box>
    </PermissionDialog>
  );
}
