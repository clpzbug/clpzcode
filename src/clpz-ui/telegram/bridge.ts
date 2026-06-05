// Scaffold stub for the clpzcode TUI frontend port.
//
// The real Telegram bridge depends on grammy + the agent brain, which the
// frontend-only port does not pull in. app.tsx only uses createTelegramBridge
// and the TelegramBridgeHandle type; this no-op keeps the UI type-checking.

import type { ToolCall, ToolResult } from "../types/index";

export interface TelegramBridgeOptions {
  token: string;
  getApprovedUserIds: () => number[];
  coordinator: unknown;
  getTelegramAgent: (userId: number) => unknown;
  onUserMessage?: (event: { turnKey: string; userId: number; content: string }) => void;
  onAssistantMessage?: (event: { turnKey: string; userId: number; content: string; done: boolean }) => void;
  onToolCalls?: (event: { turnKey: string; userId: number; toolCalls: ToolCall[] }) => void;
  onToolResult?: (event: { turnKey: string; userId: number; toolCall: ToolCall; toolResult: ToolResult }) => void;
  onError?: (message: string) => void;
}

export interface TelegramBridgeHandle {
  start: () => void;
  stop: () => Promise<void>;
  sendDm: (userId: number, text: string) => Promise<void>;
}

export function createTelegramBridge(_opts: TelegramBridgeOptions): TelegramBridgeHandle {
  return {
    start: () => {},
    stop: async () => {},
    sendDm: async () => {},
  };
}
