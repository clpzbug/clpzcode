import * as React from 'react';
import { Ansi, Box, Text, useAnimationFrame } from '../../ink.js';
import { segmentTextByHighlights, type TextHighlight } from '../../utils/textHighlighting.js';
import { ShimmerChar } from '../Spinner/ShimmerChar.js';
type Props = {
  text: string;
  highlights: TextHighlight[];
};
type LinePart = {
  text: string;
  highlight: TextHighlight | undefined;
  start: number;
};
export function HighlightedInput({ text, highlights }: Props) {
  const segments = segmentTextByHighlights(text, highlights);
  const lines: LinePart[][] = [[]];
  let pos = 0;
  for (const segment of segments) {
    const parts = segment.text.split("\n");
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) {
        lines.push([]);
        pos = pos + 1;
      }
      const part = parts[i];
      if (part.length > 0) {
        lines[lines.length - 1].push({
          text: part,
          highlight: segment.highlight,
          start: pos
        });
      }
      pos = pos + part.length;
    }
  }
  const hasShimmer = highlights.some((h) => h.shimmerColor);
  let sweepStart = 0;
  let cycleLength = 1;
  if (hasShimmer) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const h of highlights) {
      if (h.shimmerColor) {
        lo = Math.min(lo, h.start);
        hi = Math.max(hi, h.end);
      }
    }
    sweepStart = lo - 10;
    cycleLength = hi - lo + 20;
  }
  const [ref, time] = useAnimationFrame(hasShimmer ? 50 : null);
  const glimmerIndex = hasShimmer ? sweepStart + Math.floor(time / 50) % cycleLength : -100;
  const renderedLines = lines.map((lineParts, lineIndex) => <Box key={lineIndex}>{lineParts.length === 0 ? <Text> </Text> : lineParts.map((part, partIndex) => {
    const highlight = part.highlight;
    if (highlight?.shimmerColor && highlight.color) {
      const messageColor = highlight.color;
      const shimmerColor = highlight.shimmerColor;
      return <Text key={partIndex}>{part.text.split("").map((char, charIndex) => <ShimmerChar key={charIndex} char={char} index={part.start + charIndex} glimmerIndex={glimmerIndex} messageColor={messageColor} shimmerColor={shimmerColor} />)}</Text>;
    }
    return <Text key={partIndex} color={part.highlight?.color} dimColor={part.highlight?.dimColor} inverse={part.highlight?.inverse}><Ansi>{part.text}</Ansi></Text>;
  })}</Box>);
  return <Box ref={ref} flexDirection="column">{renderedLines}</Box>;
}
