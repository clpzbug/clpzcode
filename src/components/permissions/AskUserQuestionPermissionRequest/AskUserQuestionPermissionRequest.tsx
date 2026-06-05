import type { Base64ImageSource, ImageBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs';
import React, { Suspense, use, useCallback, useMemo, useRef, useState } from 'react';
import { useSettings } from '../../../hooks/useSettings.js';
import { useTerminalSize } from '../../../hooks/useTerminalSize.js';
import { stringWidth } from '../../../ink/stringWidth.js';
import { useTheme } from '../../../ink.js';
import { useKeybindings } from '../../../keybindings/useKeybinding.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from '../../../services/analytics/index.js';
import { useAppState } from '../../../state/AppState.js';
import type { Question } from '../../../tools/AskUserQuestionTool/AskUserQuestionTool.js';
import { AskUserQuestionTool } from '../../../tools/AskUserQuestionTool/AskUserQuestionTool.js';
import { type CliHighlight, getCliHighlightPromise } from '../../../utils/cliHighlight.js';
import type { PastedContent } from '../../../utils/config.js';
import type { ImageDimensions } from '../../../utils/imageResizer.js';
import { maybeResizeAndDownsampleImageBlock } from '../../../utils/imageResizer.js';
import { cacheImagePath, storeImage } from '../../../utils/imageStore.js';
import { logError } from '../../../utils/log.js';
import { applyMarkdown } from '../../../utils/markdown.js';
import { isPlanModeInterviewPhaseEnabled } from '../../../utils/planModeV2.js';
import { getPlanFilePath } from '../../../utils/plans.js';
import type { PermissionRequestProps } from '../PermissionRequest.js';
import { QuestionView } from './QuestionView.js';
import { SubmitQuestionsView } from './SubmitQuestionsView.js';
import { useMultipleChoiceState } from './use-multiple-choice-state.js';
const MIN_CONTENT_HEIGHT = 12;
const MIN_CONTENT_WIDTH = 40;
// Lines used by chrome around the content area (nav bar, title, footer, help text, etc.)
const CONTENT_CHROME_OVERHEAD = 15;
export function AskUserQuestionPermissionRequest(props: PermissionRequestProps) {
  const settings = useSettings();
  if (settings.syntaxHighlightingDisabled) {
    return <AskUserQuestionPermissionRequestBody {...props} highlight={null} />;
  }
  return (
    <Suspense fallback={<AskUserQuestionPermissionRequestBody {...props} highlight={null} />}>
      <AskUserQuestionWithHighlight {...props} />
    </Suspense>
  );
}
function AskUserQuestionWithHighlight(props: PermissionRequestProps) {
  const highlightPromise = useMemo(() => getCliHighlightPromise(), []);
  const highlight = use(highlightPromise);
  return <AskUserQuestionPermissionRequestBody {...props} highlight={highlight} />;
}
function AskUserQuestionPermissionRequestBody({
  toolUseConfirm,
  onDone,
  onReject,
  highlight
}: PermissionRequestProps & {
  highlight: CliHighlight | null;
}) {
  const result = AskUserQuestionTool.inputSchema.safeParse(toolUseConfirm.input);
  const questions = result.success ? result.data.questions || [] : [];
  const {
    rows: terminalRows
  } = useTerminalSize();
  const [theme] = useTheme();
  let maxHeight = 0;
  let maxWidth = 0;
  const maxAllowedHeight = Math.max(MIN_CONTENT_HEIGHT, terminalRows - CONTENT_CHROME_OVERHEAD);
  for (const q of questions) {
    const hasPreview = q.options.some(opt => opt.preview);
    if (hasPreview) {
      const maxPreviewContentLines = Math.max(1, maxAllowedHeight - 11);
      let maxPreviewBoxHeight = 0;
      for (const opt of q.options) {
        if (opt.preview) {
          const rendered = applyMarkdown(opt.preview, theme, highlight);
          const previewLines = rendered.split("\n");
          const isTruncated = previewLines.length > maxPreviewContentLines;
          const displayedLines = isTruncated ? maxPreviewContentLines : previewLines.length;
          maxPreviewBoxHeight = Math.max(maxPreviewBoxHeight, displayedLines + (isTruncated ? 1 : 0) + 2);
          for (const line of previewLines) {
            maxWidth = Math.max(maxWidth, stringWidth(line));
          }
        }
      }
      const rightPanelHeight = maxPreviewBoxHeight + 2;
      const leftPanelHeight = q.options.length + 2;
      const sideByHeight = Math.max(leftPanelHeight, rightPanelHeight);
      maxHeight = Math.max(maxHeight, sideByHeight + 7);
    } else {
      maxHeight = Math.max(maxHeight, q.options.length + 3 + 7);
    }
  }
  const globalContentHeight = Math.min(Math.max(maxHeight, MIN_CONTENT_HEIGHT), maxAllowedHeight);
  const globalContentWidth = Math.max(maxWidth, MIN_CONTENT_WIDTH);
  const metadataSource = result.success ? result.data.metadata?.source : undefined;
  const [pastedContentsByQuestion, setPastedContentsByQuestion] = useState<Record<string, Record<number, PastedContent>>>({});
  const nextPasteIdRef = useRef(0);
  const onImagePaste = (
    questionText: string,
    base64Image: string,
    mediaType: string | undefined,
    filename: string | undefined,
    dimensions: ImageDimensions | undefined,
    _sourcePath?: string
  ) => {
    nextPasteIdRef.current = nextPasteIdRef.current + 1;
    const pasteId = nextPasteIdRef.current;
    const newContent: PastedContent = {
      id: pasteId,
      type: "image",
      content: base64Image,
      mediaType: mediaType || "image/png",
      filename: filename || "Pasted image",
      dimensions
    };
    cacheImagePath(newContent as any);
    storeImage(newContent as any);
    setPastedContentsByQuestion(prev => ({
      ...prev,
      [questionText]: {
        ...(prev[questionText] ?? {}),
        [pasteId]: newContent
      }
    }));
  };
  const onRemoveImage = (questionText: string, id: number) => {
    setPastedContentsByQuestion(prev => {
      const questionContents = {
        ...(prev[questionText] ?? {})
      };
      delete questionContents[id];
      return {
        ...prev,
        [questionText]: questionContents
      };
    });
  };
  const allImageAttachments = Object.values(pastedContentsByQuestion)
    .flatMap(contents => Object.values(contents))
    .filter(c => c.type === "image");
  const toolPermissionContextMode = useAppState(s => s.toolPermissionContext.mode);
  const isInPlanMode = toolPermissionContextMode === "plan";
  const planFilePath = isInPlanMode ? getPlanFilePath() : undefined;
  const state = useMultipleChoiceState();
  const {
    currentQuestionIndex,
    answers,
    questionStates,
    isInTextInput,
    nextQuestion,
    prevQuestion,
    updateQuestionState,
    setAnswer,
    setTextInputMode
  } = state;
  const currentQuestion = currentQuestionIndex < (questions?.length || 0) ? questions?.[currentQuestionIndex] : null;
  const isInSubmitView = currentQuestionIndex === (questions?.length || 0);
  const allQuestionsAnswered = questions?.every(q => q?.question && !!answers[q.question]) ?? false;
  const hideSubmitTab = questions.length === 1 && !questions[0]?.multiSelect;
  const handleCancel = () => {
    if (metadataSource) {
      logEvent("tengu_ask_user_question_rejected", {
        source: metadataSource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        questionCount: questions.length,
        isInPlanMode,
        interviewPhaseEnabled: isInPlanMode && isPlanModeInterviewPhaseEnabled()
      });
    }
    onDone();
    onReject();
    toolUseConfirm.onReject();
  };
  const handleRespondToClaude = async () => {
    const questionsWithAnswers = questions.map(q => {
      const answer = answers[q.question];
      if (answer) {
        return `- "${q.question}"\n  Answer: ${answer}`;
      }
      return `- "${q.question}"\n  (No answer provided)`;
    }).join("\n");
    const feedback = `The user wants to clarify these questions.
    This means they may have additional information, context or questions for you.
    Take their response into account and then reformulate the questions if appropriate.
    Start by asking them what they would like to clarify.

    Questions asked:\n${questionsWithAnswers}`;
    if (metadataSource) {
      logEvent("tengu_ask_user_question_respond_to_claude", {
        source: metadataSource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        questionCount: questions.length,
        isInPlanMode,
        interviewPhaseEnabled: isInPlanMode && isPlanModeInterviewPhaseEnabled()
      });
    }
    const imageBlocks = await convertImagesToBlocks(allImageAttachments);
    onDone();
    toolUseConfirm.onReject(feedback, imageBlocks && imageBlocks.length > 0 ? imageBlocks : undefined);
  };
  const handleFinishPlanInterview = async () => {
    const questionsWithAnswers = questions.map(q => {
      const answer = answers[q.question];
      if (answer) {
        return `- "${q.question}"\n  Answer: ${answer}`;
      }
      return `- "${q.question}"\n  (No answer provided)`;
    }).join("\n");
    const feedback = `The user has indicated they have provided enough answers for the plan interview.
Stop asking clarifying questions and proceed to finish the plan with the information you have.

Questions asked and answers provided:\n${questionsWithAnswers}`;
    if (metadataSource) {
      logEvent("tengu_ask_user_question_finish_plan_interview", {
        source: metadataSource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        questionCount: questions.length,
        isInPlanMode,
        interviewPhaseEnabled: isInPlanMode && isPlanModeInterviewPhaseEnabled()
      });
    }
    const imageBlocks = await convertImagesToBlocks(allImageAttachments);
    onDone();
    toolUseConfirm.onReject(feedback, imageBlocks && imageBlocks.length > 0 ? imageBlocks : undefined);
  };
  const submitAnswers = async (answersToSubmit: Record<string, string>) => {
    if (metadataSource) {
      logEvent("tengu_ask_user_question_accepted", {
        source: metadataSource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        questionCount: questions.length,
        answerCount: Object.keys(answersToSubmit).length,
        isInPlanMode,
        interviewPhaseEnabled: isInPlanMode && isPlanModeInterviewPhaseEnabled()
      });
    }
    const annotations = {};
    for (const q of questions) {
      const answer = answersToSubmit[q.question];
      const notes = questionStates[q.question]?.textInputValue;
      const selectedOption = answer ? q.options.find(opt => opt.label === answer) : undefined;
      const preview = selectedOption?.preview;
      if (preview || notes?.trim()) {
        annotations[q.question] = {
          ...(preview && {
            preview
          }),
          ...(notes?.trim() && {
            notes: notes.trim()
          })
        };
      }
    }
    const updatedInput = {
      ...toolUseConfirm.input,
      answers: answersToSubmit,
      ...(Object.keys(annotations).length > 0 && {
        annotations
      })
    };
    const contentBlocks = await convertImagesToBlocks(allImageAttachments);
    onDone();
    toolUseConfirm.onAllow(updatedInput, [], undefined, contentBlocks && contentBlocks.length > 0 ? contentBlocks : undefined);
  };
  const handleQuestionAnswer = (
    questionText: string,
    label: string | string[],
    textInput?: string,
    shouldAdvance = true
  ) => {
    let answer: string;
    const isMultiSelect = Array.isArray(label);
    if (isMultiSelect) {
      answer = label.join(", ");
    } else {
      if (textInput) {
        const questionImages = Object.values(pastedContentsByQuestion[questionText] ?? {}).filter(c => c.type === "image");
        answer = questionImages.length > 0 ? `${textInput} (Image attached)` : textInput;
      } else {
        if (label === "__other__") {
          const questionImages = Object.values(pastedContentsByQuestion[questionText] ?? {}).filter(c => c.type === "image");
          answer = questionImages.length > 0 ? "(Image attached)" : label;
        } else {
          answer = label;
        }
      }
    }
    const isSingleQuestion = questions.length === 1;
    if (!isMultiSelect && isSingleQuestion && shouldAdvance) {
      const updatedAnswers = {
        ...answers,
        [questionText]: answer
      };
      submitAnswers(updatedAnswers).catch(logError);
      return;
    }
    setAnswer(questionText, answer, shouldAdvance);
  };
  const handleFinalResponse = (value: string) => {
    if (value === "cancel") {
      handleCancel();
      return;
    }
    if (value === "submit") {
      submitAnswers(answers).catch(logError);
    }
  };
  const maxIndex = hideSubmitTab ? (questions?.length || 1) - 1 : questions?.length || 0;
  const handleTabPrev = () => {
    if (currentQuestionIndex > 0) {
      prevQuestion();
    }
  };
  const handleTabNext = () => {
    if (currentQuestionIndex < maxIndex) {
      nextQuestion();
    }
  };
  useKeybindings({
    "tabs:previous": handleTabPrev,
    "tabs:next": handleTabNext
  }, {
    context: "Tabs",
    isActive: !(isInTextInput && !isInSubmitView)
  });
  if (currentQuestion) {
    return (
      <>
        <QuestionView
          question={currentQuestion}
          questions={questions}
          currentQuestionIndex={currentQuestionIndex}
          answers={answers}
          questionStates={questionStates}
          hideSubmitTab={hideSubmitTab}
          minContentHeight={globalContentHeight}
          minContentWidth={globalContentWidth}
          planFilePath={planFilePath}
          onUpdateQuestionState={updateQuestionState}
          onAnswer={handleQuestionAnswer}
          onTextInputFocus={setTextInputMode}
          onCancel={handleCancel}
          onSubmit={nextQuestion}
          onTabPrev={handleTabPrev}
          onTabNext={handleTabNext}
          onRespondToClaude={handleRespondToClaude}
          onFinishPlanInterview={handleFinishPlanInterview}
          onImagePaste={(base64, mediaType, filename, dims, path) => onImagePaste(currentQuestion.question, base64, mediaType, filename, dims, path)}
          pastedContents={pastedContentsByQuestion[currentQuestion.question] ?? {}}
          onRemoveImage={id => onRemoveImage(currentQuestion.question, id)}
        />
      </>
    );
  }
  if (isInSubmitView) {
    return (
      <>
        <SubmitQuestionsView
          questions={questions}
          currentQuestionIndex={currentQuestionIndex}
          answers={answers}
          allQuestionsAnswered={allQuestionsAnswered}
          permissionResult={toolUseConfirm.permissionResult}
          minContentHeight={globalContentHeight}
          onFinalResponse={handleFinalResponse}
        />
      </>
    );
  }
  return null;
}
async function convertImagesToBlocks(images: PastedContent[]): Promise<ImageBlockParam[] | undefined> {
  if (images.length === 0) return undefined;
  return Promise.all(images.map(async img => {
    const block: ImageBlockParam = {
      type: 'image',
      source: {
        type: 'base64',
        media_type: (img.mediaType || 'image/png') as Base64ImageSource['media_type'],
        data: img.content
      }
    };
    const resized = await maybeResizeAndDownsampleImageBlock(block);
    return resized.block;
  }));
}
