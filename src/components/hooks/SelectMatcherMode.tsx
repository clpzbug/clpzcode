/**
 * SelectMatcherMode shows the configured matchers for a selected hook event.
 *
 * The /hooks menu is read-only: this view no longer offers "add new matcher"
 * and simply lets the user drill into each matcher to see its hooks.
 */
import * as React from 'react';
import { PRODUCT_DISPLAY_NAME } from '../../constants/product.js';
import type { HookEvent } from 'src/entrypoints/agentSdkTypes.js';
import { Box, Text } from '../../ink.js';
import { type HookSource, hookSourceInlineDisplayString, type IndividualHookConfig } from '../../utils/hooks/hooksSettings.js';
import { plural } from '../../utils/stringUtils.js';
import { Select } from '../CustomSelect/select.js';
import { Dialog } from '../design-system/Dialog.js';
type MatcherWithSource = {
  matcher: string;
  sources: HookSource[];
  hookCount: number;
};
type Props = {
  selectedEvent: HookEvent;
  matchersForSelectedEvent: string[];
  hooksByEventAndMatcher: Record<HookEvent, Record<string, IndividualHookConfig[]>>;
  eventDescription: string;
  onSelect: (matcher: string) => void;
  onCancel: () => void;
};
export function SelectMatcherMode({
  selectedEvent,
  matchersForSelectedEvent,
  hooksByEventAndMatcher,
  eventDescription,
  onSelect,
  onCancel
}: Props) {
  const matchersWithSources: MatcherWithSource[] = matchersForSelectedEvent.map(matcher => {
    const hooks = hooksByEventAndMatcher[selectedEvent]?.[matcher] || [];
    const sources = Array.from(new Set(hooks.map(_temp)));
    return {
      matcher,
      sources,
      hookCount: hooks.length
    };
  });
  const title = `${selectedEvent} - Matchers`;
  if (matchersForSelectedEvent.length === 0) {
    return (
      <Dialog title={title} subtitle={eventDescription} onCancel={onCancel} inputGuide={_temp2}>
        <Box flexDirection="column" gap={1}>
          <Text dimColor={true}>No hooks configured for this event.</Text>
          <Text dimColor={true}>To add hooks, edit settings.json directly or ask {PRODUCT_DISPLAY_NAME}.</Text>
        </Box>
      </Dialog>
    );
  }
  const options = matchersWithSources.map(_temp3);
  const onChange = (value: string) => {
    onSelect(value);
  };
  return (
    <Dialog title={title} subtitle={eventDescription} onCancel={onCancel}>
      <Box flexDirection="column">
        <Select options={options} onChange={onChange} onCancel={onCancel} />
      </Box>
    </Dialog>
  );
}
function _temp3(item: MatcherWithSource) {
  const sourceText = item.sources.map(hookSourceInlineDisplayString).join(", ");
  const matcherLabel = item.matcher || "(all)";
  return {
    label: `[${sourceText}] ${matcherLabel}`,
    value: item.matcher,
    description: `${item.hookCount} ${plural(item.hookCount, "hook")}`
  };
}
function _temp2() {
  return <Text>Esc to go back</Text>;
}
function _temp(h: IndividualHookConfig) {
  return h.source;
}
