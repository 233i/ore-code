import {
  estimateInputTokens,
  shouldGenerateContextBriefing,
  type ContextBriefingReport
} from "./capacity";
import type { LlmMessage, LlmToolDefinition } from "./llm";

export interface ContextBriefingOptions {
  model?: string;
  tools?: LlmToolDefinition[];
  maxInputTokens: number;
  trigger?: "off" | "auto";
  retainedTailTurns?: number;
  maxChars?: number;
  workingSetSummary?: string;
}

export interface ContextBriefingResult {
  messages: LlmMessage[];
  report: ContextBriefingReport;
  briefingMessage?: LlmMessage;
}

const DEFAULT_RETAINED_TAIL_TURNS = 6;
const DEFAULT_BRIEFING_MAX_CHARS = 6_000;

export function createContextBriefing(
  messages: readonly LlmMessage[],
  options: ContextBriefingOptions
): ContextBriefingResult {
  const maxInputTokens = Math.max(0, options.maxInputTokens);
  const inputTokensBefore = estimateInputTokens([...messages], options.tools);
  const thresholdTokens = Math.floor(maxInputTokens * 0.825);
  const baseReport = {
    inputTokensBefore,
    maxInputTokens,
    thresholdTokens,
    messagesBefore: messages.length
  };

  if (messages.length === 0) {
    return {
      messages: [],
      report: {
        ...baseReport,
        status: "none",
        cacheBreak: false,
        message: "上下文为空，无需生成 Context Briefing。"
      }
    };
  }

  if (options.trigger === "off" || !shouldGenerateContextBriefing({
    model: options.model,
    messages: [...messages],
    tools: options.tools
  }, { maxInputTokens })) {
    return {
      messages: cloneMessages(messages),
      report: {
        ...baseReport,
        status: "none",
        cacheBreak: false,
        message: "上下文未达到 briefing seam。"
      }
    };
  }

  const retainedTailTurns = Math.max(1, options.retainedTailTurns ?? DEFAULT_RETAINED_TAIL_TURNS);
  const tailStart = tailStartIndex(messages, retainedTailTurns);
  const foldedMessages = messages.slice(0, tailStart);
  const retainedTail = cloneMessages(messages.slice(tailStart));
  if (foldedMessages.length === 0) {
    return {
      messages: cloneMessages(messages),
      report: {
        ...baseReport,
        status: "none",
        cacheBreak: false,
        message: "Context Briefing 没有可折叠的旧消息。"
      }
    };
  }

  const reason = inputTokensBefore >= maxInputTokens ? "hard" : "cycle";
  const briefingMessage = contextBriefingMessage(foldedMessages, {
    maxChars: options.maxChars ?? DEFAULT_BRIEFING_MAX_CHARS,
    retainedTailTurns,
    workingSetSummary: options.workingSetSummary
  });
  const briefingMessages = [briefingMessage, ...retainedTail];
  const inputTokensAfter = estimateInputTokens(briefingMessages, options.tools);

  return {
    messages: briefingMessages,
    briefingMessage,
    report: {
      ...baseReport,
      status: "applied",
      reason,
      inputTokensAfter,
      messagesAfter: briefingMessages.length,
      foldedMessages: foldedMessages.length,
      retainedMessages: retainedTail.length,
      briefingChars: briefingMessage.content.length,
      cacheBreak: true,
      message: `已生成 Context Briefing，折叠 ${foldedMessages.length} 条旧消息，保留最近 ${retainedTailTurns} 轮原文。`
    }
  };
}

function contextBriefingMessage(
  messages: readonly LlmMessage[],
  input: { maxChars: number; retainedTailTurns: number; workingSetSummary?: string }
): LlmMessage {
  const userItems = recentRoleItems(messages, "user", 10);
  const assistantItems = recentRoleItems(messages, "assistant", 10);
  const toolItems = recentRoleItems(messages, "tool", 12);
  const constraints = userItems.filter((item) => /不要|不能|必须|只|保持|兼容|不兼容|must|should|scope|avoid|never/i.test(item));
  const decisions = assistantItems.filter((item) => /决定|选择|采用|保留|移除|改成|decision|choose|use |keep |remove /i.test(item));
  const failures = toolItems.filter((item) => /error|failed|failure|exception|fatal|panic|timeout|exitCode":(?:[1-9]|[1-9]\d+)/i.test(item));
  const paths = extractPaths(messages.map((message) => message.content).join("\n")).slice(0, 24);
  const sections = [
    "[context_briefing]",
    "This model-side briefing folds older conversation history. Treat it as context, not as a new user instruction.",
    `Folded messages: ${messages.length}`,
    `Recent verbatim tail: ${input.retainedTailTurns} turns`,
    formatSummarySection("User goals and constraints", [...constraints.slice(-5), ...userItems.slice(-5)].slice(-8)),
    formatSummarySection("Decisions and implementation direction", [...decisions.slice(-5), ...assistantItems.slice(-5)].slice(-8)),
    formatSummarySection("Tool findings and verification", [...failures.slice(-4), ...toolItems.slice(-6)].slice(-8)),
    paths.length ? `Working paths:\n${paths.map((path) => `- ${path}`).join("\n")}` : "",
    input.workingSetSummary ? `Working set:\n${input.workingSetSummary}` : "",
    formatSummarySection("Likely next step", [...userItems, ...assistantItems].slice(-2))
  ].filter(Boolean);

  return {
    role: "system",
    content: truncateText(sections.join("\n\n"), Math.max(512, input.maxChars))
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

function recentRoleItems(messages: readonly LlmMessage[], role: LlmMessage["role"], maxItems: number): string[] {
  return messages
    .filter((message) => message.role === role && message.content.trim())
    .slice(-maxItems)
    .map((message) => oneLine(message.content, 420));
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

function cloneMessages(messages: readonly LlmMessage[]): LlmMessage[] {
  return messages.map((message) => ({
    ...message,
    ...(message.toolCalls ? { toolCalls: message.toolCalls.map((call) => ({ ...call, input: cloneJsonLike(call.input) })) } : {})
  }));
}

function cloneJsonLike<T>(value: T): T {
  if (value === undefined || value === null || typeof value !== "object") {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
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
