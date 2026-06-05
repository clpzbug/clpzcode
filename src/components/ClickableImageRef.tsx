import { pathToFileURL } from 'url';
import Link from '../ink/components/Link.js';
import { supportsHyperlinks } from '../ink/supports-hyperlinks.js';
import { Text } from '../ink.js';
import { getStoredImagePath } from '../utils/imageStore.js';
import type { Theme } from '../utils/theme.js';
type Props = {
  imageId: number;
  backgroundColor?: keyof Theme;
  isSelected?: boolean;
};

/**
 * Renders an image reference like [Image #1] as a clickable link.
 * When clicked, opens the stored image file in the default viewer.
 *
 * Falls back to styled text if:
 * - Terminal doesn't support hyperlinks
 * - Image file is not found in the store
 */
export function ClickableImageRef({ imageId, backgroundColor, isSelected = false }: Props) {
  const imagePath = getStoredImagePath(imageId);
  const displayText = `[Image #${imageId}]`;
  if (imagePath && supportsHyperlinks()) {
    const fileUrl = pathToFileURL(imagePath).href;
    const fallback = <Text backgroundColor={backgroundColor} inverse={isSelected}>{displayText}</Text>;
    return (
      <Link url={fileUrl} fallback={fallback}>
        <Text backgroundColor={backgroundColor} inverse={isSelected} bold={isSelected}>{displayText}</Text>
      </Link>
    );
  }
  return <Text backgroundColor={backgroundColor} inverse={isSelected}>{displayText}</Text>;
}
