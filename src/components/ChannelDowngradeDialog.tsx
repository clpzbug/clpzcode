import { Text } from '../ink.js';
import { Select } from './CustomSelect/index.js';
import { Dialog } from './design-system/Dialog.js';
export type ChannelDowngradeChoice = 'downgrade' | 'stay' | 'cancel';
type Props = {
  currentVersion: string;
  onChoice: (choice: ChannelDowngradeChoice) => void;
};

/**
 * Dialog shown when switching from latest to stable channel.
 * Allows user to choose whether to downgrade or stay on current version.
 */
export function ChannelDowngradeDialog({ currentVersion, onChoice }: Props) {
  function handleSelect(value: ChannelDowngradeChoice) {
    onChoice(value);
  }

  function handleCancel() {
    onChoice("cancel");
  }

  const options = [
    {
      label: "Allow possible downgrade to stable version",
      value: "downgrade" as ChannelDowngradeChoice
    },
    {
      label: `Stay on current version (${currentVersion}) until stable catches up`,
      value: "stay" as ChannelDowngradeChoice
    }
  ];

  return (
    <Dialog title="Switch to Stable Channel" onCancel={handleCancel} color="permission" hideBorder={true} hideInputGuide={true}>
      <Text>The stable channel may have an older version than what you're currently running ({currentVersion}).</Text>
      <Text dimColor={true}>How would you like to handle this?</Text>
      <Select options={options} onChange={handleSelect} />
    </Dialog>
  );
}
