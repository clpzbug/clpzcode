import React from 'react';
import { renderPlaceholder } from '../hooks/renderPlaceholder.js';
import { usePasteHandler } from '../hooks/usePasteHandler.js';
import { useDeclaredCursor } from '../ink/hooks/use-declared-cursor.js';
import { Ansi, Box, Text, useInput } from '../ink.js';
import type { BaseInputState, BaseTextInputProps } from '../types/textInputTypes.js';
import type { TextHighlight } from '../utils/textHighlighting.js';
import { HighlightedInput } from './PromptInput/ShimmeredInput.js';
type BaseTextInputComponentProps = BaseTextInputProps & {
  inputState: BaseInputState;
  children?: React.ReactNode;
  terminalFocus: boolean;
  highlights?: TextHighlight[];
  invert?: (text: string) => string;
  hidePlaceholderText?: boolean;
};

/**
 * A base component for text inputs that handles rendering and basic input
 */
export function BaseTextInput({
  inputState,
  children,
  terminalFocus,
  invert,
  hidePlaceholderText,
  ...props
}: BaseTextInputComponentProps) {
  const {
    onInput,
    value,
    renderedValue,
    cursorLine,
    cursorColumn,
    offset,
  } = inputState;
  const cursorActive = Boolean(props.focus && props.showCursor && terminalFocus);
  const cursorRef = useDeclaredCursor({
    line: cursorLine,
    column: cursorColumn,
    active: cursorActive
  });
  const {
    wrappedOnInput,
    isPasting: isPastingValue
  } = usePasteHandler({
    onPaste: props.onPaste,
    onInput: (input, key) => {
      if (isPasting && key.return) {
        return;
      }
      onInput(input, key);
    },
    onImagePaste: props.onImagePaste
  });
  const isPasting = isPastingValue;
  const {
    onIsPastingChange
  } = props;
  React.useEffect(() => {
    if (onIsPastingChange) {
      onIsPastingChange(isPasting);
    }
  }, [isPasting, onIsPastingChange]);
  const {
    showPlaceholder,
    renderedPlaceholder
  } = renderPlaceholder({
    placeholder: props.placeholder,
    value,
    showCursor: props.showCursor,
    focus: props.focus,
    terminalFocus,
    invert,
    hidePlaceholderText
  });
  useInput(wrappedOnInput, {
    isActive: props.focus
  });
  const commandWithoutArgs = value && value.trim().indexOf(" ") === -1 || value && value.endsWith(" ");
  const showArgumentHint = Boolean(props.argumentHint && value && commandWithoutArgs && value.startsWith("/"));
  const cursorFiltered = props.showCursor && props.highlights ? props.highlights.filter(h => h.dimColor || offset < h.start || offset >= h.end) : props.highlights;
  const {
    viewportCharOffset,
    viewportCharEnd
  } = inputState;
  const filteredHighlights = cursorFiltered && viewportCharOffset > 0 ? cursorFiltered.filter(h_0 => h_0.end > viewportCharOffset && h_0.start < viewportCharEnd).map(h_1 => ({
    ...h_1,
    start: Math.max(0, h_1.start - viewportCharOffset),
    end: h_1.end - viewportCharOffset
  })) : cursorFiltered;
  const hasHighlights = filteredHighlights && filteredHighlights.length > 0;
  if (hasHighlights) {
    return <Box ref={cursorRef}><HighlightedInput text={renderedValue} highlights={filteredHighlights} />{showArgumentHint && <Text dimColor={true}>{value.endsWith(" ") ? "" : " "}{props.argumentHint}</Text>}{children}</Box>;
  }
  const content = showPlaceholder && props.placeholderElement ? props.placeholderElement : showPlaceholder && renderedPlaceholder ? <Ansi>{renderedPlaceholder}</Ansi> : <Ansi>{renderedValue}</Ansi>;
  const argumentHint = showArgumentHint && <Text dimColor={true}>{value.endsWith(" ") ? "" : " "}{props.argumentHint}</Text>;
  return <Box ref={cursorRef}><Text wrap="truncate-end" dimColor={props.dimColor}>{content}{argumentHint}{children}</Text></Box>;
}
