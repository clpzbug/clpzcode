import setWith from 'lodash-es/setWith.js';
import * as React from 'react';
import { Box, Text, useTheme } from '../ink.js';
import type { ValidationError } from '../utils/settings/validation.js';
import { type TreeNode, treeify } from '../utils/treeify.js';

/**
 * Builds a nested tree structure from dot-notation paths
 * Uses lodash setWith to avoid automatic array creation
 */
function buildNestedTree(errors: ValidationError[]): TreeNode {
  const tree: TreeNode = {};
  errors.forEach(error => {
    if (!error.path) {
      // Root level error - use empty string as key
      tree[''] = error.message;
      return;
    }

    // Try to enhance the path with meaningful values
    const pathParts = error.path.split('.');
    let modifiedPath = error.path;

    // If we have an invalid value, try to make the path more readable
    if (error.invalidValue !== null && error.invalidValue !== undefined && pathParts.length > 0) {
      const newPathParts: string[] = [];
      for (let i = 0; i < pathParts.length; i++) {
        const part = pathParts[i];
        if (!part) continue;
        const numericPart = parseInt(part, 10);

        // If this is a numeric index and it's the last part where we have the invalid value
        if (!isNaN(numericPart) && i === pathParts.length - 1) {
          // Format the value for display
          let displayValue: string;
          if (typeof error.invalidValue === 'string') {
            displayValue = `"${error.invalidValue}"`;
          } else if (error.invalidValue === null) {
            displayValue = 'null';
          } else if (error.invalidValue === undefined) {
            displayValue = 'undefined';
          } else {
            displayValue = String(error.invalidValue);
          }
          newPathParts.push(displayValue);
        } else {
          // Keep other parts as-is
          newPathParts.push(part);
        }
      }
      modifiedPath = newPathParts.join('.');
    }
    setWith(tree, modifiedPath, error.message, Object);
  });
  return tree;
}

type Props = {
  errors: ValidationError[];
};

/**
 * Groups and displays validation errors using treeify with deduplication
 */
export function ValidationErrorsList({ errors }: Props) {
  const [themeName] = useTheme();
  if (errors.length === 0) {
    return null;
  }
  const errorsByFile = errors.reduce(groupByFile, {} as Record<string, ValidationError[]>);
  const sortedFiles = Object.keys(errorsByFile).sort();
  const fileNodes = sortedFiles.map(file => {
    const fileErrors = errorsByFile[file] || [];
    fileErrors.sort(compareByPath);
    const errorTree = buildNestedTree(fileErrors);
    const suggestionPairs = new Map<string, { suggestion?: string; docLink?: string }>();
    fileErrors.forEach(error => {
      if (error.suggestion || error.docLink) {
        const key = `${error.suggestion || ""}|${error.docLink || ""}`;
        if (!suggestionPairs.has(key)) {
          suggestionPairs.set(key, {
            suggestion: error.suggestion,
            docLink: error.docLink
          });
        }
      }
    });
    const treeOutput = treeify(errorTree, {
      showValues: true,
      themeName,
      treeCharColors: {
        treeChar: "inactive",
        key: "text",
        value: "inactive"
      }
    });
    return <Box key={file} flexDirection="column"><Text>{file}</Text><Box marginLeft={1}><Text dimColor={true}>{treeOutput}</Text></Box>{suggestionPairs.size > 0 && <Box flexDirection="column" marginTop={1}>{Array.from(suggestionPairs.values()).map(renderSuggestionPair)}</Box>}</Box>;
  });
  return <Box flexDirection="column">{fileNodes}</Box>;
}

function renderSuggestionPair(pair: { suggestion?: string; docLink?: string }, index: number) {
  return <Box key={`suggestion-pair-${index}`} flexDirection="column" marginBottom={1}>{pair.suggestion && <Text dimColor={true} wrap="wrap">{pair.suggestion}</Text>}{pair.docLink && <Text dimColor={true} wrap="wrap">Learn more: {pair.docLink}</Text>}</Box>;
}

function compareByPath(a: ValidationError, b: ValidationError) {
  if (!a.path && b.path) {
    return -1;
  }
  if (a.path && !b.path) {
    return 1;
  }
  return (a.path || "").localeCompare(b.path || "");
}

function groupByFile(acc: Record<string, ValidationError[]>, error: ValidationError) {
  const file = error.file || "(file not specified)";
  if (!acc[file]) {
    acc[file] = [];
  }
  acc[file].push(error);
  return acc;
}
