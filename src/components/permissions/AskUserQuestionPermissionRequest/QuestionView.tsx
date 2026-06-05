import figures from 'figures';
import React, { useState } from 'react';
import { Box, Text, useInput } from '../../../ink.js';
import { useAppState } from '../../../state/AppState.js';
import type { Question, QuestionOption } from '../../../tools/AskUserQuestionTool/AskUserQuestionTool.js';
import type { PastedContent } from '../../../utils/config.js';
import { getExternalEditor } from '../../../utils/editor.js';
import { toIDEDisplayName } from '../../../utils/ide.js';
import type { ImageDimensions } from '../../../utils/imageResizer.js';
import { editPromptInEditor } from '../../../utils/promptEditor.js';
import { type OptionWithDescription, Select, SelectMulti } from '../../CustomSelect/index.js';
import { Divider } from '../../design-system/Divider.js';
import { FilePathLink } from '../../FilePathLink.js';
import { PermissionRequestTitle } from '../PermissionRequestTitle.js';
import { PreviewQuestionView } from './PreviewQuestionView.js';
import { QuestionNavigationBar } from './QuestionNavigationBar.js';
import type { QuestionState } from './use-multiple-choice-state.js';
type Props = {
  question: Question;
  questions: Question[];
  currentQuestionIndex: number;
  answers: Record<string, string>;
  questionStates: Record<string, QuestionState>;
  hideSubmitTab?: boolean;
  planFilePath?: string;
  pastedContents?: Record<number, PastedContent>;
  minContentHeight?: number;
  minContentWidth?: number;
  onUpdateQuestionState: (questionText: string, updates: Partial<QuestionState>, isMultiSelect: boolean) => void;
  onAnswer: (questionText: string, label: string | string[], textInput?: string, shouldAdvance?: boolean) => void;
  onTextInputFocus: (isInInput: boolean) => void;
  onCancel: () => void;
  onSubmit: () => void;
  onTabPrev?: () => void;
  onTabNext?: () => void;
  onRespondToClaude: () => void;
  onFinishPlanInterview: () => void;
  onImagePaste?: (base64Image: string, mediaType?: string, filename?: string, dimensions?: ImageDimensions, sourcePath?: string) => void;
  onRemoveImage?: (id: number) => void;
};
export function QuestionView({
  question,
  questions,
  currentQuestionIndex,
  answers,
  questionStates,
  hideSubmitTab = false,
  planFilePath,
  minContentHeight,
  minContentWidth,
  onUpdateQuestionState,
  onAnswer,
  onTextInputFocus,
  onCancel,
  onSubmit,
  onTabPrev,
  onTabNext,
  onRespondToClaude,
  onFinishPlanInterview,
  onImagePaste,
  pastedContents,
  onRemoveImage,
}: Props) {
  const isInPlanMode = useAppState(s => s.toolPermissionContext.mode) === "plan";
  const [isFooterFocused, setIsFooterFocused] = useState(false);
  const [footerIndex, setFooterIndex] = useState(0);
  const [isOtherFocused, setIsOtherFocused] = useState(false);

  const editor = getExternalEditor();
  const editorName = editor ? toIDEDisplayName(editor) : null;

  const handleFocus = (value: string) => {
    const isOther = value === "__other__";
    setIsOtherFocused(isOther);
    onTextInputFocus(isOther);
  };

  const handleDownFromLastItem = () => {
    setFooterIndex(0);
    setIsFooterFocused(true);
  };

  const handleUpFromFooter = () => {
    setIsFooterFocused(false);
  };

  useInput(
    (input, key, event) => {
      if (!isFooterFocused) {
        return;
      }

      if (key.upArrow || (key.ctrl && input === 'p')) {
        event.stopImmediatePropagation();
        if (footerIndex === 0) {
          handleUpFromFooter();
        } else {
          setFooterIndex(0);
        }
        return;
      }

      if (key.downArrow || (key.ctrl && input === 'n')) {
        event.stopImmediatePropagation();
        if (isInPlanMode && footerIndex === 0) {
          setFooterIndex(1);
        }
        return;
      }

      if (key.return) {
        event.stopImmediatePropagation();
        if (footerIndex === 0) {
          onRespondToClaude();
        } else {
          onFinishPlanInterview();
        }
        return;
      }

      if (key.escape) {
        event.stopImmediatePropagation();
        onCancel();
      }
    },
    { isActive: isFooterFocused },
  );

  const textOptions = question.options.map(opt => ({
    type: "text" as const,
    value: opt.label,
    label: opt.label,
    description: opt.description,
  }));
  const questionText = question.question;
  const questionState = questionStates[questionText];

  const handleOpenEditor = async (currentValue: string, setValue: (value: string) => void) => {
    const result = await editPromptInEditor(currentValue);
    if (result.content !== null && result.content !== currentValue) {
      setValue(result.content);
      onUpdateQuestionState(questionText, {
        textInputValue: result.content
      }, question.multiSelect ?? false);
    }
  };

  const otherOption = {
    type: "input" as const,
    value: "__other__",
    label: "Other",
    placeholder: question.multiSelect ? "Type something" : "Type something.",
    initialValue: questionState?.textInputValue ?? "",
    onChange: (value: string) => {
      onUpdateQuestionState(questionText, {
        textInputValue: value
      }, question.multiSelect ?? false);
    },
  };
  const options = [...textOptions, otherOption];

  const hasAnyPreview = !question.multiSelect && question.options.some(opt => opt.preview);
  if (hasAnyPreview) {
    return <PreviewQuestionView question={question} questions={questions} currentQuestionIndex={currentQuestionIndex} answers={answers} questionStates={questionStates} hideSubmitTab={hideSubmitTab} minContentHeight={minContentHeight} minContentWidth={minContentWidth} onUpdateQuestionState={onUpdateQuestionState} onAnswer={onAnswer} onTextInputFocus={onTextInputFocus} onCancel={onCancel} onTabPrev={onTabPrev} onTabNext={onTabNext} onRespondToClaude={onRespondToClaude} onFinishPlanInterview={onFinishPlanInterview} />;
  }

  return (
    <Box flexDirection="column" marginTop={0} tabIndex={0} autoFocus={true}>
      {isInPlanMode && planFilePath && <Box flexDirection="column" gap={0}><Divider color="inactive" /><Text color="inactive">Planning: <FilePathLink filePath={planFilePath} /></Text></Box>}
      <Box marginTop={-1}><Divider color="inactive" /></Box>
      <Box flexDirection="column" paddingTop={0}>
        <QuestionNavigationBar questions={questions} currentQuestionIndex={currentQuestionIndex} answers={answers} hideSubmitTab={hideSubmitTab} />
        <PermissionRequestTitle title={question.question} color="text" />
        <Box flexDirection="column" minHeight={minContentHeight}>
          <Box marginTop={1}>{question.multiSelect ? <SelectMulti key={question.question} options={options} defaultValue={questionStates[question.question]?.selectedValue as string[] | undefined} onChange={values => {
            onUpdateQuestionState(questionText, {
              selectedValue: values
            }, true);
            const textInput = values.includes("__other__") ? questionStates[questionText]?.textInputValue : undefined;
            const finalValues = values.filter(v => v !== "__other__").concat(textInput ? [textInput] : []);
            onAnswer(questionText, finalValues, undefined, false);
          }} onFocus={handleFocus} onCancel={onCancel} submitButtonText={currentQuestionIndex === questions.length - 1 ? "Submit" : "Next"} onSubmit={onSubmit} onDownFromLastItem={handleDownFromLastItem} isDisabled={isFooterFocused} onOpenEditor={handleOpenEditor} onImagePaste={onImagePaste} pastedContents={pastedContents} onRemoveImage={onRemoveImage} /> : <Select key={question.question} options={options} defaultValue={questionStates[question.question]?.selectedValue as string | undefined} onChange={value => {
            onUpdateQuestionState(questionText, {
              selectedValue: value
            }, false);
            const textInput = value === "__other__" ? questionStates[questionText]?.textInputValue : undefined;
            onAnswer(questionText, value, textInput);
          }} onFocus={handleFocus} onCancel={onCancel} onDownFromLastItem={handleDownFromLastItem} isDisabled={isFooterFocused} layout="compact-vertical" onOpenEditor={handleOpenEditor} onImagePaste={onImagePaste} pastedContents={pastedContents} onRemoveImage={onRemoveImage} />}</Box>
          <Box flexDirection="column">
            <Divider color="inactive" />
            <Box flexDirection="row" gap={1}>
              {isFooterFocused && footerIndex === 0 ? <Text color="suggestion">{figures.pointer}</Text> : <Text> </Text>}
              <Text color={isFooterFocused && footerIndex === 0 ? "suggestion" : undefined}>{options.length + 1}. Chat about this</Text>
            </Box>
            {isInPlanMode && <Box flexDirection="row" gap={1}>{isFooterFocused && footerIndex === 1 ? <Text color="suggestion">{figures.pointer}</Text> : <Text> </Text>}<Text color={isFooterFocused && footerIndex === 1 ? "suggestion" : undefined}>{options.length + 2}. Skip interview and plan immediately</Text></Box>}
          </Box>
          <Box marginTop={1}><Text color="inactive" dimColor={true}>Enter to select ·{" "}{questions.length === 1 ? <>{figures.arrowUp}/{figures.arrowDown} to navigate</> : "Tab/Arrow keys to navigate"}{isOtherFocused && editorName && <> · ctrl+g to edit in {editorName}</>}{" "}· Esc to cancel</Text></Box>
        </Box>
      </Box>
    </Box>
  );
}
