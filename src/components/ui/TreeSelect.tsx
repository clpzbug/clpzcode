import React from 'react';
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js';
import { Box } from '../../ink.js';
import { type OptionWithDescription, Select } from '../CustomSelect/select.js';
export type TreeNode<T> = {
  id: string | number;
  value: T;
  label: string;
  description?: string;
  dimDescription?: boolean;
  children?: TreeNode<T>[];
  metadata?: Record<string, unknown>;
};
type FlattenedNode<T> = {
  node: TreeNode<T>;
  depth: number;
  isExpanded: boolean;
  hasChildren: boolean;
  parentId?: string | number;
};
export type TreeSelectProps<T> = {
  /**
   * Tree nodes to display.
   */
  readonly nodes: TreeNode<T>[];

  /**
   * Callback when a node is selected.
   */
  readonly onSelect: (node: TreeNode<T>) => void;

  /**
   * Callback when cancel is pressed.
   */
  readonly onCancel?: () => void;

  /**
   * Callback when focused node changes.
   */
  readonly onFocus?: (node: TreeNode<T>) => void;

  /**
   * Node to focus by ID.
   */
  readonly focusNodeId?: string | number;

  /**
   * Number of visible options.
   */
  readonly visibleOptionCount?: number;

  /**
   * Layout of the options.
   */
  readonly layout?: 'compact' | 'expanded' | 'compact-vertical';

  /**
   * When disabled, user input is ignored.
   */
  readonly isDisabled?: boolean;

  /**
   * When true, hides the numeric indexes next to each option.
   */
  readonly hideIndexes?: boolean;

  /**
   * Function to determine if a node should be initially expanded.
   * If not provided, all nodes start collapsed.
   */
  readonly isNodeExpanded?: (nodeId: string | number) => boolean;

  /**
   * Callback when a node is expanded.
   */
  readonly onExpand?: (nodeId: string | number) => void;

  /**
   * Callback when a node is collapsed.
   */
  readonly onCollapse?: (nodeId: string | number) => void;

  /**
   * Custom prefix function for parent nodes
   * @param isExpanded - Whether the parent node is currently expanded
   * @returns The prefix string to display (default: '▼ ' when expanded, '▶ ' when collapsed)
   */
  readonly getParentPrefix?: (isExpanded: boolean) => string;

  /**
   * Custom prefix function for child nodes
   * @param depth - The depth of the child node in the tree (0-indexed from parent)
   * @returns The prefix string to display (default: '  ▸ ')
   */
  readonly getChildPrefix?: (depth: number) => string;

  /**
   * Callback when user presses up from the first item.
   * If provided, navigation will not wrap to the last item.
   */
  readonly onUpFromFirstItem?: () => void;
};

function defaultGetParentPrefix(isExpanded: boolean): string {
  return isExpanded ? "▼ " : "▶ ";
}
function defaultGetChildPrefix(_depth: number): string {
  return "  ▸ ";
}

/**
 * TreeSelect is a generic component for selecting items from a hierarchical tree structure.
 * It handles expand/collapse state, keyboard navigation, and renders the tree as a flat list
 * using the Select component.
 */
export function TreeSelect<T>({
  nodes,
  onSelect,
  onCancel,
  onFocus,
  focusNodeId,
  visibleOptionCount,
  layout = "expanded",
  isDisabled = false,
  hideIndexes = false,
  isNodeExpanded,
  onExpand,
  onCollapse,
  getParentPrefix,
  getChildPrefix,
  onUpFromFirstItem
}: TreeSelectProps<T>) {
  const [internalExpandedIds, setInternalExpandedIds] = React.useState<Set<string | number>>(() => new Set());
  const isProgrammaticFocusRef = React.useRef(false);
  const lastFocusedIdRef = React.useRef<string | number | null>(null);
  const isExpanded = React.useCallback((nodeId: string | number) => {
    if (isNodeExpanded) {
      return isNodeExpanded(nodeId);
    }
    return internalExpandedIds.has(nodeId);
  }, [internalExpandedIds, isNodeExpanded]);
  const flattenedNodes = React.useMemo(() => {
    const result: FlattenedNode<T>[] = [];
    function traverse(node: TreeNode<T>, depth: number, parentId?: string | number) {
      const hasChildren = !!node.children && node.children.length > 0;
      const nodeIsExpanded = isExpanded(node.id);
      result.push({
        node,
        depth,
        isExpanded: nodeIsExpanded,
        hasChildren,
        parentId
      });
      if (hasChildren && nodeIsExpanded && node.children) {
        for (const child of node.children) {
          traverse(child, depth + 1, node.id);
        }
      }
    }
    for (const node of nodes) {
      traverse(node, 0);
    }
    return result;
  }, [isExpanded, nodes]);
  const parentPrefixFn = getParentPrefix ?? defaultGetParentPrefix;
  const childPrefixFn = getChildPrefix ?? defaultGetChildPrefix;
  const buildLabel = React.useCallback((flatNode: FlattenedNode<T>) => {
    let prefix = "";
    if (flatNode.hasChildren) {
      prefix = parentPrefixFn(flatNode.isExpanded);
    } else {
      if (flatNode.depth > 0) {
        prefix = childPrefixFn(flatNode.depth);
      }
    }
    return prefix + flatNode.node.label;
  }, [childPrefixFn, parentPrefixFn]);
  const options = React.useMemo(() => flattenedNodes.map(flatNode => ({
    label: buildLabel(flatNode),
    description: flatNode.node.description,
    dimDescription: flatNode.node.dimDescription ?? true,
    value: flatNode.node.id
  })), [buildLabel, flattenedNodes]);
  const nodeMap = React.useMemo(() => {
    const map = new Map<string | number, TreeNode<T>>();
    flattenedNodes.forEach(fn => map.set(fn.node.id, fn.node));
    return map;
  }, [flattenedNodes]);
  const findFlattenedNode = React.useCallback((nodeId: string | number) => flattenedNodes.find(fn => fn.node.id === nodeId), [flattenedNodes]);
  const toggleExpand = React.useCallback((nodeId: string | number, shouldExpand: boolean) => {
    const flatNode = findFlattenedNode(nodeId);
    if (!flatNode || !flatNode.hasChildren) {
      return;
    }
    if (shouldExpand) {
      if (onExpand) {
        onExpand(nodeId);
      } else {
        setInternalExpandedIds(prev => new Set(prev).add(nodeId));
      }
    } else {
      if (onCollapse) {
        onCollapse(nodeId);
      } else {
        setInternalExpandedIds(prev => {
          const newSet = new Set(prev);
          newSet.delete(nodeId);
          return newSet;
        });
      }
    }
  }, [findFlattenedNode, onCollapse, onExpand]);
  const handleKeyDown = React.useCallback((e: KeyboardEvent) => {
    if (!focusNodeId || isDisabled) {
      return;
    }
    const flatNode = findFlattenedNode(focusNodeId);
    if (!flatNode) {
      return;
    }
    if (e.key === "right" && flatNode.hasChildren) {
      e.preventDefault();
      toggleExpand(focusNodeId, true);
    } else {
      if (e.key === "left") {
        if (flatNode.hasChildren && flatNode.isExpanded) {
          e.preventDefault();
          toggleExpand(focusNodeId, false);
        } else {
          if (flatNode.parentId !== undefined) {
            e.preventDefault();
            isProgrammaticFocusRef.current = true;
            toggleExpand(flatNode.parentId, false);
            if (onFocus) {
              const parentNode = nodeMap.get(flatNode.parentId);
              if (parentNode) {
                onFocus(parentNode);
              }
            }
          }
        }
      }
    }
  }, [findFlattenedNode, focusNodeId, isDisabled, nodeMap, onFocus, toggleExpand]);
  const handleChange = React.useCallback((nodeId: string | number) => {
    const node = nodeMap.get(nodeId);
    if (!node) {
      return;
    }
    onSelect(node);
  }, [nodeMap, onSelect]);
  const handleFocus = React.useCallback((nodeId: string | number) => {
    if (isProgrammaticFocusRef.current) {
      isProgrammaticFocusRef.current = false;
      return;
    }
    if (lastFocusedIdRef.current === nodeId) {
      return;
    }
    lastFocusedIdRef.current = nodeId;
    if (onFocus) {
      const node = nodeMap.get(nodeId);
      if (node) {
        onFocus(node);
      }
    }
  }, [nodeMap, onFocus]);
  return <Box tabIndex={0} autoFocus={true} onKeyDown={handleKeyDown}><Select options={options} onChange={handleChange} onFocus={handleFocus} onCancel={onCancel} defaultFocusValue={focusNodeId} visibleOptionCount={visibleOptionCount} layout={layout} isDisabled={isDisabled} hideIndexes={hideIndexes} onUpFromFirstItem={onUpFromFirstItem} />;</Box>;
}
