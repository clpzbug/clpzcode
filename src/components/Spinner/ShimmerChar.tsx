import * as React from 'react';
import { Text } from '../../ink.js';
import type { Theme } from '../../utils/theme.js';
type Props = {
  char: string;
  index: number;
  glimmerIndex: number;
  messageColor: keyof Theme;
  shimmerColor: keyof Theme;
};
export function ShimmerChar({
  char,
  index,
  glimmerIndex,
  messageColor,
  shimmerColor
}: Props) {
  const isHighlighted = index === glimmerIndex;
  const isNearHighlight = Math.abs(index - glimmerIndex) === 1;
  const shouldUseShimmer = isHighlighted || isNearHighlight;
  const color = shouldUseShimmer ? shimmerColor : messageColor;
  return <Text color={color}>{char}</Text>;
}
