import figures from 'figures';
import React, { useMemo } from 'react';
import { useTerminalSize } from '../../../hooks/useTerminalSize.js';
import { stringWidth } from '../../../ink/stringWidth.js';
import { Box, Text } from '../../../ink.js';
import type { Question } from '../../../tools/AskUserQuestionTool/AskUserQuestionTool.js';
import { truncateToWidth } from '../../../utils/format.js';

type Props = {
  questions: Question[];
  currentQuestionIndex: number;
  answers: Record<string, string>;
  hideSubmitTab?: boolean;
};

export function QuestionNavigationBar({
  questions,
  currentQuestionIndex,
  answers,
  hideSubmitTab = false
}: Props) {
  const { columns } = useTerminalSize();

  const tabDisplayTexts = useMemo(() => {
    const submitText = hideSubmitTab ? "" : ` ${figures.tick} Submit `;
    const fixedWidth = stringWidth("← ") + stringWidth(" →") + stringWidth(submitText);
    const availableForTabs = columns - fixedWidth;
    if (availableForTabs <= 0) {
      return questions.map((q, index) => {
        const header = q?.header || `Q${index + 1}`;
        return index === currentQuestionIndex ? header.slice(0, 3) : "";
      });
    }
    const tabHeaders = questions.map((q, index) => q?.header || `Q${index + 1}`);
    const idealWidths = tabHeaders.map(header => 4 + stringWidth(header));
    const totalIdealWidth = idealWidths.reduce((sum, w) => sum + w, 0);
    if (totalIdealWidth <= availableForTabs) {
      return tabHeaders;
    }
    const currentHeader = tabHeaders[currentQuestionIndex] || "";
    const currentIdealWidth = 4 + stringWidth(currentHeader);
    const currentTabWidth = Math.min(currentIdealWidth, availableForTabs / 2);
    const remainingWidth = availableForTabs - currentTabWidth;
    const otherTabCount = questions.length - 1;
    const widthPerOtherTab = Math.max(6, Math.floor(remainingWidth / Math.max(otherTabCount, 1)));
    return tabHeaders.map((header, index) => {
      if (index === currentQuestionIndex) {
        const maxTextWidth = currentTabWidth - 2 - 2;
        return truncateToWidth(header, maxTextWidth);
      } else {
        const maxTextWidth = widthPerOtherTab - 2 - 2;
        return truncateToWidth(header, maxTextWidth);
      }
    });
  }, [columns, currentQuestionIndex, hideSubmitTab, questions]);

  const hideArrows = questions.length === 1 && hideSubmitTab;

  return (
    <Box flexDirection="row" marginBottom={1}>
      {!hideArrows && <Text color={currentQuestionIndex === 0 ? "inactive" : undefined}>←{" "}</Text>}
      {questions.map((q, index) => {
        const isSelected = index === currentQuestionIndex;
        const isAnswered = q?.question && !!answers[q.question];
        const checkbox = isAnswered ? figures.checkboxOn : figures.checkboxOff;
        const displayText = tabDisplayTexts[index] || q?.header || `Q${index + 1}`;
        return (
          <Box key={q?.question || `question-${index}`}>
            {isSelected ? (
              <Text backgroundColor="permission" color="inverseText">{" "}{checkbox} {displayText}{" "}</Text>
            ) : (
              <Text>{" "}{checkbox} {displayText}{" "}</Text>
            )}
          </Box>
        );
      })}
      {!hideSubmitTab && (
        <Box key="submit">
          {currentQuestionIndex === questions.length ? (
            <Text backgroundColor="permission" color="inverseText">{" "}{figures.tick} Submit{" "}</Text>
          ) : (
            <Text> {figures.tick} Submit </Text>
          )}
        </Box>
      )}
      {!hideArrows && <Text color={currentQuestionIndex === questions.length ? "inactive" : undefined}>{" "}→</Text>}
    </Box>
  );
}
