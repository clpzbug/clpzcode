import figures from 'figures';
import { Box, Text } from '../ink.js';
import type { ContextSuggestion } from '../utils/contextSuggestions.js';
import { formatTokens } from '../utils/format.js';
import { StatusIcon } from './design-system/StatusIcon.js';
type Props = {
  suggestions: ContextSuggestion[];
};
export function ContextSuggestions({ suggestions }: Props) {
  if (suggestions.length === 0) {
    return null;
  }
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold={true}>Suggestions</Text>
      {suggestions.map((suggestion, i) => (
        <Box key={i} flexDirection="column" marginTop={i === 0 ? 0 : 1}>
          <Box>
            <StatusIcon status={suggestion.severity} withSpace={true} />
            <Text bold={true}>{suggestion.title}</Text>
            {suggestion.savingsTokens ? <Text dimColor={true}>{" "}{figures.arrowRight} save ~{formatTokens(suggestion.savingsTokens)}</Text> : null}
          </Box>
          <Box marginLeft={2}><Text dimColor={true}>{suggestion.detail}</Text></Box>
        </Box>
      ))}
    </Box>
  );
}
