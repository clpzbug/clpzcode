import * as React from 'react';
import { PRODUCT_DISPLAY_NAME } from 'src/constants/product.js';
import { Box, Text } from 'src/ink.js';
import { type NetworkHostPattern, shouldAllowManagedSandboxDomainsOnly } from 'src/utils/sandbox/sandbox-adapter.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from '../../services/analytics/index.js';
import { Select } from '../CustomSelect/select.js';
import { PermissionDialog } from './PermissionDialog.js';
export type SandboxPermissionRequestProps = {
  hostPattern: NetworkHostPattern;
  onUserResponse: (response: {
    allow: boolean;
    persistToSettings: boolean;
  }) => void;
};
export function SandboxPermissionRequest({
  hostPattern,
  onUserResponse
}: SandboxPermissionRequestProps) {
  const {
    host
  } = hostPattern;
  function onSelect(value: string) {
    switch (value) {
      case "yes":
        {
          onUserResponse({
            allow: true,
            persistToSettings: false
          });
          break;
        }
      case "yes-dont-ask-again":
        {
          onUserResponse({
            allow: true,
            persistToSettings: true
          });
          break;
        }
      case "no":
        {
          onUserResponse({
            allow: false,
            persistToSettings: false
          });
        }
    }
  }
  const managedDomainsOnly = shouldAllowManagedSandboxDomainsOnly();
  const options = [{
    label: "Yes",
    value: "yes"
  }, ...(!managedDomainsOnly ? [{
    label: <Text>Yes, and don't ask again for <Text bold={true}>{host}</Text></Text>,
    value: "yes-dont-ask-again"
  }] : []), {
    label: <Text>No, and tell {PRODUCT_DISPLAY_NAME} what to do differently <Text bold={true}>(esc)</Text></Text>,
    value: "no"
  }];
  return <PermissionDialog title="Network request outside of sandbox"><Box flexDirection="column" paddingX={2} paddingY={1}><Box><Text dimColor={true}>Host:</Text><Text> {host}</Text></Box><Box marginTop={1}><Text>Do you want to allow this connection?</Text></Box><Box><Select options={options} onChange={onSelect} onCancel={() => {
    onUserResponse({
      allow: false,
      persistToSettings: false
    });
  }} /></Box></Box></PermissionDialog>;
}
