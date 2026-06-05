import React, { type ReactNode, useCallback, useMemo, useState } from 'react';
import { PRODUCT_DISPLAY_NAME } from '../../constants/product.js';
import { Box, Text } from '../../ink.js';
import type { KeybindingAction } from '../../keybindings/types.js';
import { useKeybindings } from '../../keybindings/useKeybinding.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from '../../services/analytics/index.js';
import { useSetAppState } from '../../state/AppState.js';
import { type OptionWithDescription, Select } from '../CustomSelect/select.js';
export type FeedbackType = 'accept' | 'reject';
export type PermissionPromptOption<T extends string> = {
  value: T;
  label: ReactNode;
  feedbackConfig?: {
    type: FeedbackType;
    placeholder?: string;
  };
  keybinding?: KeybindingAction;
};
export type ToolAnalyticsContext = {
  toolName: string;
  isMcp: boolean;
};
export type PermissionPromptProps<T extends string> = {
  options: PermissionPromptOption<T>[];
  onSelect: (value: T, feedback?: string) => void;
  onCancel?: () => void;
  question?: string | ReactNode;
  toolAnalyticsContext?: ToolAnalyticsContext;
};
const DEFAULT_PLACEHOLDERS: Record<FeedbackType, string> = {
  accept: `tell ${PRODUCT_DISPLAY_NAME} what to do next`,
  reject: `tell ${PRODUCT_DISPLAY_NAME} what to do differently`
};

/**
 * Shared component for permission prompts with optional feedback input.
 *
 * Handles:
 * - "Do you want to proceed?" question with optional Tab hint
 * - Feature flag check for feedback capability
 * - Input mode toggling (Tab to expand feedback input)
 * - Analytics events for feedback interactions
 * - Transforming options to Select-compatible format
 */
export function PermissionPrompt<T extends string>({
  options,
  onSelect,
  onCancel,
  question = "Do you want to proceed?",
  toolAnalyticsContext
}: PermissionPromptProps<T>) {
  const setAppState = useSetAppState();
  const [acceptFeedback, setAcceptFeedback] = useState("");
  const [rejectFeedback, setRejectFeedback] = useState("");
  const [acceptInputMode, setAcceptInputMode] = useState(false);
  const [rejectInputMode, setRejectInputMode] = useState(false);
  const [focusedValue, setFocusedValue] = useState<T | null>(null);
  const [acceptFeedbackModeEntered, setAcceptFeedbackModeEntered] = useState(false);
  const [rejectFeedbackModeEntered, setRejectFeedbackModeEntered] = useState(false);
  const focusedOption = useMemo(() => options.find(opt => opt.value === focusedValue), [focusedValue, options]);
  const focusedFeedbackType = focusedOption?.feedbackConfig?.type;
  const showTabHint = focusedFeedbackType === "accept" && !acceptInputMode || focusedFeedbackType === "reject" && !rejectInputMode;
  const selectOptions = useMemo(() => options.map(opt => {
    const {
      value,
      label,
      feedbackConfig
    } = opt;
    if (!feedbackConfig) {
      return {
        label,
        value
      };
    }
    const {
      type,
      placeholder
    } = feedbackConfig;
    const isInputMode = type === "accept" ? acceptInputMode : rejectInputMode;
    const onChange = type === "accept" ? setAcceptFeedback : setRejectFeedback;
    const defaultPlaceholder = DEFAULT_PLACEHOLDERS[type];
    if (isInputMode) {
      return {
        type: "input" as const,
        label,
        value,
        placeholder: placeholder ?? defaultPlaceholder,
        onChange,
        allowEmptySubmitToCancel: true
      };
    }
    return {
      label,
      value
    };
  }), [acceptInputMode, options, rejectInputMode]);
  const handleInputModeToggle = useCallback((value: T) => {
    const option = options.find(opt => opt.value === value);
    if (!option?.feedbackConfig) {
      return;
    }
    const {
      type
    } = option.feedbackConfig;
    const analyticsProps = {
      toolName: toolAnalyticsContext?.toolName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      isMcp: toolAnalyticsContext?.isMcp ?? false
    };
    if (type === "accept") {
      if (acceptInputMode) {
        setAcceptInputMode(false);
        logEvent("tengu_accept_feedback_mode_collapsed", analyticsProps);
      } else {
        setAcceptInputMode(true);
        setAcceptFeedbackModeEntered(true);
        logEvent("tengu_accept_feedback_mode_entered", analyticsProps);
      }
    } else {
      if (type === "reject") {
        if (rejectInputMode) {
          setRejectInputMode(false);
          logEvent("tengu_reject_feedback_mode_collapsed", analyticsProps);
        } else {
          setRejectInputMode(true);
          setRejectFeedbackModeEntered(true);
          logEvent("tengu_reject_feedback_mode_entered", analyticsProps);
        }
      }
    }
  }, [acceptInputMode, options, rejectInputMode, toolAnalyticsContext?.isMcp, toolAnalyticsContext?.toolName]);
  const handleSelect = useCallback((value: T) => {
    const option = options.find(opt => opt.value === value);
    if (!option) {
      return;
    }
    let feedback;
    if (option.feedbackConfig) {
      const rawFeedback = option.feedbackConfig.type === "accept" ? acceptFeedback : rejectFeedback;
      const trimmedFeedback = rawFeedback.trim();
      if (trimmedFeedback) {
        feedback = trimmedFeedback;
      }
      const analyticsProps = {
        toolName: toolAnalyticsContext?.toolName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        isMcp: toolAnalyticsContext?.isMcp ?? false,
        has_instructions: !!trimmedFeedback,
        instructions_length: trimmedFeedback?.length ?? 0,
        entered_feedback_mode: option.feedbackConfig.type === "accept" ? acceptFeedbackModeEntered : rejectFeedbackModeEntered
      };
      if (option.feedbackConfig.type === "accept") {
        logEvent("tengu_accept_submitted", analyticsProps);
      } else {
        if (option.feedbackConfig.type === "reject") {
          logEvent("tengu_reject_submitted", analyticsProps);
        }
      }
    }
    onSelect(value, feedback);
  }, [acceptFeedback, acceptFeedbackModeEntered, onSelect, options, rejectFeedback, rejectFeedbackModeEntered, toolAnalyticsContext?.isMcp, toolAnalyticsContext?.toolName]);
  const keybindingHandlers = useMemo(() => {
    const handlers: Record<string, () => void> = {};
    for (const opt of options) {
      if (opt.keybinding) {
        handlers[opt.keybinding] = () => handleSelect(opt.value);
      }
    }
    return handlers;
  }, [handleSelect, options]);
  useKeybindings(keybindingHandlers, {
    context: "Confirmation"
  });
  const handleCancel = useCallback(() => {
    logEvent("tengu_permission_request_escape", {});
    setAppState(_temp);
    onCancel?.();
  }, [onCancel, setAppState]);
  const questionNode = typeof question === "string" ? <Text>{question}</Text> : question;
  const handleFocus = useCallback((value: T) => {
    const newOption = options.find(opt => opt.value === value);
    if (newOption?.feedbackConfig?.type !== "accept" && acceptInputMode && !acceptFeedback.trim()) {
      setAcceptInputMode(false);
    }
    if (newOption?.feedbackConfig?.type !== "reject" && rejectInputMode && !rejectFeedback.trim()) {
      setRejectInputMode(false);
    }
    setFocusedValue(value);
  }, [acceptFeedback, acceptInputMode, options, rejectFeedback, rejectInputMode]);
  return <Box flexDirection="column">{questionNode}<Select options={selectOptions} inlineDescriptions={true} onChange={handleSelect} onCancel={handleCancel} onFocus={handleFocus} onInputModeToggle={handleInputModeToggle} /><Box marginTop={1}><Text dimColor={true}>Esc to cancel{showTabHint && " \xB7 Tab to amend"}</Text></Box></Box>;
}
function _temp(prev) {
  return {
    ...prev,
    attribution: {
      ...prev.attribution,
      escapeCount: prev.attribution.escapeCount + 1
    }
  };
}
