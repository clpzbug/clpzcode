import figures from 'figures';
import React, { useCallback, useState } from 'react';
import { Dialog } from '../../components/design-system/Dialog.js';
import { stringWidth } from '../../ink/stringWidth.js';
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- raw text input for config dialog
import { Box, Text, useInput } from '../../ink.js';
import { useKeybinding, useKeybindings } from '../../keybindings/useKeybinding.js';
import { isEnvTruthy } from '../../utils/envUtils.js';
import type { PluginOptionSchema, PluginOptionValues } from '../../utils/plugins/pluginOptionsStorage.js';

/**
 * Build the onSave payload from collected string inputs.
 *
 * Sensitive fields are never prepopulated in the text buffer (security), so
 * by the time the user reaches the last field every sensitive field they
 * stepped through contains '' in collected. To avoid silently wiping saved
 * secrets on reconfigure: if a sensitive field is '' AND initialValues has
 * a value for it, OMIT the key entirely. savePluginOptions only writes keys
 * it receives, so omitting = keep existing.
 *
 * Exported for unit testing.
 */
export function buildFinalValues(fields: string[], collected: Record<string, string>, configSchema: PluginOptionSchema, initialValues: PluginOptionValues | undefined): PluginOptionValues {
  const finalValues: PluginOptionValues = {};
  for (const fieldKey of fields) {
    const schema = configSchema[fieldKey];
    const value = collected[fieldKey] ?? '';
    if (schema?.sensitive === true && value === '' && initialValues?.[fieldKey] !== undefined) {
      continue;
    }
    if (schema?.type === 'number') {
      // Number('') returns 0, not NaN — omit blank number inputs so
      // validateUserConfig's required check actually catches them.
      if (value.trim() === '') continue;
      const num = Number(value);
      finalValues[fieldKey] = Number.isNaN(num) ? value : num;
    } else if (schema?.type === 'boolean') {
      finalValues[fieldKey] = isEnvTruthy(value);
    } else {
      finalValues[fieldKey] = value;
    }
  }
  return finalValues;
}
type Props = {
  title: string;
  subtitle: string;
  configSchema: PluginOptionSchema;
  /** Pre-fill fields when reconfiguring. Sensitive fields are not prepopulated. */
  initialValues?: PluginOptionValues;
  onSave: (config: PluginOptionValues) => void;
  onCancel: () => void;
};
export function PluginOptionsDialog({ title, subtitle, configSchema, initialValues, onSave, onCancel }: Props) {
  const fields = Object.keys(configSchema);
  const initialFor = useCallback((key: string) => {
    if (configSchema[key]?.sensitive === true) {
      return "";
    }
    const v = initialValues?.[key];
    return v === undefined ? "" : String(v);
  }, [configSchema, initialValues]);
  const [currentFieldIndex, setCurrentFieldIndex] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [currentInput, setCurrentInput] = useState(() => fields[0] ? initialFor(fields[0]) : "");
  const currentField = fields[currentFieldIndex];
  const fieldSchema = currentField ? configSchema[currentField] : null;
  useKeybinding("confirm:no", onCancel, { context: "Settings" });
  const handleNextField = useCallback(() => {
    if (currentFieldIndex < fields.length - 1 && currentField) {
      setValues(prev => ({
        ...prev,
        [currentField]: currentInput
      }));
      setCurrentFieldIndex(prev => prev + 1);
      const nextKey = fields[currentFieldIndex + 1];
      setCurrentInput(nextKey ? initialFor(nextKey) : "");
    }
  }, [currentField, currentFieldIndex, currentInput, fields, initialFor]);
  const handleConfirm = useCallback(() => {
    if (!currentField) {
      return;
    }
    const newValues = {
      ...values,
      [currentField]: currentInput
    };
    if (currentFieldIndex === fields.length - 1) {
      onSave(buildFinalValues(fields, newValues, configSchema, initialValues));
    } else {
      setValues(newValues);
      setCurrentFieldIndex(prev => prev + 1);
      const nextKey = fields[currentFieldIndex + 1];
      setCurrentInput(nextKey ? initialFor(nextKey) : "");
    }
  }, [configSchema, currentField, currentFieldIndex, currentInput, fields, initialFor, initialValues, onSave, values]);
  useKeybindings({
    "confirm:nextField": handleNextField,
    "confirm:yes": handleConfirm
  }, { context: "Confirmation" });
  useInput((char, key) => {
    if (key.backspace || key.delete) {
      setCurrentInput(prev => prev.slice(0, -1));
      return;
    }
    if (char && !key.ctrl && !key.meta && !key.tab && !key.return) {
      setCurrentInput(prev => prev + char);
    }
  });
  if (!fieldSchema || !currentField) {
    return null;
  }
  const isSensitive = fieldSchema.sensitive === true;
  const isRequired = fieldSchema.required === true;
  const displayValue = isSensitive ? "*".repeat(stringWidth(currentInput)) : currentInput;
  return (
    <Dialog title={title} subtitle={subtitle} onCancel={onCancel} isCancelActive={false}>
      <Box flexDirection="column">
        <Text bold={true}>{fieldSchema.title || currentField}{isRequired && <Text color="error"> *</Text>}</Text>
        {fieldSchema.description && <Text dimColor={true}>{fieldSchema.description}</Text>}
        <Box marginTop={1}>
          <Text>{figures.pointerSmall} </Text>
          <Text>{displayValue}</Text>
          <Text>█</Text>
        </Box>
      </Box>
      <Box flexDirection="column">
        <Text dimColor={true}>Field {currentFieldIndex + 1} of {fields.length}</Text>
        {currentFieldIndex < fields.length - 1 && <Text dimColor={true}>Tab: Next field · Enter: Save and continue</Text>}
        {currentFieldIndex === fields.length - 1 && <Text dimColor={true}>Enter: Save configuration</Text>}
      </Box>
    </Dialog>
  );
}
