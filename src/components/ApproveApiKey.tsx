import { Text } from '../ink.js';
import { saveGlobalConfig } from '../utils/config.js';
import { Select } from './CustomSelect/index.js';
import { Dialog } from './design-system/Dialog.js';
type Props = {
  customApiKeyTruncated: string;
  onDone(approved: boolean): void;
};
export function ApproveApiKey({ customApiKeyTruncated, onDone }: Props) {
  function onChange(value: 'yes' | 'no') {
    switch (value) {
      case "yes":
        {
          saveGlobalConfig(current => ({
            ...current,
            customApiKeyResponses: {
              ...current.customApiKeyResponses,
              approved: [...(current.customApiKeyResponses?.approved ?? []), customApiKeyTruncated]
            }
          }));
          onDone(true);
          break;
        }
      case "no":
        {
          saveGlobalConfig(current => ({
            ...current,
            customApiKeyResponses: {
              ...current.customApiKeyResponses,
              rejected: [...(current.customApiKeyResponses?.rejected ?? []), customApiKeyTruncated]
            }
          }));
          onDone(false);
        }
    }
  }
  return (
    <Dialog title="Detected a custom API key in your environment" color="warning" onCancel={() => onChange("no")}>
      <Text><Text bold={true}>ANTHROPIC_API_KEY</Text><Text>: sk-ant-...{customApiKeyTruncated}</Text></Text>
      <Text>Do you want to use this API key?</Text>
      <Select
        defaultValue="no"
        defaultFocusValue="no"
        options={[{
          label: "Yes",
          value: "yes"
        }, {
          label: <Text>No (<Text bold={true}>recommended</Text>)</Text>,
          value: "no"
        }]}
        onChange={(value: string) => onChange(value as 'yes' | 'no')}
        onCancel={() => onChange("no")}
      />
    </Dialog>
  );
}
