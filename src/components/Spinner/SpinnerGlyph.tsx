import * as React from 'react';
import { Box, Text, useTheme } from '../../ink.js';
import { getTheme, type Theme } from '../../utils/theme.js';
import { getDefaultCharacters, interpolateColor, parseRGB, toRGBColor } from './utils.js';
const DEFAULT_CHARACTERS = getDefaultCharacters();
const SPINNER_FRAMES = [...DEFAULT_CHARACTERS];
const REDUCED_MOTION_DOT = '●';
const ERROR_RED = {
  r: 171,
  g: 43,
  b: 63
};
type Props = {
  frame: number;
  messageColor: keyof Theme;
  stalledIntensity?: number;
  reducedMotion?: boolean;
  time?: number;
};
export function SpinnerGlyph({
  frame,
  messageColor,
  stalledIntensity = 0,
  reducedMotion = false,
  time = 0
}: Props) {
  const [themeName] = useTheme();
  const theme = getTheme(themeName);
  if (reducedMotion) {
    // Deterministically still: `time` is frozen at mount under reduced-motion
    // (the parent passes a null clock), so the old time-derived pulse never
    // cycled — it just froze on whichever parity mount happened to hit. Render
    // one stable glyph at one weight instead of a fake/inconsistent dim.
    const isDim = false;
    return <Box flexWrap="wrap" height={1} width={2}><Text color={messageColor} dimColor={isDim}>{REDUCED_MOTION_DOT}</Text></Box>;
  }
  const spinnerChar = SPINNER_FRAMES[frame % SPINNER_FRAMES.length];
  if (stalledIntensity > 0) {
    const baseColorStr = theme[messageColor];
    const baseRGB = baseColorStr ? parseRGB(baseColorStr) : null;
    if (baseRGB) {
      const interpolated = interpolateColor(baseRGB, ERROR_RED, stalledIntensity);
      return <Box flexWrap="wrap" height={1} width={2}><Text color={toRGBColor(interpolated)}>{spinnerChar}</Text></Box>;
    }
    const color = stalledIntensity > 0.5 ? "error" : messageColor;
    return <Box flexWrap="wrap" height={1} width={2}><Text color={color}>{spinnerChar}</Text></Box>;
  }
  return <Box flexWrap="wrap" height={1} width={2}><Text color={messageColor}>{spinnerChar}</Text></Box>;
}
