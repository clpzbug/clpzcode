import * as React from 'react';
import { memo, useEffect, useRef, useState } from 'react';
import { useSettings } from '../hooks/useSettings.js';
import { Ansi, Box, type DOMElement, measureElement, NoSelect, Text, useTheme } from '../ink.js';
import { isFullscreenEnvEnabled } from '../utils/fullscreen.js';
import sliceAnsi from '../utils/sliceAnsi.js';
import { countCharInString } from '../utils/stringUtils.js';
import { HighlightedCodeFallback } from './HighlightedCode/Fallback.js';
import { expectColorFile } from './StructuredDiff/colorDiff.js';
type Props = {
  code: string;
  filePath: string;
  width?: number;
  dim?: boolean;
};
const DEFAULT_WIDTH = 80;
export const HighlightedCode = memo(function HighlightedCode({ code, filePath, width, dim = false }: Props) {
  const ref = useRef<DOMElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState(width || DEFAULT_WIDTH);
  const [theme] = useTheme();
  const settings = useSettings();
  const syntaxHighlightingDisabled = settings.syntaxHighlightingDisabled ?? false;

  let colorFile: InstanceType<NonNullable<ReturnType<typeof expectColorFile>>> | null = null;
  if (!syntaxHighlightingDisabled) {
    const ColorFile = expectColorFile();
    if (ColorFile) {
      colorFile = new ColorFile(code, filePath);
    }
  }

  useEffect(() => {
    if (!width && ref.current) {
      const { width: elementWidth } = measureElement(ref.current);
      if (elementWidth > 0) {
        setMeasuredWidth(elementWidth - 2);
      }
    }
  }, [width]);

  const lines = colorFile === null ? null : colorFile.render(theme, measuredWidth, dim);

  let gutterWidth = 0;
  if (isFullscreenEnvEnabled()) {
    const lineCount = countCharInString(code, '\n') + 1;
    gutterWidth = lineCount.toString().length + 2;
  }

  return <Box ref={ref}>{lines ? <Box flexDirection="column">{lines.map((line, i) => gutterWidth > 0 ? <CodeLine key={i} line={line} gutterWidth={gutterWidth} /> : <Text key={i}><Ansi>{line}</Ansi></Text>)}</Box> : <HighlightedCodeFallback code={code} filePath={filePath} dim={dim} skipColoring={syntaxHighlightingDisabled} />}</Box>;
});
function CodeLine({ line, gutterWidth }: { line: string; gutterWidth: number }) {
  const gutter = sliceAnsi(line, 0, gutterWidth);
  const content = sliceAnsi(line, gutterWidth);
  return <Box flexDirection="row"><NoSelect fromLeftEdge={true}><Text><Ansi>{gutter}</Ansi></Text></NoSelect><Text><Ansi>{content}</Ansi></Text></Box>;
}
