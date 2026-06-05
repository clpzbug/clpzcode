import React, { useCallback } from 'react';
import { Text } from '../ink.js';
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js';
import { isSupportedTerminal } from '../utils/ide.js';
import { Select } from './CustomSelect/index.js';
import { Dialog } from './design-system/Dialog.js';
type IdeAutoConnectDialogProps = {
  onComplete: () => void;
};
export function IdeAutoConnectDialog({ onComplete }: IdeAutoConnectDialogProps) {
  const handleSelect = useCallback(async (value: string) => {
    const autoConnect = value === "yes";
    saveGlobalConfig(current => ({
      ...current,
      autoConnectIde: autoConnect,
      hasIdeAutoConnectDialogBeenShown: true
    }));
    onComplete();
  }, [onComplete]);
  const options = [{
    label: "Yes",
    value: "yes"
  }, {
    label: "No",
    value: "no"
  }];
  return (
    <Dialog title="Do you wish to enable auto-connect to IDE?" color="ide" onCancel={onComplete}>
      <Select options={options} onChange={handleSelect} defaultValue="yes" />
      <Text dimColor={true}>You can also configure this in /config or with the --ide flag</Text>
    </Dialog>
  );
}
export function shouldShowAutoConnectDialog(): boolean {
  const config = getGlobalConfig();
  return !isSupportedTerminal() && config.autoConnectIde !== true && config.hasIdeAutoConnectDialogBeenShown !== true;
}
type IdeDisableAutoConnectDialogProps = {
  onComplete: (disableAutoConnect: boolean) => void;
};
export function IdeDisableAutoConnectDialog({ onComplete }: IdeDisableAutoConnectDialogProps) {
  const handleSelect = useCallback((value: string) => {
    const disableAutoConnect = value === "yes";
    if (disableAutoConnect) {
      saveGlobalConfig(_temp);
    }
    onComplete(disableAutoConnect);
  }, [onComplete]);
  const handleCancel = useCallback(() => {
    onComplete(false);
  }, [onComplete]);
  const options = [{
    label: "No",
    value: "no"
  }, {
    label: "Yes",
    value: "yes"
  }];
  return (
    <Dialog title="Do you wish to disable auto-connect to IDE?" subtitle="You can also configure this in /config" onCancel={handleCancel} color="ide">
      <Select options={options} onChange={handleSelect} defaultValue="no" />
    </Dialog>
  );
}
function _temp(current) {
  return {
    ...current,
    autoConnectIde: false
  };
}
export function shouldShowDisableAutoConnectDialog(): boolean {
  const config = getGlobalConfig();
  return !isSupportedTerminal() && config.autoConnectIde === true;
}
