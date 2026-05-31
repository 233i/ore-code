import type { RuntimeEvent } from "@seekforge/protocol";
import { estimateInputTokens, estimateTokensFromChars } from "./capacity";
import type { LlmMessage, LlmToolDefinition } from "./llm";
import { applyReasoningRetention } from "./reasoning-retention";

export type ContextCheckpointReason =
  | "capacity"
  | "reasoning_retention"
  | "manual"
  | "restore"
  | "provider_limit";

export type ContextCheckpointStatus = "none" | "candidate" | "applied";

export interface ContextCheckpointOptions {
  model?: string;
  tools?: LlmToolDefinition[];
  maxInputTokens: number;
  candidateRatio?: number;
  requiredRatio?: number;
  retainedTailTurns?: number;
  summaryMaxChars?: number;
  force?: boolean;
  disabled?: boolean;
  reason?: ContextCheckpointReason;
}

export interface ContextCheckpointReport {
  status: ContextCheckpointStatus;
  reason?: ContextCheckpointReason;
  inputTokensBefore: number;
  inputTokensAfter?: number;
  maxInputTokens: number;
  thresholdTokens: number;
  messagesBefore: number;
  messagesAfter?: number;
  droppedMessages?: number;
  retainedMessages?: number;
  summaryChars?: number;
  cacheBreak: boolean;
  message: string;
}

export type ContextCheckpointEventBody =
  Omit<Extract<RuntimeEvent, { type: "context_checkpoint" }>, "id" | "seq" | "threadId" | "turnId" | "createdAt">;

export interface ContextCheckpointResult {
  messages: LlmMessage[];
  report: ContextCheckpointReport;
  eventBody?: ContextCheckpointEventBody;
}

const DEFAULT_CANDIDATE_RATIO = 0.75;
const DEFAULT_REQUIRED_RATIO = 0.85;
const DEFAULT_RETAINED_TAIL_TURNS = 4;
const DEFAULT_SUMMARY_MAX_CHARS = 4_000;

export function createContextCheckpoint(
  messages: readonly LlmMessage[],
  options: ContextCheckpointOptions
): ContextCheckpointResult {
  const maxInputTokens = Math.max(0, options.maxInputTokens);
  const candidateRatio = boundedRatio(options.candidateRatio ?? DEFAULT_CANDIDATE_RATIO);
  const requiredRatio = boundedRatio(options.requiredRatio ?? DEFAULT_REQUIRED_RATIO);
  const thresholdTokens = Math.max(1, Math.floor(maxInputTokens * requiredRatio));
  const candidateTokens = Math.max(1, Math.floor(maxInputTokens * candidateRatio));
  const inputTokensBefore = estimateInputTokens([...messages], options.tools);
  if (messages.length === 0) {
    return {
      messages: [],
      report: {
        status: "none",
        inputTokensBefore,
        maxInputTokens,
        thresholdTokens,
        messagesBefore: 0,
        cacheBreak: false,
        message: "上下文为空，无需创建 checkpoint。"
      }
    };
  }
  if (options.disabled) {
    return {
      messages: cloneMessages(messages),
      report: {
        status: "none",
        inputTokensBefore,
        maxInputTokens,
        thresholdTokens,
        messagesBefore: messages.length,
        cacheBreak: false,
        message: "Context checkpoint disabled for this request."
      }
    };
  }

  const retentionPreview = applyReasoningRetention(messages, { model: options.model });
  const retentionWouldRewrite = retentionPreview.report.enabled &&
    (retentionPreview.report.strippedMessages > 0 || retentionPreview.report.healedMessages > 0);
  const reason = options.reason
    ?? (inputTokensBefore >= maxInputTokens && maxInputTokens > 0 ? "provider_limit"
      : retentionWouldRewrite ? "reasoning_retention"
        : "capacity");
  const shouldApply = Boolean(options.force) ||
    retentionWouldRewrite ||
    (maxInputTokens > 0 && inputTokensBefore >= thresholdTokens);

  if (!shouldApply) {
    const status: ContextCheckpointStatus = maxInputTokens > 0 && inputTokensBefore >= candidateTokens
      ? "candidate"
      : "none";
    return {
      messages: cloneMessages(messages),
      report: {
        status,
        reason: status === "candidate" ? "capacity" : undefined,
        inputTokensBefore,
        maxInputTokens,
        thresholdTokens,
        messagesBefore: messages.length,
        cacheBreak: false,
        message: status === "candidate"
          ? "上下文接近 checkpoint 阈值，后续可创建检查点。"
          : "上下文未达到 checkpoint 阈值。"
      }
    };
  }

  const retainedTailTurns = Math.max(1, options.retainedTailTurns ?? DEFAULT_RETAINED_TAIL_TURNS);
  const tailStart = tailStartIndex(messages, retainedTailTurns);
  const head = messages.slice(0, tailStart);
  const retainedTail = cloneMessages(messages.slice(tailStart));
  const summaryMessage = head.length > 0
    ? checkpointSummaryMessage(head, {
      maxChars: options.summaryMaxChars ?? DEFAULT_SUMMARY_MAX_CHARS,
      reason,
      retainedTailTurns
    })
    : undefined;
  const checkpointMessages = summaryMessage ? [summaryMessage, ...retainedTail] : retainedTail;
  const stableCheckpointMessages = applyReasoningRetention(checkpointMessages, { model: options.model }).messages;
  const inputTokensAfter = estimateInputTokens(stableCheckpointMessages, options.tools);
  const report: ContextCheckpointReport = {
    status: "applied",
    reason,
    inputTokensBefore,
    inputTokensAfter,
    maxInputTokens,
    thresholdTokens,
    messagesBefore: messages.length,
    messagesAfter: stableCheckpointMessages.length,
    droppedMessages: head.length,
    retainedMessages: retainedTail.length,
    summaryChars: summaryMessage?.content.length ?? 0,
    cacheBreak: true,
    message: checkpointMessage(reason, head.length, retainedTail.length)
  };

  return {
    messages: stableCheckpointMessages,
    report,
    eventBody: {
      type: "context_checkpoint",
      checkpointId: `checkpoint-${stableHash([
        reason,
        inputTokensBefore,
        inputTokensAfter,
        messages.length,
        stableCheckpointMessages.length,
        summaryMessage?.content ?? stableCheckpointMessages.map((message) => `${message.role}:${message.content}`).join("\n")
      ].join("|"))}`,
      reason,
      inputTokensBefore,
      inputTokensAfter,
      maxInputTokens,
      thresholdTokens,
      messagesBefore: messages.length,
      messagesAfter: stableCheckpointMessages.length,
      droppedMessages: head.length,
      retainedMessages: retainedTail.length,
      summaryChars: summaryMessage?.content.length ?? 0,
      cacheBreak: true,
      message: report.message,
      checkpointMessages: stableCheckpointMessages
    }
  };
}

function tailStartIndex(messages: readonly LlmMessage[], retainedTailTurns: number) {
  let seenTurns = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      seenTurns += 1;
      if (seenTurns === retainedTailTurns) {
        return index;
      }
    }
  }
  return messages.length > 0 ? 0 : messages.length;
}

function checkpointSummaryMessage(
  messages: readonly LlmMessage[],
  input: { maxChars: number; reason: ContextCheckpointReason; retainedTailTurns: number }
): LlmMessage {
  const userItems = recentRoleItems(messages, "user", 8);
  const assistantItems = recentRoleItems(messages, "assistant", 8);
  const toolItems = recentRoleItems(messages, "tool", 8);
  const pathItems = extractPaths(messages.map((message) => message.content).join("\n")).slice(0, 16);
  const sections = [
    "[context_checkpoint]",
    `Reason: ${input.reason}`,
    `Folded messages: ${messages.length}`,
    `Retained tail turns: ${input.retainedTailTurns}`,
    formatSummarySection("Recent user goals", userItems.slice(-5)),
    formatSummarySection("Recent assistant progress", assistantItems.slice(-5)),
    formatSummarySection("Recent tool results", toolItems.slice(-5)),
    pathItems.length ? `Working paths:\n${pathItems.map((path) => `- ${path}`).join("\n")}` : ""
  ].filter(Boolean);

  return {
    role: "assistant",
    content: truncateText(sections.join("\n\n"), Math.max(256, input.maxChars))
  };
}

function checkpointMessage(reason: ContextCheckpointReason, droppedMessages: number, retainedMessages: number) {
  switch (reason) {
    case "reasoning_retention":
      return `已创建 Context Checkpoint，清理旧 reasoning 基线；折叠 ${droppedMessages} 条，保留 ${retainedMessages} 条尾部消息。`;
    case "provider_limit":
      return `已创建 Context Checkpoint，避免超过 provider 输入上限；折叠 ${droppedMessages} 条，保留 ${retainedMessages} 条尾部消息。`;
    case "capacity":
      return `已创建 Context Checkpoint，降低上下文容量压力；折叠 ${droppedMessages} 条，保留 ${retainedMessages} 条尾部消息。`;
    case "manual":
      return `已创建手动 Context Checkpoint；折叠 ${droppedMessages} 条，保留 ${retainedMessages} 条尾部消息。`;
    case "restore":
      return `已在恢复边界创建 Context Checkpoint；折叠 ${droppedMessages} 条，保留 ${retainedMessages} 条尾部消息。`;
  }
}

function recentRoleItems(messages: readonly LlmMessage[], role: LlmMessage["role"], maxItems: number): string[] {
  return messages
    .filter((message) => message.role === role && message.content.trim())
    .slice(-maxItems)
    .map((message) => oneLine(message.content, 320));
}

function formatSummarySection(title: string, items: string[]) {
  if (items.length === 0) {
    return "";
  }
  return `${title}:\n${items.map((item) => `- ${item}`).join("\n")}`;
}

function extractPaths(text: string): string[] {
  const matches = text.match(/(?:[\w.-]+\/)+(?:[\w.@-]+)(?:\.[\w.-]+)?/g) ?? [];
  return [...new Set(matches)]
    .filter((path) => !path.startsWith("http://") && !path.startsWith("https://"));
}

function oneLine(value: string, maxChars: number) {
  return truncateText(value.trim().replace(/\s+/g, " "), maxChars);
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  if (maxChars <= 16) {
    return value.slice(0, maxChars);
  }
  const omitted = value.length - maxChars;
  const suffix = `\n[truncated ${omitted} chars]`;
  return `${value.slice(0, Math.max(0, maxChars - suffix.length))}${suffix}`;
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

function boundedRatio(value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_REQUIRED_RATIO;
  }
  return Math.max(0.01, Math.min(1, value));
}

function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

export function estimateCheckpointSummaryTokens(report: ContextCheckpointReport | undefined) {
  return report?.summaryChars ? estimateTokensFromChars(report.summaryChars) : 0;
}
