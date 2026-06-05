import React from 'react';
import { Box, render, Text } from '../ink.js';
import { KeybindingSetup } from '../keybindings/KeybindingProviderSetup.js';
import { AppStateProvider } from '../state/AppState.js';
import type { ConfigParseError } from '../utils/errors.js';
import { getBaseRenderOptions } from '../utils/renderOptions.js';
import { jsonStringify, writeFileSync_DEPRECATED } from '../utils/slowOperations.js';
import type { ThemeName } from '../utils/theme.js';
import { Select } from './CustomSelect/index.js';
import { Dialog } from './design-system/Dialog.js';
interface InvalidConfigHandlerProps {
  error: ConfigParseError;
}
interface InvalidConfigDialogProps {
  filePath: string;
  errorDescription: string;
  onExit: () => void;
  onReset: () => void;
}

/**
 * Dialog shown when the Claude config file contains invalid JSON
 */
function InvalidConfigDialog({
  filePath,
  errorDescription,
  onExit,
  onReset
}: InvalidConfigDialogProps) {
  const handleSelect = (value: string) => {
    if (value === "exit") {
      onExit();
    } else {
      onReset();
    }
  };
  const options = [{
    label: "Exit and fix manually",
    value: "exit"
  }, {
    label: "Reset with default configuration",
    value: "reset"
  }];
  return (
    <Dialog title="Configuration Error" color="error" onCancel={onExit}>
      <Box flexDirection="column" gap={1}>
        <Text>The configuration file at <Text bold={true}>{filePath}</Text> contains invalid JSON.</Text>
        <Text>{errorDescription}</Text>
      </Box>
      <Box flexDirection="column">
        <Text bold={true}>Choose an option:</Text>
        <Select options={options} onChange={handleSelect} onCancel={onExit} />
      </Box>
    </Dialog>
  );
}

/**
 * Safe fallback theme name for error dialogs to avoid circular dependency.
 * Uses a hardcoded dark theme that doesn't require reading from config.
 */
const SAFE_ERROR_THEME_NAME: ThemeName = 'dark';
export async function showInvalidConfigDialog({
  error
}: InvalidConfigHandlerProps): Promise<void> {
  // Extend RenderOptions with theme property for this specific usage
  type SafeRenderOptions = Parameters<typeof render>[1] & {
    theme?: ThemeName;
  };
  const renderOptions: SafeRenderOptions = {
    ...getBaseRenderOptions(false),
    // IMPORTANT: Use hardcoded theme name to avoid circular dependency with getGlobalConfig()
    // This allows the error dialog to show even when config file has JSON syntax errors
    theme: SAFE_ERROR_THEME_NAME
  };
  // Deferred resolve (not `new Promise(async…)`): await render() directly so a
  // render() throw rejects to the caller instead of being swallowed and hanging.
  let resolve!: () => void;
  const done = new Promise<void>(r => {
    resolve = r;
  });
  const {
    unmount
  } = await render(<AppStateProvider>
      <KeybindingSetup>
        <InvalidConfigDialog filePath={error.filePath} errorDescription={error.message} onExit={() => {
        unmount();
        resolve();
        process.exit(1);
      }} onReset={() => {
        writeFileSync_DEPRECATED(error.filePath, jsonStringify(error.defaultConfig, null, 2), {
          flush: false,
          encoding: 'utf8'
        });
        unmount();
        resolve();
        process.exit(0);
      }} />
      </KeybindingSetup>
    </AppStateProvider>, renderOptions);
  await done;
}
