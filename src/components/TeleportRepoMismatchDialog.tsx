import React, { useCallback, useState } from 'react';
import { Box, Text } from '../ink.js';
import { getDisplayPath } from '../utils/file.js';
import { removePathFromRepo, validateRepoAtPath } from '../utils/githubRepoPathMapping.js';
import { Select } from './CustomSelect/index.js';
import { Dialog } from './design-system/Dialog.js';
import { Spinner } from './Spinner.js';
type Props = {
  targetRepo: string;
  initialPaths: string[];
  onSelectPath: (path: string) => void;
  onCancel: () => void;
};
export function TeleportRepoMismatchDialog({
  targetRepo,
  initialPaths,
  onSelectPath,
  onCancel
}: Props) {
  const [availablePaths, setAvailablePaths] = useState(initialPaths);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const handleChange = useCallback(async (value: string) => {
    if (value === "cancel") {
      onCancel();
      return;
    }
    setValidating(true);
    setErrorMessage(null);
    const isValid = await validateRepoAtPath(value, targetRepo);
    if (isValid) {
      onSelectPath(value);
      return;
    }
    removePathFromRepo(targetRepo, value);
    const updatedPaths = availablePaths.filter(p => p !== value);
    setAvailablePaths(updatedPaths);
    setValidating(false);
    setErrorMessage(`${getDisplayPath(value)} no longer contains the correct repository. Select another path.`);
  }, [availablePaths, onCancel, onSelectPath, targetRepo]);
  const options = [...availablePaths.map(_temp), {
    label: "Cancel",
    value: "cancel"
  }];
  const content = availablePaths.length > 0 ? <><Box flexDirection="column" gap={1}>{errorMessage && <Text color="error">{errorMessage}</Text>}<Text>Open clpzcode in <Text bold={true}>{targetRepo}</Text>:</Text></Box>{validating ? <Box><Spinner /><Text> Validating repository…</Text></Box> : <Select options={options} onChange={value_0 => void handleChange(value_0)} />}</> : <Box flexDirection="column" gap={1}>{errorMessage && <Text color="error">{errorMessage}</Text>}<Text dimColor={true}>Run clpzcode --teleport from a checkout of {targetRepo}</Text></Box>;
  return <Dialog title="Teleport to Repo" onCancel={onCancel} color="background">{content}</Dialog>;
}
function _temp(path: string) {
  return {
    label: <Text>Use <Text bold={true}>{getDisplayPath(path)}</Text></Text>,
    value: path
  };
}
