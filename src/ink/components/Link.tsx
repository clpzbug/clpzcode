import type { ReactNode } from 'react';
import React from 'react';
import { supportsHyperlinks } from '../supports-hyperlinks.js';
import Text from './Text.js';
export type Props = {
  readonly children?: ReactNode;
  readonly url: string;
  readonly fallback?: ReactNode;
};
export default function Link({ children, url, fallback }: Props) {
  const content = children ?? url;
  if (supportsHyperlinks()) {
    return <Text><ink-link href={url}>{content}</ink-link></Text>;
  }
  const fallbackContent = fallback ?? content;
  return <Text>{fallbackContent}</Text>;
}
