import * as React from 'react';
import { stringWidth } from '../../ink/stringWidth.js';
import { Box, Text } from '../../ink.js';
import TextInput from '../TextInput.js';
type Props = {
  value: string;
  onChange: (value: string) => void;
  historyFailedMatch: boolean;
};
function HistorySearchInput({ value, onChange, historyFailedMatch }: Props) {
  const label = historyFailedMatch ? "no matching prompt:" : "search prompts:";
  return (
    <Box gap={1}>
      <Text dimColor={true}>{label}</Text>
      <TextInput value={value} onChange={onChange} cursorOffset={value.length} onChangeCursorOffset={_temp} columns={stringWidth(value) + 1} focus={true} showCursor={true} multiline={false} dimColor={true} />
    </Box>
  );
}
function _temp() {}
export default HistorySearchInput;
