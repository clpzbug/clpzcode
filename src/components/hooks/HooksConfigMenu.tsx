/**
 * HooksConfigMenu is a read-only browser for configured hooks.
 *
 * Users can drill into each hook event, see configured matchers and hooks
 * (of any type: command, prompt, agent, http), and view individual hook
 * details. To add or modify hooks, users should edit settings.json directly
 * or ask Claude — the menu directs them there.
 *
 * The menu is read-only because the old editing UI only supported
 * command-type hooks and duplicating the settings.json editing surface
 * in-menu for all four types would be a maintenance burden.
 */
import * as React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { PRODUCT_DISPLAY_NAME } from '../../constants/product.js';
import type { HookEvent } from 'src/entrypoints/agentSdkTypes.js';
import { useAppState, useAppStateStore } from 'src/state/AppState.js';
import type { CommandResultDisplay } from '../../commands.js';
import { useSettingsChange } from '../../hooks/useSettingsChange.js';
import { Box, Text } from '../../ink.js';
import { useKeybinding } from '../../keybindings/useKeybinding.js';
import { getHookEventMetadata, getHooksForMatcher, getMatcherMetadata, getSortedMatchersForEvent, groupHooksByEventAndMatcher } from '../../utils/hooks/hooksConfigManager.js';
import type { IndividualHookConfig } from '../../utils/hooks/hooksSettings.js';
import { getSettings_DEPRECATED, getSettingsForSource } from '../../utils/settings/settings.js';
import { plural } from '../../utils/stringUtils.js';
import { Dialog } from '../design-system/Dialog.js';
import { SelectEventMode } from './SelectEventMode.js';
import { SelectHookMode } from './SelectHookMode.js';
import { SelectMatcherMode } from './SelectMatcherMode.js';
import { ViewHookMode } from './ViewHookMode.js';
type Props = {
  toolNames: string[];
  onExit: (result?: string, options?: {
    display?: CommandResultDisplay;
  }) => void;
};
type ModeState = {
  mode: 'select-event';
} | {
  mode: 'select-matcher';
  event: HookEvent;
} | {
  mode: 'select-hook';
  event: HookEvent;
  matcher: string;
} | {
  mode: 'view-hook';
  event: HookEvent;
  hook: IndividualHookConfig;
};
export function HooksConfigMenu({ toolNames, onExit }: Props) {
  const [modeState, setModeState] = useState<ModeState>({
    mode: 'select-event'
  });
  const [disabledByPolicy, setDisabledByPolicy] = useState(() => {
    const settings = getSettings_DEPRECATED();
    const hooksDisabled = settings?.disableAllHooks === true;
    return hooksDisabled && getSettingsForSource('policySettings')?.disableAllHooks === true;
  });
  const [restrictedByPolicy, setRestrictedByPolicy] = useState(() => getSettingsForSource('policySettings')?.allowManagedHooksOnly === true);
  useSettingsChange(source => {
    if (source === 'policySettings') {
      const settings = getSettings_DEPRECATED();
      const hooksDisabled = settings?.disableAllHooks === true;
      setDisabledByPolicy(hooksDisabled && getSettingsForSource('policySettings')?.disableAllHooks === true);
      setRestrictedByPolicy(getSettingsForSource('policySettings')?.allowManagedHooksOnly === true);
    }
  });
  const mode = modeState.mode;
  const selectedEvent = 'event' in modeState ? modeState.event : 'PreToolUse';
  const selectedMatcher = 'matcher' in modeState ? modeState.matcher : null;
  const mcp = useAppState(s => s.mcp);
  const appStateStore = useAppStateStore();
  const combinedToolNames = useMemo(() => [...toolNames, ...mcp.tools.map(tool => tool.name)], [mcp.tools, toolNames]);
  const hooksByEventAndMatcher = useMemo(() => groupHooksByEventAndMatcher(appStateStore.getState(), combinedToolNames), [appStateStore, combinedToolNames]);
  const sortedMatchersForSelectedEvent = useMemo(() => getSortedMatchersForEvent(hooksByEventAndMatcher, selectedEvent), [hooksByEventAndMatcher, selectedEvent]);
  const hooksForSelectedMatcher = useMemo(() => getHooksForMatcher(hooksByEventAndMatcher, selectedEvent, selectedMatcher), [hooksByEventAndMatcher, selectedEvent, selectedMatcher]);
  const handleExit = useCallback(() => {
    onExit('Hooks dialog dismissed', {
      display: 'system'
    });
  }, [onExit]);
  useKeybinding('confirm:no', handleExit, {
    context: 'Confirmation',
    isActive: mode === 'select-event'
  });
  useKeybinding('confirm:no', () => {
    setModeState({
      mode: 'select-event'
    });
  }, {
    context: 'Confirmation',
    isActive: mode === 'select-matcher'
  });
  useKeybinding('confirm:no', () => {
    if ('event' in modeState) {
      if (getMatcherMetadata(modeState.event, combinedToolNames) !== undefined) {
        setModeState({
          mode: 'select-matcher',
          event: modeState.event
        });
      } else {
        setModeState({
          mode: 'select-event'
        });
      }
    }
  }, {
    context: 'Confirmation',
    isActive: mode === 'select-hook'
  });
  useKeybinding('confirm:no', () => {
    if (modeState.mode === 'view-hook') {
      const { event, hook } = modeState;
      setModeState({
        mode: 'select-hook',
        event,
        matcher: hook.matcher || ''
      });
    }
  }, {
    context: 'Confirmation',
    isActive: mode === 'view-hook'
  });
  const hookEventMetadata = useMemo(() => getHookEventMetadata(combinedToolNames), [combinedToolNames]);
  const settings = getSettings_DEPRECATED();
  const hooksDisabled = settings?.disableAllHooks === true;
  const { hooksByEvent, totalHooksCount } = useMemo(() => {
    const byEvent: Partial<Record<HookEvent, number>> = {};
    let total = 0;
    for (const [event, matchers] of Object.entries(hooksByEventAndMatcher)) {
      const eventCount = Object.values(matchers as any).reduce((sum: number, hooks: any) => sum + hooks.length, 0) as number;
      byEvent[event as HookEvent] = eventCount;
      total += eventCount;
    }
    return {
      hooksByEvent: byEvent,
      totalHooksCount: total
    };
  }, [hooksByEventAndMatcher]);
  if (hooksDisabled) {
    return <Dialog title="Hook Configuration - Disabled" onCancel={handleExit} inputGuide={() => <Text>Esc to close</Text>}>
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="column">
            <Text>All hooks are currently <Text bold={true}>disabled</Text>{disabledByPolicy && ' by a managed settings file'}. You have{' '}<Text bold={true}>{totalHooksCount}</Text> configured{' '}{plural(totalHooksCount, 'hook')} that{' '}{plural(totalHooksCount, 'is', 'are')} not running.</Text>
            <Box marginTop={1}><Text dimColor={true}>When hooks are disabled:</Text></Box>
            <Text dimColor={true}>· No hook commands will execute</Text>
            <Text dimColor={true}>· StatusLine will not be displayed</Text>
            <Text dimColor={true}>· Tool operations will proceed without hook validation</Text>
          </Box>
          {!disabledByPolicy && <Text dimColor={true}>To re-enable hooks, remove "disableAllHooks" from settings.json or ask {PRODUCT_DISPLAY_NAME}.</Text>}
        </Box>
      </Dialog>;
  }
  switch (modeState.mode) {
    case 'select-event':
      {
        return <SelectEventMode hookEventMetadata={hookEventMetadata} hooksByEvent={hooksByEvent} totalHooksCount={totalHooksCount} restrictedByPolicy={restrictedByPolicy} onSelectEvent={event => {
          if (getMatcherMetadata(event, combinedToolNames) !== undefined) {
            setModeState({
              mode: 'select-matcher',
              event
            });
          } else {
            setModeState({
              mode: 'select-hook',
              event,
              matcher: ''
            });
          }
        }} onCancel={handleExit} />;
      }
    case 'select-matcher':
      {
        const eventMetadata = hookEventMetadata[modeState.event];
        return <SelectMatcherMode selectedEvent={modeState.event} matchersForSelectedEvent={sortedMatchersForSelectedEvent} hooksByEventAndMatcher={hooksByEventAndMatcher} eventDescription={eventMetadata.description} onSelect={matcher => {
          setModeState({
            mode: 'select-hook',
            event: modeState.event,
            matcher
          });
        }} onCancel={() => {
          setModeState({
            mode: 'select-event'
          });
        }} />;
      }
    case 'select-hook':
      {
        const eventMetadata = hookEventMetadata[modeState.event];
        return <SelectHookMode selectedEvent={modeState.event} selectedMatcher={modeState.matcher} hooksForSelectedMatcher={hooksForSelectedMatcher} hookEventMetadata={eventMetadata} onSelect={hook => {
          setModeState({
            mode: 'view-hook',
            event: modeState.event,
            hook
          });
        }} onCancel={() => {
          if (getMatcherMetadata(modeState.event, combinedToolNames) !== undefined) {
            setModeState({
              mode: 'select-matcher',
              event: modeState.event
            });
          } else {
            setModeState({
              mode: 'select-event'
            });
          }
        }} />;
      }
    case 'view-hook':
      {
        const selectedHook = modeState.hook;
        const eventSupportsMatcher = getMatcherMetadata(modeState.event, combinedToolNames) !== undefined;
        return <ViewHookMode selectedHook={selectedHook} eventSupportsMatcher={eventSupportsMatcher} onCancel={() => {
          const { event, hook } = modeState;
          setModeState({
            mode: 'select-hook',
            event,
            matcher: hook.matcher || ''
          });
        }} />;
      }
  }
}
