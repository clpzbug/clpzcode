import { PRODUCT_DISPLAY_NAME } from '../constants/product.js';
import { Text } from '../ink.js';

export function InterruptedByUser() {
  return (
    <>
      <Text dimColor={true}>Interrupted </Text>
      {false ? (
        <Text dimColor={true}>· [internal] /issue to report a model issue</Text>
      ) : (
        <Text dimColor={true}>· What should {PRODUCT_DISPLAY_NAME} do instead?</Text>
      )}
    </>
  );
}
