import React from 'react';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
import { Box, Text } from '../../ink.js';
import { FeedbackSurveyView, isValidResponseInput } from './FeedbackSurveyView.js';
import type { TranscriptShareResponse } from './TranscriptSharePrompt.js';
import { TranscriptSharePrompt } from './TranscriptSharePrompt.js';
import { useDebouncedDigitInput } from './useDebouncedDigitInput.js';
import type { FeedbackSurveyResponse } from './utils.js';
type Props = {
  state: 'closed' | 'open' | 'thanks' | 'transcript_prompt' | 'submitting' | 'submitted';
  lastResponse: FeedbackSurveyResponse | null;
  handleSelect: (selected: FeedbackSurveyResponse) => void;
  handleTranscriptSelect?: (selected: TranscriptShareResponse) => void;
  inputValue: string;
  setInputValue: (value: string) => void;
  onRequestFeedback?: () => void;
  message?: string;
};
export function FeedbackSurvey({
  state,
  lastResponse,
  handleSelect,
  handleTranscriptSelect,
  inputValue,
  setInputValue,
  onRequestFeedback,
  message
}: Props) {
  if (state === "closed") {
    return null;
  }
  if (state === "thanks") {
    return <FeedbackSurveyThanks lastResponse={lastResponse} inputValue={inputValue} setInputValue={setInputValue} onRequestFeedback={onRequestFeedback} />;
  }
  if (state === "submitted") {
    return <Box marginTop={1}><Text color="success">{"✓"} Thanks for sharing your transcript!</Text></Box>;
  }
  if (state === "submitting") {
    return <Box marginTop={1}><Text dimColor={true}>Sharing transcript{"…"}</Text></Box>;
  }
  if (state === "transcript_prompt") {
    if (!handleTranscriptSelect) {
      return null;
    }
    if (inputValue && !["1", "2", "3"].includes(inputValue)) {
      return null;
    }
    return <TranscriptSharePrompt onSelect={handleTranscriptSelect} inputValue={inputValue} setInputValue={setInputValue} />;
  }
  if (inputValue && !isValidResponseInput(inputValue)) {
    return null;
  }
  return <FeedbackSurveyView onSelect={handleSelect} inputValue={inputValue} setInputValue={setInputValue} message={message} />;
}
type ThanksProps = {
  lastResponse: FeedbackSurveyResponse | null;
  inputValue: string;
  setInputValue: (value: string) => void;
  onRequestFeedback?: () => void;
};
const isFollowUpDigit = (char: string): char is '1' => char === '1';
function FeedbackSurveyThanks({
  lastResponse,
  inputValue,
  setInputValue,
  onRequestFeedback
}: ThanksProps) {
  const showFollowUp = onRequestFeedback && lastResponse === "good";
  const onDigit = () => {
    logEvent("tengu_feedback_survey_event", {
      event_type: "followup_accepted" as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      response: lastResponse as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    onRequestFeedback?.();
  };
  useDebouncedDigitInput({
    inputValue,
    setInputValue,
    isValidDigit: isFollowUpDigit,
    enabled: Boolean(showFollowUp),
    once: true,
    onDigit
  });
  return <Box marginTop={1} flexDirection="column"><Text color="success">Thanks for the feedback!</Text>{showFollowUp ? <Text dimColor={true}>(Optional) Press [<Text color="ansi:cyan">1</Text>] to tell us what went well.</Text> : lastResponse === "bad" ? <Text dimColor={true}>Use the issue tracker to report model behavior issues.</Text> : null}</Box>;
}
