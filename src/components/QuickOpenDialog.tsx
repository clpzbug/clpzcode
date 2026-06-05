import * as path from 'path';
import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { useRegisterOverlay } from '../context/overlayContext.js';
import { generateFileSuggestions } from '../hooks/fileSuggestions.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { Text } from '../ink.js';
import { logEvent } from '../services/analytics/index.js';
import { getCwd } from '../utils/cwd.js';
import { openFileInExternalEditor } from '../utils/editor.js';
import { truncatePathMiddle, truncateToWidth } from '../utils/format.js';
import { highlightMatch } from '../utils/highlightMatch.js';
import { readFileInRange } from '../utils/readFileInRange.js';
import { FuzzyPicker } from './design-system/FuzzyPicker.js';
import { LoadingState } from './design-system/LoadingState.js';
type Props = {
  onDone: () => void;
  onInsert: (text: string) => void;
};
const VISIBLE_RESULTS = 8;
const PREVIEW_LINES = 20;

/**
 * Quick Open dialog (ctrl+shift+p / cmd+shift+p).
 * Fuzzy file finder with a syntax-highlighted preview of the focused file.
 */
export function QuickOpenDialog({ onDone, onInsert }: Props) {
  useRegisterOverlay("quick-open");
  const { columns, rows } = useTerminalSize();
  const visibleResults = Math.min(VISIBLE_RESULTS, Math.max(4, rows - 14));
  const [results, setResults] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [focusedPath, setFocusedPath] = useState<string | undefined>(undefined);
  const [preview, setPreview] = useState<{path: string; content: string} | null>(null);
  const queryGenRef = useRef(0);
  useEffect(() => () => {
    queryGenRef.current = queryGenRef.current + 1;
    return void queryGenRef.current;
  }, []);
  const previewOnRight = columns >= 120;
  const effectivePreviewLines = previewOnRight ? VISIBLE_RESULTS - 1 : PREVIEW_LINES;
  const handleQueryChange = (q: string) => {
    setQuery(q);
    const gen = queryGenRef.current = queryGenRef.current + 1;
    if (!q.trim()) {
      setResults([]);
      return;
    }
    generateFileSuggestions(q, true).then(items => {
      if (gen !== queryGenRef.current) {
        return;
      }
      const paths = items
        .filter(i => i.id.startsWith("file-"))
        .map(i => i.displayText)
        .filter(p => !p.endsWith(path.sep))
        .map(p => p.split(path.sep).join("/"));
      setResults(paths);
    }).catch(() => {});
  };
  useEffect(() => {
    if (!focusedPath) {
      setPreview(null);
      return;
    }
    const controller = new AbortController();
    const absolute = path.resolve(getCwd(), focusedPath);
    readFileInRange(absolute, 0, effectivePreviewLines, undefined, controller.signal).then(r => {
      if (controller.signal.aborted) {
        return;
      }
      setPreview({
        path: focusedPath,
        content: r.content
      });
    }).catch(() => {
      if (controller.signal.aborted) {
        return;
      }
      setPreview({
        path: focusedPath,
        content: "(preview unavailable)"
      });
    });
    return () => controller.abort();
  }, [focusedPath, effectivePreviewLines]);
  const maxPathWidth = previewOnRight ? Math.max(20, Math.floor((columns - 10) * 0.4)) : Math.max(20, columns - 8);
  const previewWidth = previewOnRight ? Math.max(40, columns - maxPathWidth - 14) : columns - 6;
  const handleOpen = (p: string) => {
    const opened = openFileInExternalEditor(path.resolve(getCwd(), p));
    logEvent("tengu_quick_open_select", {
      result_count: results.length,
      opened_editor: opened
    });
    onDone();
  };
  const handleInsert = (p: string, mention: boolean) => {
    onInsert(mention ? `@${p} ` : `${p} `);
    logEvent("tengu_quick_open_insert", {
      result_count: results.length,
      mention
    });
    onDone();
  };
  return <FuzzyPicker
    title="Quick Open"
    placeholder={"Type to search files…"}
    items={results}
    getKey={p => p}
    visibleCount={visibleResults}
    direction="up"
    previewPosition={previewOnRight ? "right" : "bottom"}
    onQueryChange={handleQueryChange}
    onFocus={setFocusedPath}
    onSelect={handleOpen}
    onTab={{
      action: "mention",
      handler: p => handleInsert(p, true)
    }}
    onShiftTab={{
      action: "insert path",
      handler: p => handleInsert(p, false)
    }}
    onCancel={onDone}
    emptyMessage={q => q ? "No matching files" : "Start typing to search…"}
    selectAction="open in editor"
    renderItem={(p, isFocused) => <Text color={isFocused ? "suggestion" : undefined}>{truncatePathMiddle(p, maxPathWidth)}</Text>}
    renderPreview={p => preview ? <><Text dimColor={true}>{truncatePathMiddle(p, previewWidth)}{preview.path !== p ? " \xB7 loading…" : ""}</Text>{preview.content.split("\n").map((line, i) => <Text key={i}>{highlightMatch(truncateToWidth(line, previewWidth), query)}</Text>)}</> : <LoadingState message={"Loading preview…"} dimColor={true} />}
  />;
}
