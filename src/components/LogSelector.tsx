import chalk from 'chalk';
import figures from 'figures';
import Fuse from 'fuse.js';
import React from 'react';
import { getOriginalCwd, getSessionId } from '../bootstrap/state.js';
import { useExitOnCtrlCDWithKeybindings } from '../hooks/useExitOnCtrlCDWithKeybindings.js';
import { useSearchInput } from '../hooks/useSearchInput.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { applyColor } from '../ink/colorize.js';
import type { Color } from '../ink/styles.js';
import { Box, Text, useInput, useTerminalFocus, useTheme } from '../ink.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { logEvent } from '../services/analytics/index.js';
import type { LogOption, SerializedMessage } from '../types/logs.js';
import { formatLogMetadata, truncateToWidth } from '../utils/format.js';
import { getWorktreePaths } from '../utils/getWorktreePaths.js';
import { getBranch } from '../utils/git.js';
import { getLogDisplayTitle } from '../utils/log.js';
import { getFirstMeaningfulUserMessageTextContent, getSessionIdFromLog, isCustomTitleEnabled, saveCustomTitle } from '../utils/sessionStorage.js';
import { getTheme } from '../utils/theme.js';
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js';
import { Select } from './CustomSelect/select.js';
import { Byline } from './design-system/Byline.js';
import { Divider } from './design-system/Divider.js';
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js';
import { SearchBox } from './SearchBox.js';
import { SessionPreview } from './SessionPreview.js';
import { Spinner } from './Spinner.js';
import { TagTabs } from './TagTabs.js';
import TextInput from './TextInput.js';
import { type TreeNode, TreeSelect } from './ui/TreeSelect.js';
type AgenticSearchState = {
  status: 'idle';
} | {
  status: 'searching';
} | {
  status: 'results';
  results: LogOption[];
  query: string;
} | {
  status: 'error';
  message: string;
};
export type LogSelectorProps = {
  logs: LogOption[];
  maxHeight?: number;
  forceWidth?: number;
  onCancel?: () => void;
  onSelect: (log: LogOption) => void;
  onLogsChanged?: () => void;
  onLoadMore?: (count: number) => void;
  initialSearchQuery?: string;
  showAllProjects?: boolean;
  onToggleAllProjects?: () => void;
  onAgenticSearch?: (query: string, logs: LogOption[], signal?: AbortSignal) => Promise<LogOption[]>;
};
type LogTreeNode = TreeNode<{
  log: LogOption;
  indexInFiltered: number;
}>;
function normalizeAndTruncateToWidth(text: string, maxWidth: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return truncateToWidth(normalized, maxWidth);
}

// Width of prefixes that TreeSelect will add
const PARENT_PREFIX_WIDTH = 2; // '▼ ' or '▶ '
const CHILD_PREFIX_WIDTH = 4; // '  ▸ '

// Deep search constants
const DEEP_SEARCH_MAX_MESSAGES = 2000;
const DEEP_SEARCH_CROP_SIZE = 1000;
const DEEP_SEARCH_MAX_TEXT_LENGTH = 50000; // Cap searchable text per session
const FUSE_THRESHOLD = 0.3;
const DATE_TIE_THRESHOLD_MS = 60 * 1000; // 1 minute - use relevance as tie-breaker within this window
const SNIPPET_CONTEXT_CHARS = 50; // Characters to show before/after match

type Snippet = {
  before: string;
  match: string;
  after: string;
};
function formatSnippet({
  before,
  match,
  after
}: Snippet, highlightColor: (text: string) => string): string {
  return chalk.dim(before) + highlightColor(match) + chalk.dim(after);
}
function extractSnippet(text: string, query: string, contextChars: number): Snippet | null {
  // Find exact query occurrence (case-insensitive).
  // Note: Fuse does fuzzy matching, so this may miss some fuzzy matches.
  // This is acceptable for now - in the future we could use Fuse's includeMatches
  // option and work with the match indices directly.
  const matchIndex = text.toLowerCase().indexOf(query.toLowerCase());
  if (matchIndex === -1) return null;
  const matchEnd = matchIndex + query.length;
  const snippetStart = Math.max(0, matchIndex - contextChars);
  const snippetEnd = Math.min(text.length, matchEnd + contextChars);
  const beforeRaw = text.slice(snippetStart, matchIndex);
  const matchText = text.slice(matchIndex, matchEnd);
  const afterRaw = text.slice(matchEnd, snippetEnd);
  return {
    before: (snippetStart > 0 ? '…' : '') + beforeRaw.replace(/\s+/g, ' ').trimStart(),
    match: matchText.trim(),
    after: afterRaw.replace(/\s+/g, ' ').trimEnd() + (snippetEnd < text.length ? '…' : '')
  };
}
function buildLogLabel(log: LogOption, maxLabelWidth: number, options?: {
  isGroupHeader?: boolean;
  isChild?: boolean;
  forkCount?: number;
}): string {
  const {
    isGroupHeader = false,
    isChild = false,
    forkCount = 0
  } = options || {};

  // TreeSelect will add the prefix, so we just need to account for its width
  const prefixWidth = isGroupHeader && forkCount > 0 ? PARENT_PREFIX_WIDTH : isChild ? CHILD_PREFIX_WIDTH : 0;
  const sessionCountSuffix = isGroupHeader && forkCount > 0 ? ` (+${forkCount} other ${forkCount === 1 ? 'session' : 'sessions'})` : '';
  const sidechainSuffix = log.isSidechain ? ' (sidechain)' : '';
  const maxSummaryWidth = maxLabelWidth - prefixWidth - sidechainSuffix.length - sessionCountSuffix.length;
  const truncatedSummary = normalizeAndTruncateToWidth(getLogDisplayTitle(log), maxSummaryWidth);
  return `${truncatedSummary}${sidechainSuffix}${sessionCountSuffix}`;
}
function buildLogMetadata(log: LogOption, options?: {
  isChild?: boolean;
  showProjectPath?: boolean;
}): string {
  const {
    isChild = false,
    showProjectPath = false
  } = options || {};
  // Match the child prefix width for proper alignment
  const childPadding = isChild ? '    ' : ''; // 4 spaces to match '  ▸ '
  const baseMetadata = formatLogMetadata(log);
  const projectSuffix = showProjectPath && log.projectPath ? ` · ${log.projectPath}` : '';
  return childPadding + baseMetadata + projectSuffix;
}
export function LogSelector({
  logs,
  maxHeight = Infinity,
  forceWidth,
  onCancel,
  onSelect,
  onLogsChanged,
  onLoadMore,
  initialSearchQuery,
  showAllProjects = false,
  onToggleAllProjects,
  onAgenticSearch
}: LogSelectorProps) {
  const terminalSize = useTerminalSize();
  const columns = forceWidth === undefined ? terminalSize.columns : forceWidth;
  const exitState = useExitOnCtrlCDWithKeybindings(onCancel);
  const isTerminalFocused = useTerminalFocus();
  const isResumeWithRenameEnabled = isCustomTitleEnabled();
  const isDeepSearchEnabled = false;
  const [themeName] = useTheme();
  const theme = getTheme(themeName);
  const highlightColor = (text: string) => applyColor(text, theme.warning as Color);
  const isAgenticSearchEnabled = false;
  const [currentBranch, setCurrentBranch] = React.useState<string | null>(null);
  const [branchFilterEnabled, setBranchFilterEnabled] = React.useState(false);
  const [showAllWorktrees, setShowAllWorktrees] = React.useState(false);
  const [hasMultipleWorktrees, setHasMultipleWorktrees] = React.useState(false);
  const currentCwd = getOriginalCwd();
  const [renameValue, setRenameValue] = React.useState("");
  const [renameCursorOffset, setRenameCursorOffset] = React.useState(0);
  const [expandedGroupSessionIds, setExpandedGroupSessionIds] = React.useState(new Set<string>());
  const [focusedNode, setFocusedNode] = React.useState<TreeNode<{log: LogOption; indexInFiltered: number}> | null>(null);
  const [focusedIndex, setFocusedIndex] = React.useState(1);
  const [viewMode, setViewMode] = React.useState("list");
  const [previewLog, setPreviewLog] = React.useState<LogOption | null>(null);
  const prevFocusedIdRef = React.useRef<string | null>(null);
  const [selectedTagIndex, setSelectedTagIndex] = React.useState(0);
  const [agenticSearchState, setAgenticSearchState] = React.useState<AgenticSearchState>({
    status: "idle"
  });
  const [isAgenticSearchOptionFocused, setIsAgenticSearchOptionFocused] = React.useState(false);
  const agenticSearchAbortRef = React.useRef<AbortController | null>(null);
  const searchInputIsActive = viewMode === "search" && agenticSearchState.status !== "searching";
  const exitSearchFromInput = () => {
    setViewMode("list");
    logEvent("tengu_session_search_toggled", {
      enabled: false
    });
  };
  const {
    query: searchQuery,
    setQuery: setSearchQuery,
    cursorOffset: searchCursorOffset
  } = useSearchInput({
    isActive: searchInputIsActive,
    onExit: exitSearchFromInput,
    onExitUp: exitSearchFromInput,
    passthroughCtrlKeys: ["n"],
    initialQuery: initialSearchQuery || ""
  });
  const deferredSearchQuery = React.useDeferredValue(searchQuery);
  const [debouncedDeepSearchQuery, setDebouncedDeepSearchQuery] = React.useState("");
  React.useEffect(() => {
    if (!deferredSearchQuery) {
      setDebouncedDeepSearchQuery("");
      return;
    }
    const timeoutId = setTimeout(setDebouncedDeepSearchQuery, 300, deferredSearchQuery);
    return () => clearTimeout(timeoutId);
  }, [deferredSearchQuery]);
  const [deepSearchResults, setDeepSearchResults] = React.useState<{query: string; results: Array<{log: LogOption; score: number | undefined; searchableText: string}>} | null>(null);
  const [isSearching, setIsSearching] = React.useState(false);
  React.useEffect(() => {
    getBranch().then(branch => setCurrentBranch(branch));
    getWorktreePaths(currentCwd).then(paths => {
      setHasMultipleWorktrees(paths.length > 1);
    });
  }, [currentCwd]);
  const searchableTextByLog = new Map(logs.map(log => [log, buildSearchableText(log)] as const));
  const uniqueTags = getUniqueTags(logs);
  const hasTags = uniqueTags.length > 0;
  const tagTabs = hasTags ? ["All", ...uniqueTags] : [];
  const effectiveTagIndex = tagTabs.length > 0 && selectedTagIndex < tagTabs.length ? selectedTagIndex : 0;
  const selectedTab = tagTabs[effectiveTagIndex];
  const tagFilter = selectedTab === "All" ? undefined : selectedTab;
  const tagTabsLines = hasTags ? 1 : 0;
  let filtered = logs;
  if (isResumeWithRenameEnabled) {
    filtered = logs.filter(log => {
      const currentSessionId = getSessionId();
      const logSessionId = getSessionIdFromLog(log);
      const isCurrentSession = currentSessionId && logSessionId === currentSessionId;
      if (isCurrentSession) {
        return true;
      }
      if (log.customTitle) {
        return true;
      }
      const fromMessages = getFirstMeaningfulUserMessageTextContent(log.messages);
      if (fromMessages) {
        return true;
      }
      if (log.firstPrompt || log.customTitle) {
        return true;
      }
      return false;
    });
  }
  if (tagFilter !== undefined) {
    filtered = filtered.filter(log => log.tag === tagFilter);
  }
  if (branchFilterEnabled && currentBranch) {
    filtered = filtered.filter(log => log.gitBranch === currentBranch);
  }
  if (hasMultipleWorktrees && !showAllWorktrees) {
    filtered = filtered.filter(log => log.projectPath === currentCwd);
  }
  const baseFilteredLogs = filtered;
  let titleFilteredLogs: LogOption[];
  if (!searchQuery) {
    titleFilteredLogs = baseFilteredLogs;
  } else {
    const query = searchQuery.toLowerCase();
    titleFilteredLogs = baseFilteredLogs.filter(log => {
      const displayedTitle = getLogDisplayTitle(log).toLowerCase();
      const branch = (log.gitBranch || "").toLowerCase();
      const tag = (log.tag || "").toLowerCase();
      const prInfo = log.prNumber ? `pr #${log.prNumber} ${log.prRepository || ""}`.toLowerCase() : "";
      return displayedTitle.includes(query) || branch.includes(query) || tag.includes(query) || prInfo.includes(query);
    });
  }
  React.useEffect(() => {
    if (false && deferredSearchQuery && deferredSearchQuery !== debouncedDeepSearchQuery) {
      setIsSearching(true);
    }
  }, [deferredSearchQuery, debouncedDeepSearchQuery, false]);
  React.useEffect(() => {
    if (true || !debouncedDeepSearchQuery || true) {
      setDeepSearchResults(null);
      setIsSearching(false);
      return;
    }
    const timeoutId = setTimeout(runDeepSearch, 0, null, debouncedDeepSearchQuery, setDeepSearchResults, setIsSearching);
    return () => {
      clearTimeout(timeoutId);
    };
  }, [debouncedDeepSearchQuery, null, false]);
  const snippetMap = new Map<LogOption, Snippet>();
  let filteredWithDeepResults = titleFilteredLogs;
  if (deepSearchResults && debouncedDeepSearchQuery && deepSearchResults.query === debouncedDeepSearchQuery) {
    for (const result of deepSearchResults.results) {
      if (result.searchableText) {
        const snippet = extractSnippet(result.searchableText, debouncedDeepSearchQuery, SNIPPET_CONTEXT_CHARS);
        if (snippet) {
          snippetMap.set(result.log, snippet);
        }
      }
    }
    const titleMatchIds = new Set(filteredWithDeepResults.map(log => log.messages[0]?.uuid));
    const transcriptOnlyMatches = deepSearchResults.results.map(r => r.log).filter(log => !titleMatchIds.has(log.messages[0]?.uuid));
    filteredWithDeepResults = [...filteredWithDeepResults, ...transcriptOnlyMatches];
  }
  const filteredLogs = filteredWithDeepResults;
  const snippets = snippetMap;
  let displayedLogs: LogOption[];
  if (agenticSearchState.status === "results" && agenticSearchState.results.length > 0) {
    displayedLogs = agenticSearchState.results;
  } else {
    displayedLogs = filteredLogs;
  }
  const maxLabelWidth = Math.max(30, columns - 4);
  let treeNodes: LogTreeNode[];
  if (!isResumeWithRenameEnabled) {
    treeNodes = [];
  } else {
    const sessionGroups = groupLogsBySessionId(displayedLogs);
    treeNodes = Array.from(sessionGroups.entries()).map(([sessionId, groupLogs]) => {
      const latestLog = groupLogs[0];
      const indexInFiltered = displayedLogs.indexOf(latestLog);
      const snippet = snippets.get(latestLog);
      const snippetStr = snippet ? formatSnippet(snippet, highlightColor) : null;
      if (groupLogs.length === 1) {
        const metadata = buildLogMetadata(latestLog, {
          showProjectPath: showAllProjects
        });
        return {
          id: `log:${sessionId}:0`,
          value: {
            log: latestLog,
            indexInFiltered
          },
          label: buildLogLabel(latestLog, maxLabelWidth),
          description: snippetStr ? `${metadata}\n  ${snippetStr}` : metadata,
          dimDescription: true
        };
      }
      const forkCount = groupLogs.length - 1;
      const children = groupLogs.slice(1).map((log, index) => {
        const childIndexInFiltered = displayedLogs.indexOf(log);
        const childSnippet = snippets.get(log);
        const childSnippetStr = childSnippet ? formatSnippet(childSnippet, highlightColor) : null;
        const childMetadata = buildLogMetadata(log, {
          isChild: true,
          showProjectPath: showAllProjects
        });
        return {
          id: `log:${sessionId}:${index + 1}`,
          value: {
            log,
            indexInFiltered: childIndexInFiltered
          },
          label: buildLogLabel(log, maxLabelWidth, {
            isChild: true
          }),
          description: childSnippetStr ? `${childMetadata}\n      ${childSnippetStr}` : childMetadata,
          dimDescription: true
        };
      });
      const parentMetadata = buildLogMetadata(latestLog, {
        showProjectPath: showAllProjects
      });
      return {
        id: `group:${sessionId}`,
        value: {
          log: latestLog,
          indexInFiltered
        },
        label: buildLogLabel(latestLog, maxLabelWidth, {
          isGroupHeader: true,
          forkCount
        }),
        description: snippetStr ? `${parentMetadata}\n  ${snippetStr}` : parentMetadata,
        dimDescription: true,
        children
      };
    });
  }
  let flatOptions: Array<{label: string; description: string; dimDescription: boolean; value: string}>;
  if (isResumeWithRenameEnabled) {
    flatOptions = [];
  } else {
    flatOptions = displayedLogs.map((log, index) => {
      const rawSummary = getLogDisplayTitle(log);
      const summaryWithSidechain = rawSummary + (log.isSidechain ? " (sidechain)" : "");
      const summary = normalizeAndTruncateToWidth(summaryWithSidechain, maxLabelWidth);
      const baseDescription = formatLogMetadata(log);
      const projectSuffix = showAllProjects && log.projectPath ? ` · ${log.projectPath}` : "";
      const snippet = snippets.get(log);
      const snippetStr = snippet ? formatSnippet(snippet, highlightColor) : null;
      return {
        label: summary,
        description: snippetStr ? `${baseDescription}${projectSuffix}\n  ${snippetStr}` : baseDescription + projectSuffix,
        dimDescription: true,
        value: index.toString()
      };
    });
  }
  const focusedLog = focusedNode?.value.log ?? null;
  const getExpandCollapseHint = () => {
    if (!isResumeWithRenameEnabled || !focusedLog) {
      return "";
    }
    const sessionId = getSessionIdFromLog(focusedLog);
    if (!sessionId) {
      return "";
    }
    const sessionLogs = displayedLogs.filter(log => getSessionIdFromLog(log) === sessionId);
    const hasMultipleLogs = sessionLogs.length > 1;
    if (!hasMultipleLogs) {
      return "";
    }
    const isExpanded = expandedGroupSessionIds.has(sessionId);
    const isChildNode = sessionLogs.indexOf(focusedLog) > 0;
    if (isChildNode) {
      return "← to collapse";
    }
    return isExpanded ? "← to collapse" : "→ to expand";
  };
  const handleRenameSubmit = async () => {
    const sessionId = focusedLog ? getSessionIdFromLog(focusedLog) : undefined;
    if (!focusedLog || !sessionId) {
      setViewMode("list");
      setRenameValue("");
      return;
    }
    if (renameValue.trim()) {
      await saveCustomTitle(sessionId, renameValue.trim(), focusedLog.fullPath);
      if (isResumeWithRenameEnabled && onLogsChanged) {
        onLogsChanged();
      }
    }
    setViewMode("list");
    setRenameValue("");
  };
  const exitSearchMode = () => {
    setViewMode("list");
    logEvent("tengu_session_search_toggled", {
      enabled: false
    });
  };
  const enterSearchMode = () => {
    setViewMode("search");
    logEvent("tengu_session_search_toggled", {
      enabled: true
    });
  };
  const handleAgenticSearch = async () => {
    if (!searchQuery.trim() || !onAgenticSearch || true) {
      return;
    }
    agenticSearchAbortRef.current?.abort();
    const abortController = new AbortController();
    agenticSearchAbortRef.current = abortController;
    setAgenticSearchState({
      status: "searching"
    });
    logEvent("tengu_agentic_search_started", {
      query_length: searchQuery.length
    });
    try {
      const results = await onAgenticSearch!(searchQuery, logs, abortController.signal);
      if (abortController.signal.aborted) {
        return;
      }
      setAgenticSearchState({
        status: "results",
        results,
        query: searchQuery
      });
      logEvent("tengu_agentic_search_completed", {
        query_length: searchQuery.length,
        results_count: results.length
      });
    } catch (error) {
      if (abortController.signal.aborted) {
        return;
      }
      setAgenticSearchState({
        status: "error",
        message: error instanceof Error ? (error as Error).message : "Search failed"
      });
      logEvent("tengu_agentic_search_error", {
        query_length: searchQuery.length
      });
    }
  };
  React.useEffect(() => {
    if (agenticSearchState.status !== "idle" && agenticSearchState.status !== "searching") {
      if (agenticSearchState.status === "results" && agenticSearchState.query !== searchQuery || agenticSearchState.status === "error") {
        setAgenticSearchState({
          status: "idle"
        });
      }
    }
  }, [searchQuery, agenticSearchState]);
  React.useEffect(() => () => {
    agenticSearchAbortRef.current?.abort();
  }, []);
  const prevAgenticStatusRef = React.useRef(agenticSearchState.status);
  React.useEffect(() => {
    const prevStatus = prevAgenticStatusRef.current;
    prevAgenticStatusRef.current = agenticSearchState.status;
    if (prevStatus === "searching" && agenticSearchState.status === "results") {
      if (isResumeWithRenameEnabled && treeNodes.length > 0) {
        setFocusedNode(treeNodes[0]);
      } else {
        if (!isResumeWithRenameEnabled && displayedLogs.length > 0) {
          const firstLog = displayedLogs[0];
          setFocusedNode({
            id: "0",
            value: {
              log: firstLog,
              indexInFiltered: 0
            },
            label: ""
          });
        }
      }
    }
  }, [agenticSearchState.status, isResumeWithRenameEnabled, treeNodes, displayedLogs]);
  const handleFlatOptionsSelectFocus = (value: string) => {
    const index = parseInt(value, 10);
    const log = displayedLogs[index];
    if (!log || prevFocusedIdRef.current === index.toString()) {
      return;
    }
    prevFocusedIdRef.current = index.toString();
    setFocusedNode({
      id: index.toString(),
      value: {
        log,
        indexInFiltered: index
      },
      label: ""
    });
    setFocusedIndex(index + 1);
  };
  const handleTreeSelectFocus = (node: LogTreeNode) => {
    setFocusedNode(node);
    const index = displayedLogs.findIndex(log => getSessionIdFromLog(log) === getSessionIdFromLog(node.value.log));
    if (index >= 0) {
      setFocusedIndex(index + 1);
    }
  };
  const cancelAgenticSearch = () => {
    agenticSearchAbortRef.current?.abort();
    setAgenticSearchState({
      status: "idle"
    });
    logEvent("tengu_agentic_search_cancelled", {});
  };
  useKeybinding("confirm:no", cancelAgenticSearch, {
    context: "Confirmation",
    isActive: viewMode !== "preview" && agenticSearchState.status === "searching"
  });
  useKeybinding("confirm:no", () => {
    setViewMode("list");
    setRenameValue("");
  }, {
    context: "Settings",
    isActive: viewMode === "rename" && agenticSearchState.status !== "searching"
  });
  useKeybinding("confirm:no", () => {
    setSearchQuery("");
    setIsAgenticSearchOptionFocused(false);
    onCancel?.();
  }, {
    context: "Confirmation",
    isActive: viewMode !== "preview" && viewMode !== "rename" && viewMode !== "search" && isAgenticSearchOptionFocused && agenticSearchState.status !== "searching"
  });
  useInput((input, key) => {
    if (viewMode === "preview") {
      return;
    }
    if (agenticSearchState.status === "searching") {
      return;
    }
    if (viewMode === "rename") {} else {
      if (viewMode === "search") {
        if (input.toLowerCase() === "n" && key.ctrl) {
          exitSearchMode();
        } else {
          if (key.return || key.downArrow) {
            if (searchQuery.trim() && onAgenticSearch && false && agenticSearchState.status !== "results") {
              setIsAgenticSearchOptionFocused(true);
            }
          }
        }
      } else {
        if (isAgenticSearchOptionFocused) {
          if (key.return) {
            handleAgenticSearch();
            setIsAgenticSearchOptionFocused(false);
            return;
          } else {
            if (key.downArrow) {
              setIsAgenticSearchOptionFocused(false);
              return;
            } else {
              if (key.upArrow) {
                setViewMode("search");
                setIsAgenticSearchOptionFocused(false);
                return;
              }
            }
          }
        }
        if (hasTags && key.tab) {
          const offset = key.shift ? -1 : 1;
          setSelectedTagIndex(prev => {
            const current = prev < tagTabs.length ? prev : 0;
            const newIndex = (current + tagTabs.length + offset) % tagTabs.length;
            const newTab = tagTabs[newIndex];
            logEvent("tengu_session_tag_filter_changed", {
              is_all: newTab === "All",
              tag_count: uniqueTags.length
            });
            return newIndex;
          });
          return;
        }
        const keyIsNotCtrlOrMeta = !key.ctrl && !key.meta;
        const lowerInput = input.toLowerCase();
        if (lowerInput === "a" && key.ctrl && onToggleAllProjects) {
          onToggleAllProjects();
          logEvent("tengu_session_all_projects_toggled", {
            enabled: !showAllProjects
          });
        } else {
          if (lowerInput === "b" && key.ctrl) {
            const newEnabled = !branchFilterEnabled;
            setBranchFilterEnabled(newEnabled);
            logEvent("tengu_session_branch_filter_toggled", {
              enabled: newEnabled
            });
          } else {
            if (lowerInput === "w" && key.ctrl && hasMultipleWorktrees) {
              const newValue = !showAllWorktrees;
              setShowAllWorktrees(newValue);
              logEvent("tengu_session_worktree_filter_toggled", {
                enabled: newValue
              });
            } else {
              if (lowerInput === "/" && keyIsNotCtrlOrMeta) {
                setViewMode("search");
                logEvent("tengu_session_search_toggled", {
                  enabled: true
                });
              } else {
                if (lowerInput === "r" && key.ctrl && focusedLog) {
                  setViewMode("rename");
                  setRenameValue("");
                  logEvent("tengu_session_rename_started", {});
                } else {
                  if (lowerInput === "v" && key.ctrl && focusedLog) {
                    setPreviewLog(focusedLog);
                    setViewMode("preview");
                    logEvent("tengu_session_preview_opened", {
                      messageCount: focusedLog.messageCount
                    });
                  } else {
                    if (focusedLog && keyIsNotCtrlOrMeta && input.length > 0 && !/^\s+$/.test(input)) {
                      setViewMode("search");
                      setSearchQuery(input);
                      logEvent("tengu_session_search_toggled", {
                        enabled: true
                      });
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }, {
    isActive: true
  });
  const filterIndicators: string[] = [];
  if (branchFilterEnabled && currentBranch) {
    filterIndicators.push(currentBranch);
  }
  if (hasMultipleWorktrees && !showAllWorktrees) {
    filterIndicators.push("current worktree");
  }
  const showAdditionalFilterLine = filterIndicators.length > 0 && viewMode !== "search";
  const headerLines = 8 + (showAdditionalFilterLine ? 1 : 0) + tagTabsLines;
  const visibleCount = Math.max(1, Math.floor((maxHeight - headerLines - 2) / 3));
  React.useEffect(() => {
    if (!onLoadMore) {
      return;
    }
    const buffer = visibleCount * 2;
    if (focusedIndex + buffer >= displayedLogs.length) {
      onLoadMore(visibleCount * 3);
    }
  }, [focusedIndex, visibleCount, displayedLogs.length, onLoadMore]);
  if (logs.length === 0) {
    return null;
  }
  if (viewMode === "preview" && previewLog && isResumeWithRenameEnabled) {
    return <SessionPreview log={previewLog} onExit={() => {
      setViewMode("list");
      setPreviewLog(null);
    }} onSelect={onSelect} />;
  }
  return <Box flexDirection="column" height={maxHeight - 1}>
    <Box flexShrink={0}><Divider color="suggestion" /></Box>
    <Box flexShrink={0}><Text> </Text></Box>
    {hasTags ? <TagTabs tabs={tagTabs} selectedIndex={effectiveTagIndex} availableWidth={columns} showAllProjects={showAllProjects} /> : <Box flexShrink={0}><Text bold={true} color="suggestion">Resume Session{viewMode === "list" && displayedLogs.length > visibleCount && <Text dimColor={true}>{" "}({focusedIndex} of {displayedLogs.length})</Text>}</Text></Box>}
    <SearchBox query={searchQuery} isFocused={viewMode === "search"} isTerminalFocused={isTerminalFocused} cursorOffset={searchCursorOffset} />
    {filterIndicators.length > 0 && viewMode !== "search" && <Box flexShrink={0} paddingLeft={2}><Text dimColor={true}><Byline>{filterIndicators}</Byline></Text></Box>}
    <Box flexShrink={0}><Text> </Text></Box>
    {agenticSearchState.status === "searching" && <Box paddingLeft={1} flexShrink={0}><Spinner /><Text> Searching…</Text></Box>}
    {agenticSearchState.status === "results" && agenticSearchState.results.length > 0 && <Box paddingLeft={1} marginBottom={1} flexShrink={0}><Text dimColor={true} italic={true}>Claude found these results:</Text></Box>}
    {agenticSearchState.status === "results" && agenticSearchState.results.length === 0 && filteredLogs.length === 0 && <Box paddingLeft={1} marginBottom={1} flexShrink={0}><Text dimColor={true} italic={true}>No matching sessions found.</Text></Box>}
    {agenticSearchState.status === "error" && filteredLogs.length === 0 && <Box paddingLeft={1} marginBottom={1} flexShrink={0}><Text dimColor={true} italic={true}>No matching sessions found.</Text></Box>}
    {Boolean(searchQuery.trim()) && onAgenticSearch && false && agenticSearchState.status !== "searching" && agenticSearchState.status !== "results" && agenticSearchState.status !== "error" && <Box flexShrink={0} flexDirection="column"><Box flexDirection="row" gap={1}><Text color={isAgenticSearchOptionFocused ? "suggestion" : undefined}>{isAgenticSearchOptionFocused ? figures.pointer : " "}</Text><Text color={isAgenticSearchOptionFocused ? "suggestion" : undefined} bold={isAgenticSearchOptionFocused}>Search deeply using Claude →</Text></Box><Box height={1} /></Box>}
    {agenticSearchState.status === "searching" ? null : viewMode === "rename" && focusedLog ? <Box paddingLeft={2} flexDirection="column"><Text bold={true}>Rename session:</Text><Box paddingTop={1}><TextInput value={renameValue} onChange={setRenameValue} onSubmit={handleRenameSubmit} placeholder={getLogDisplayTitle(focusedLog, "Enter new session name")} columns={columns} cursorOffset={renameCursorOffset} onChangeCursorOffset={setRenameCursorOffset} showCursor={true} /></Box></Box> : isResumeWithRenameEnabled ? <TreeSelect nodes={treeNodes} onSelect={node => {
      onSelect(node.value.log);
    }} onFocus={handleTreeSelectFocus} onCancel={onCancel} focusNodeId={focusedNode?.id} visibleOptionCount={visibleCount} layout="expanded" isDisabled={viewMode === "search" || isAgenticSearchOptionFocused} hideIndexes={false} isNodeExpanded={nodeId => {
      if (viewMode === "search" || branchFilterEnabled) {
        return true;
      }
      const sessionId = typeof nodeId === "string" && nodeId.startsWith("group:") ? nodeId.substring(6) : null;
      return sessionId ? expandedGroupSessionIds.has(sessionId) : false;
    }} onExpand={nodeId => {
      const sessionId = typeof nodeId === "string" && nodeId.startsWith("group:") ? nodeId.substring(6) : null;
      if (sessionId) {
        setExpandedGroupSessionIds(prev => new Set(prev).add(sessionId));
        logEvent("tengu_session_group_expanded", {});
      }
    }} onCollapse={nodeId => {
      const sessionId = typeof nodeId === "string" && nodeId.startsWith("group:") ? nodeId.substring(6) : null;
      if (sessionId) {
        setExpandedGroupSessionIds(prev => {
          const newSet = new Set(prev);
          newSet.delete(sessionId);
          return newSet;
        });
      }
    }} onUpFromFirstItem={enterSearchMode} /> : <Select options={flatOptions} onChange={value => {
      const itemIndex = parseInt(value, 10);
      const log = displayedLogs[itemIndex];
      if (log) {
        onSelect(log);
      }
    }} visibleOptionCount={visibleCount} onCancel={onCancel} onFocus={handleFlatOptionsSelectFocus} defaultFocusValue={focusedNode?.id.toString()} layout="expanded" isDisabled={viewMode === "search" || isAgenticSearchOptionFocused} onUpFromFirstItem={enterSearchMode} />}
    <Box paddingLeft={2}>{exitState.pending ? <Text dimColor={true}>Press {exitState.keyName} again to exit</Text> : viewMode === "rename" ? <Text dimColor={true}><Byline><KeyboardShortcutHint shortcut="Enter" action="save" /><ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" /></Byline></Text> : agenticSearchState.status === "searching" ? <Text dimColor={true}><Byline><Text>Searching with Claude…</Text><ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" /></Byline></Text> : isAgenticSearchOptionFocused ? <Text dimColor={true}><Byline><KeyboardShortcutHint shortcut="Enter" action="search" /><KeyboardShortcutHint shortcut={"↓"} action="skip" /><ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" /></Byline></Text> : viewMode === "search" ? <Text dimColor={true}><Byline><Text>{isSearching && false ? "Searching…" : "Type to Search"}</Text><KeyboardShortcutHint shortcut="Enter" action="select" /><ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="clear" /></Byline></Text> : <Text dimColor={true}><Byline>{onToggleAllProjects && <KeyboardShortcutHint shortcut="Ctrl+A" action={`show ${showAllProjects ? "current dir" : "all projects"}`} />}{currentBranch && <KeyboardShortcutHint shortcut="Ctrl+B" action="toggle branch" />}{hasMultipleWorktrees && <KeyboardShortcutHint shortcut="Ctrl+W" action={`show ${showAllWorktrees ? "current worktree" : "all worktrees"}`} />}<KeyboardShortcutHint shortcut="Ctrl+V" action="preview" /><KeyboardShortcutHint shortcut="Ctrl+R" action="rename" /><Text>Type to search</Text><ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />{getExpandCollapseHint() && <Text>{getExpandCollapseHint()}</Text>}</Byline></Text>}</Box>
  </Box>;
}
function runDeepSearch(fuseIndex: Fuse<{log: LogOption; searchableText: string}>, debouncedDeepSearchQuery: string, setDeepSearchResults: (value: {query: string; results: Array<{log: LogOption; score: number | undefined; searchableText: string}>}) => void, setIsSearching: (value: boolean) => void) {
  const results = fuseIndex.search(debouncedDeepSearchQuery);
  results.sort((a, b) => {
    const aTime = new Date(a.item.log.modified).getTime();
    const bTime = new Date(b.item.log.modified).getTime();
    const timeDiff = bTime - aTime;
    if (Math.abs(timeDiff) > DATE_TIE_THRESHOLD_MS) {
      return timeDiff;
    }
    return (a.score ?? 1) - (b.score ?? 1);
  });
  setDeepSearchResults({
    results: results.map(r => ({
      log: r.item.log,
      score: r.score,
      searchableText: r.item.searchableText
    })),
    query: debouncedDeepSearchQuery
  });
  setIsSearching(false);
}

/**
 * Extracts searchable text content from a message.
 * Handles both string content and structured content blocks.
 */
function extractSearchableText(message: SerializedMessage): string {
  // Only extract from user and assistant messages that have content
  if (message.type !== 'user' && message.type !== 'assistant') {
    return '';
  }
  const content = 'message' in message ? message.message?.content : undefined;
  if (!content) return '';

  // Handle string content (simple messages)
  if (typeof content === 'string') {
    return content;
  }

  // Handle array of content blocks
  if (Array.isArray(content)) {
    return content.map(block => {
      if (typeof block === 'string') return block;
      if ('text' in block && typeof block.text === 'string') return block.text;
      return '';
      // we don't return thinking blocks and tool names here;
      // they're not useful for search, as they can add noise to the fuzzy matching
    }).filter(Boolean).join(' ');
  }
  return '';
}

/**
 * Builds searchable text for a log including messages, titles, summaries, and metadata.
 * Crops long transcripts to first/last N messages for performance.
 */
function buildSearchableText(log: LogOption): string {
  const searchableMessages = log.messages.length <= DEEP_SEARCH_MAX_MESSAGES ? log.messages : [...log.messages.slice(0, DEEP_SEARCH_CROP_SIZE), ...log.messages.slice(-DEEP_SEARCH_CROP_SIZE)];
  const messageText = searchableMessages.map(extractSearchableText).filter(Boolean).join(' ');
  const metadata = [log.customTitle, log.summary, log.firstPrompt, log.gitBranch, log.tag, log.prNumber ? `PR #${log.prNumber}` : undefined, log.prRepository].filter(Boolean).join(' ');
  const fullText = `${metadata} ${messageText}`.trim();
  return fullText.length > DEEP_SEARCH_MAX_TEXT_LENGTH ? fullText.slice(0, DEEP_SEARCH_MAX_TEXT_LENGTH) : fullText;
}
function groupLogsBySessionId(filteredLogs: LogOption[]): Map<string, LogOption[]> {
  const groups = new Map<string, LogOption[]>();
  for (const log of filteredLogs) {
    const sessionId = getSessionIdFromLog(log);
    if (sessionId) {
      const existing = groups.get(sessionId);
      if (existing) {
        existing.push(log);
      } else {
        groups.set(sessionId, [log]);
      }
    }
  }

  // Sort logs within each group by modified date (newest first)
  groups.forEach(logs => logs.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime()));
  return groups;
}

/**
 * Get unique tags from a list of logs, sorted alphabetically
 */
function getUniqueTags(logs: LogOption[]): string[] {
  const tags = new Set<string>();
  for (const log of logs) {
    if (log.tag) {
      tags.add(log.tag);
    }
  }
  return Array.from(tags).sort((a, b) => a.localeCompare(b));
}
