import { feature } from 'bun:bundle';
import type { BetaContentBlock } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs';
import type { ImageBlockParam, TextBlockParam, ThinkingBlockParam, ToolResultBlockParam, ToolUseBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import * as React from 'react';
import type { Command } from '../commands.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { Box } from '../ink.js';
import type { Tools } from '../Tool.js';
import { type ConnectorTextBlock, isConnectorTextBlock } from '../types/connectorText.js';
import type { AssistantMessage, AttachmentMessage as AttachmentMessageType, CollapsedReadSearchGroup as CollapsedReadSearchGroupType, GroupedToolUseMessage as GroupedToolUseMessageType, NormalizedUserMessage, ProgressMessage, SystemMessage } from '../types/message.js';
import { type AdvisorBlock, isAdvisorBlock } from '../utils/advisor.js';
import { isFullscreenEnvEnabled } from '../utils/fullscreen.js';
import { logError } from '../utils/log.js';
import type { buildMessageLookups } from '../utils/messages.js';
import { CompactSummary } from './CompactSummary.js';
import { AdvisorMessage } from './messages/AdvisorMessage.js';
import { AssistantRedactedThinkingMessage } from './messages/AssistantRedactedThinkingMessage.js';
import { AssistantTextMessage } from './messages/AssistantTextMessage.js';
import { AssistantThinkingMessage } from './messages/AssistantThinkingMessage.js';
import { AssistantToolUseMessage } from './messages/AssistantToolUseMessage.js';
import { AttachmentMessage } from './messages/AttachmentMessage.js';
import { CollapsedReadSearchContent } from './messages/CollapsedReadSearchContent.js';
import { CompactBoundaryMessage } from './messages/CompactBoundaryMessage.js';
import { GroupedToolUseContent } from './messages/GroupedToolUseContent.js';
import { SystemTextMessage } from './messages/SystemTextMessage.js';
import { UserImageMessage } from './messages/UserImageMessage.js';
import { UserTextMessage } from './messages/UserTextMessage.js';
import { UserToolResultMessage } from './messages/UserToolResultMessage/UserToolResultMessage.js';
import { OffscreenFreeze } from './OffscreenFreeze.js';
import { ExpandShellOutputProvider } from './shell/ExpandShellOutputContext.js';
export type Props = {
  message: NormalizedUserMessage | AssistantMessage | AttachmentMessageType | SystemMessage | GroupedToolUseMessageType | CollapsedReadSearchGroupType;
  lookups: ReturnType<typeof buildMessageLookups>;
  // TODO: Find a way to remove this, and leave spacing to the consumer
  /** Absolute width for the container Box. When provided, eliminates a wrapper Box in the caller. */
  containerWidth?: number;
  addMargin: boolean;
  tools: Tools;
  commands: Command[];
  verbose: boolean;
  inProgressToolUseIDs: Set<string>;
  progressMessagesForMessage: ProgressMessage[];
  shouldAnimate: boolean;
  shouldShowDot: boolean;
  style?: 'condensed';
  width?: number | string;
  isTranscriptMode: boolean;
  isStatic: boolean;
  onOpenRateLimitOptions?: () => void;
  isActiveCollapsedGroup?: boolean;
  isUserContinuation?: boolean;
  /** ID of the last thinking block (uuid:index) to show, used for hiding past thinking in transcript mode */
  lastThinkingBlockId?: string | null;
  /** UUID of the latest user bash output message (for auto-expanding) */
  latestBashOutputUUID?: string | null;
};
function MessageImpl({
  message,
  lookups,
  containerWidth,
  addMargin,
  tools,
  commands,
  verbose,
  inProgressToolUseIDs,
  progressMessagesForMessage,
  shouldAnimate,
  shouldShowDot,
  style,
  width,
  isTranscriptMode,
  onOpenRateLimitOptions,
  isActiveCollapsedGroup,
  isUserContinuation = false,
  lastThinkingBlockId,
  latestBashOutputUUID
}: Props) {
  switch (message.type) {
    case "attachment":
      {
        return <AttachmentMessage addMargin={addMargin} attachment={message.attachment} verbose={verbose} isTranscriptMode={isTranscriptMode} />;
      }
    case "assistant":
      {
        const width_0 = containerWidth ?? "100%";
        const blocks = message.message.content.map((_, index_0) => <AssistantMessageBlock key={index_0} param={_} addMargin={addMargin} tools={tools} commands={commands} verbose={verbose} inProgressToolUseIDs={inProgressToolUseIDs} progressMessagesForMessage={progressMessagesForMessage} shouldAnimate={shouldAnimate} shouldShowDot={shouldShowDot} width={width} inProgressToolCallCount={inProgressToolUseIDs.size} isTranscriptMode={isTranscriptMode} lookups={lookups} onOpenRateLimitOptions={onOpenRateLimitOptions} thinkingBlockId={`${message.uuid}:${index_0}`} lastThinkingBlockId={lastThinkingBlockId} advisorModel={message.advisorModel} />);
        return <Box flexDirection="column" width={width_0}>{blocks}</Box>;
      }
    case "user":
      {
        if (message.isCompactSummary) {
          const screen = isTranscriptMode ? "transcript" : "prompt";
          return <CompactSummary message={message} screen={screen} />;
        }
        const imageIndices: number[] = [];
        let imagePosition = 0;
        for (const param of message.message.content) {
          if (param.type === "image") {
            const id = message.imagePasteIds?.[imagePosition];
            imagePosition++;
            imageIndices.push(id ?? imagePosition);
          } else {
            imageIndices.push(imagePosition);
          }
        }
        const isLatestBashOutput = latestBashOutputUUID === message.uuid;
        const width_0 = containerWidth ?? "100%";
        const content = <Box flexDirection="column" width={width_0}>{message.message.content.map((param_0, index) => <UserMessage key={index} message={message} addMargin={addMargin} tools={tools} progressMessagesForMessage={progressMessagesForMessage} param={param_0} style={style} verbose={verbose} imageIndex={imageIndices[index]} isUserContinuation={isUserContinuation} lookups={lookups} isTranscriptMode={isTranscriptMode} />)}</Box>;
        return isLatestBashOutput ? <ExpandShellOutputProvider>{content}</ExpandShellOutputProvider> : content;
      }
    case "system":
      {
        if (message.subtype === "compact_boundary") {
          if (isFullscreenEnvEnabled()) {
            return null;
          }
          // CompactBoundaryMessage has its own _c(5) internal cache and Message
          // is already wrapped in React.memo, so no outer slot needed here.
          return <CompactBoundaryMessage message={message} />;
        }
        if (message.subtype === "microcompact_boundary") {
          return null;
        }
        if (feature("HISTORY_SNIP")) {
          const {
            isSnipBoundaryMessage
          } = require("../services/compact/snipProjection.js") as typeof import('../services/compact/snipProjection.js');
          const {
            isSnipMarkerMessage
          } = require("../services/compact/snipCompact.js") as typeof import('../services/compact/snipCompact.js');
          if (isSnipBoundaryMessage(message)) {
            const {
              SnipBoundaryMessage
            } = require("./messages/SnipBoundaryMessage.js") as typeof import('./messages/SnipBoundaryMessage.js');
            return <SnipBoundaryMessage message={message} />;
          }
          if (isSnipMarkerMessage(message)) {
            return null;
          }
        }
        if (message.subtype === "local_command") {
          const param: TextBlockParam = {
            type: "text",
            text: message.content
          };
          return <UserTextMessage addMargin={addMargin} param={param} verbose={verbose} isTranscriptMode={isTranscriptMode} />;
        }
        return <SystemTextMessage message={message} addMargin={addMargin} verbose={verbose} isTranscriptMode={isTranscriptMode} />;
      }
    case "grouped_tool_use":
      {
        return <GroupedToolUseContent message={message} tools={tools} lookups={lookups} inProgressToolUseIDs={inProgressToolUseIDs} shouldAnimate={shouldAnimate} />;
      }
    case "collapsed_read_search":
      {
        const verbose_0 = verbose || isTranscriptMode;
        return <OffscreenFreeze><CollapsedReadSearchContent message={message} inProgressToolUseIDs={inProgressToolUseIDs} shouldAnimate={shouldAnimate} verbose={verbose_0} tools={tools} lookups={lookups} isActiveGroup={isActiveCollapsedGroup} /></OffscreenFreeze>;
      }
  }
}
type UserMessageProps = {
  message: NormalizedUserMessage;
  addMargin: boolean;
  tools: Tools;
  progressMessagesForMessage: ProgressMessage[];
  param: TextBlockParam | ImageBlockParam | ToolResultBlockParam;
  style?: 'condensed';
  verbose: boolean;
  imageIndex: number;
  isUserContinuation: boolean;
  lookups: ReturnType<typeof buildMessageLookups>;
  isTranscriptMode: boolean;
};
function UserMessage({
  message,
  addMargin,
  tools,
  progressMessagesForMessage,
  param,
  style,
  verbose,
  imageIndex,
  isUserContinuation,
  lookups,
  isTranscriptMode
}: UserMessageProps) {
  const {
    columns
  } = useTerminalSize();
  switch (param.type) {
    case "text":
      {
        return <UserTextMessage addMargin={addMargin} param={param} verbose={verbose} planContent={message.planContent} isTranscriptMode={isTranscriptMode} timestamp={message.timestamp} />;
      }
    case "image":
      {
        const addMargin_0 = addMargin && !isUserContinuation;
        return <UserImageMessage imageId={imageIndex} addMargin={addMargin_0} />;
      }
    case "tool_result":
      {
        const width = columns - 5;
        return <UserToolResultMessage param={param} message={message} lookups={lookups} progressMessagesForMessage={progressMessagesForMessage} style={style} tools={tools} verbose={verbose} width={width} isTranscriptMode={isTranscriptMode} />;
      }
    default:
      {
        return;
      }
  }
}
type AssistantMessageBlockProps = {
  param: BetaContentBlock | ConnectorTextBlock | AdvisorBlock;
  addMargin: boolean;
  tools: Tools;
  commands: Command[];
  verbose: boolean;
  inProgressToolUseIDs: Set<string>;
  progressMessagesForMessage: ProgressMessage[];
  shouldAnimate: boolean;
  shouldShowDot: boolean;
  width?: number | string;
  inProgressToolCallCount: number;
  isTranscriptMode: boolean;
  lookups: ReturnType<typeof buildMessageLookups>;
  onOpenRateLimitOptions?: () => void;
  thinkingBlockId: string;
  lastThinkingBlockId?: string | null;
  advisorModel?: string;
};
function AssistantMessageBlock({
  param,
  addMargin,
  tools,
  commands,
  verbose,
  inProgressToolUseIDs,
  progressMessagesForMessage,
  shouldAnimate,
  shouldShowDot,
  width,
  inProgressToolCallCount,
  isTranscriptMode,
  lookups,
  onOpenRateLimitOptions,
  thinkingBlockId,
  lastThinkingBlockId,
  advisorModel
}: AssistantMessageBlockProps) {
  if (feature("CONNECTOR_TEXT")) {
    if (isConnectorTextBlock(param)) {
      const textParam: TextBlockParam = {
        type: "text",
        text: param.connector_text
      };
      return <AssistantTextMessage param={textParam} addMargin={addMargin} shouldShowDot={shouldShowDot} verbose={verbose} width={width} onOpenRateLimitOptions={onOpenRateLimitOptions} />;
    }
  }
  switch (param.type) {
    case "tool_use":
      {
        return <AssistantToolUseMessage param={param} addMargin={addMargin} tools={tools} commands={commands} verbose={verbose} inProgressToolUseIDs={inProgressToolUseIDs} progressMessagesForMessage={progressMessagesForMessage} shouldAnimate={shouldAnimate} shouldShowDot={shouldShowDot} inProgressToolCallCount={inProgressToolCallCount} lookups={lookups} isTranscriptMode={isTranscriptMode} />;
      }
    case "text":
      {
        return <AssistantTextMessage param={param} addMargin={addMargin} shouldShowDot={shouldShowDot} verbose={verbose} width={width} onOpenRateLimitOptions={onOpenRateLimitOptions} />;
      }
    case "redacted_thinking":
      {
        if (!isTranscriptMode && !verbose) {
          return null;
        }
        return <AssistantRedactedThinkingMessage addMargin={addMargin} />;
      }
    case "thinking":
      {
        if (!isTranscriptMode && !verbose) {
          return null;
        }
        const isLastThinking = !lastThinkingBlockId || thinkingBlockId === lastThinkingBlockId;
        const hideInTranscript = isTranscriptMode && !isLastThinking;
        return <AssistantThinkingMessage addMargin={addMargin} param={param} isTranscriptMode={isTranscriptMode} verbose={verbose} hideInTranscript={hideInTranscript} />;
      }
    case "server_tool_use":
    case "advisor_tool_result":
      {
        if (isAdvisorBlock(param)) {
          const verbose_0 = verbose || isTranscriptMode;
          return <AdvisorMessage block={param} addMargin={addMargin} resolvedToolUseIDs={lookups.resolvedToolUseIDs} erroredToolUseIDs={lookups.erroredToolUseIDs} shouldAnimate={shouldAnimate} verbose={verbose_0} advisorModel={advisorModel} />;
        }
        logError(new Error(`Unable to render server tool block: ${param.type}`));
        return null;
      }
    default:
      {
        logError(new Error(`Unable to render message type: ${param.type}`));
        return null;
      }
  }
}
export function hasThinkingContent(m: {
  type: string;
  message?: {
    content: Array<{
      type: string;
    }>;
  };
}): boolean {
  if (m.type !== 'assistant' || !m.message) return false;
  return m.message.content.some(b => b.type === 'thinking' || b.type === 'redacted_thinking');
}

/** Exported for testing */
export function areMessagePropsEqual(prev: Props, next: Props): boolean {
  if (prev.message.uuid !== next.message.uuid) return false;
  // Only re-render on lastThinkingBlockId change if this message actually
  // has thinking content — otherwise every message in scrollback re-renders
  // whenever streaming thinking starts/stops (CC-941).
  if (prev.lastThinkingBlockId !== next.lastThinkingBlockId && hasThinkingContent(next.message)) {
    return false;
  }
  // Verbose toggle changes thinking block visibility/expansion
  if (prev.verbose !== next.verbose) return false;
  // Only re-render if this message's "is latest bash output" status changed,
  // not when the global latestBashOutputUUID changes to a different message
  const prevIsLatest = prev.latestBashOutputUUID === prev.message.uuid;
  const nextIsLatest = next.latestBashOutputUUID === next.message.uuid;
  if (prevIsLatest !== nextIsLatest) return false;
  if (prev.isTranscriptMode !== next.isTranscriptMode) return false;
  // containerWidth is an absolute number in the no-metadata path (wrapper
  // Box is skipped). Static messages must re-render on terminal resize.
  if (prev.containerWidth !== next.containerWidth) return false;
  if (prev.isStatic && next.isStatic) return true;
  return false;
}
export const Message = React.memo(MessageImpl, areMessagePropsEqual as any);
