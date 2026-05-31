import type { LlmMessage } from "./llm";
import { isDeepSeekThinkingModel } from "./model-metadata";

export const REASONING_RETENTION_PLACEHOLDER = "(reasoning omitted)";

export interface ReasoningRetentionOptions {
  model?: string;
  recentWindowTurns?: number;
}

export interface ReasoningRetentionReport {
  enabled: boolean;
  model?: string;
  recentWindowTurns: number;
  keptMessages: number;
  keptToolCallMessages: number;
  keptRecentMessages: number;
  strippedMessages: number;
  strippedChars: number;
  healedMessages: number;
  healingApplied: boolean;
}

export interface ReasoningRetentionResult {
  messages: LlmMessage[];
  report: ReasoningRetentionReport;
}

const DEFAULT_RECENT_WINDOW_TURNS = 2;

export function applyReasoningRetention(
  messages: readonly LlmMessage[],
  options: ReasoningRetentionOptions = {}
): ReasoningRetentionResult {
  const recentWindowTurns = Math.max(0, options.recentWindowTurns ?? DEFAULT_RECENT_WINDOW_TURNS);
  const enabled = isDeepSeekThinkingModel(options.model);
  if (!enabled) {
    return {
      messages: cloneMessages(messages),
      report: emptyReport(false, options.model, recentWindowTurns)
    };
  }

  const turnIndexes = messageTurnIndexes(messages);
  const maxTurnIndex = Math.max(0, ...turnIndexes);
  const recentTurnStart = Math.max(1, maxTurnIndex - recentWindowTurns + 1);
  const report = emptyReport(true, options.model, recentWindowTurns);

  const retainedMessages = messages.map((message, index) => {
    const nextMessage = cloneMessage(message);
    if (nextMessage.role !== "assistant") {
      return nextMessage;
    }

    const hasReasoning = Boolean(nextMessage.reasoningContent);
    const hasToolCalls = Boolean(nextMessage.toolCalls?.length);
    const isRecent = turnIndexes[index] >= recentTurnStart;

    if (hasToolCalls) {
      report.keptMessages += hasReasoning ? 1 : 0;
      report.keptToolCallMessages += hasReasoning ? 1 : 0;
      if (!hasReasoning) {
        nextMessage.reasoningContent = REASONING_RETENTION_PLACEHOLDER;
        report.healedMessages += 1;
        report.healingApplied = true;
      }
      return nextMessage;
    }

    if (!hasReasoning) {
      return nextMessage;
    }

    if (isRecent) {
      report.keptMessages += 1;
      report.keptRecentMessages += 1;
      return nextMessage;
    }

    report.strippedMessages += 1;
    report.strippedChars += nextMessage.reasoningContent?.length ?? 0;
    delete nextMessage.reasoningContent;
    return nextMessage;
  });

  return { messages: retainedMessages, report };
}

function emptyReport(enabled: boolean, model: string | undefined, recentWindowTurns: number): ReasoningRetentionReport {
  return {
    enabled,
    model,
    recentWindowTurns,
    keptMessages: 0,
    keptToolCallMessages: 0,
    keptRecentMessages: 0,
    strippedMessages: 0,
    strippedChars: 0,
    healedMessages: 0,
    healingApplied: false
  };
}

function messageTurnIndexes(messages: readonly LlmMessage[]) {
  let turnIndex = 0;
  return messages.map((message) => {
    if (message.role === "user") {
      turnIndex += 1;
    }
    return turnIndex;
  });
}

function cloneMessages(messages: readonly LlmMessage[]) {
  return messages.map(cloneMessage);
}

function cloneMessage(message: LlmMessage): LlmMessage {
  return {
    ...message,
    ...(message.toolCalls ? { toolCalls: message.toolCalls.map((call) => ({
      ...call,
      input: cloneJsonLike(call.input)
    })) } : {})
  };
}

function cloneJsonLike<T>(value: T): T {
  if (value === undefined || value === null || typeof value !== "object") {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}
