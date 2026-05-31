import type { RuntimeEvent } from "@seekforge/protocol";
import {
  createContextCheckpoint,
  type ContextCheckpointEventBody,
  type ContextCheckpointReport
} from "./checkpoint-controller";
import type { LlmMessage } from "./llm";
import { inputBudgetForModel } from "./model-metadata";
import { modelMessagesFromEvents } from "./model-message-ledger";
import { applyReasoningRetention, type ReasoningRetentionReport } from "./reasoning-retention";

export interface RuntimeContextOptions {
  maxMessages?: number;
  maxChars?: number;
  maxInputTokens?: number;
  model?: string;
  includeToolResults?: boolean;
  toolResultMaxChars?: number;
  compression?: "off" | "semantic";
  checkpoint?: "off" | "auto";
  checkpointCandidateRatio?: number;
  checkpointRequiredRatio?: number;
  checkpointRetainedTailTurns?: number;
  summaryMaxChars?: number;
  verbatimWindowTurns?: number;
}

export interface RuntimeContext {
  messages: LlmMessage[];
  estimatedChars: number;
  omittedMessages: number;
  truncated: boolean;
  compressed: boolean;
  summaryChars: number;
  reasoningReplayTokens: number;
  reasoningRetention: ReasoningRetentionReport;
  checkpoint: ContextCheckpointReport;
  checkpointEvent?: ContextCheckpointEventBody;
  workingSetPaths: string[];
  workingSetSummary: string;
}

const DEFAULT_SUMMARY_MAX_CHARS = 4_000;
const DEFAULT_VERBATIM_WINDOW_TURNS = 16;

type NormalizedRuntimeContextOptions =
  Omit<Required<RuntimeContextOptions>, "model" | "toolResultMaxChars" | "checkpointCandidateRatio" | "checkpointRequiredRatio" | "checkpointRetainedTailTurns"> & {
    model?: string;
    toolResultMaxChars?: number;
    checkpointCandidateRatio?: number;
    checkpointRequiredRatio?: number;
    checkpointRetainedTailTurns?: number;
  };

export function buildRuntimeContext(events: RuntimeEvent[], options: RuntimeContextOptions = {}): RuntimeContext {
  const settings = normalizeOptions(options);
  const messages = modelMessagesFromEvents(events, {
    includeToolResults: settings.includeToolResults,
    toolResultMaxChars: settings.toolResultMaxChars
  });
  return buildRuntimeContextFromMessagesWithSettings(messages, settings);
}

export function buildRuntimeContextFromMessages(messages: readonly LlmMessage[], options: RuntimeContextOptions = {}): RuntimeContext {
  return buildRuntimeContextFromMessagesWithSettings(messages, normalizeOptions(options));
}

function buildRuntimeContextFromMessagesWithSettings(messages: readonly LlmMessage[], settings: NormalizedRuntimeContextOptions): RuntimeContext {
  const checkpointResult = settings.checkpoint === "auto"
    ? createContextCheckpoint(messages, {
      model: settings.model,
      maxInputTokens: settings.maxInputTokens,
      candidateRatio: settings.checkpointCandidateRatio,
      requiredRatio: settings.checkpointRequiredRatio,
      retainedTailTurns: settings.checkpointRetainedTailTurns,
      summaryMaxChars: settings.summaryMaxChars
    })
    : createContextCheckpoint(messages, {
      model: settings.model,
      maxInputTokens: settings.maxInputTokens,
      disabled: true
    });
  const retained = applyReasoningRetention(checkpointResult.messages, { model: settings.model });
  const workingSet = deriveWorkingSet(retained.messages);
  const context = limitMessages(retained.messages, settings, workingSet);
  return {
    ...context,
    reasoningReplayTokens: estimateReasoningReplayTokens(context.messages),
    reasoningRetention: retained.report,
    checkpoint: checkpointResult.report,
    ...(checkpointResult.eventBody ? { checkpointEvent: checkpointResult.eventBody } : {}),
    workingSetPaths: workingSet.paths,
    workingSetSummary: workingSet.summary
  };
}

export function runtimeEventsToLlmMessages(events: RuntimeEvent[], options: RuntimeContextOptions = {}): LlmMessage[] {
  return buildRuntimeContext(events, options).messages;
}

type WorkingSet = { paths: string[]; summary: string };
type LimitedRuntimeContext = Omit<RuntimeContext, "reasoningRetention" | "checkpoint" | "checkpointEvent" | "workingSetPaths" | "workingSetSummary">;
type RecentRuntimeContext = Omit<LimitedRuntimeContext, "compressed" | "summaryChars" | "reasoningReplayTokens">;

function limitMessages(messages: LlmMessage[], settings: NormalizedRuntimeContextOptions, workingSet: WorkingSet): LimitedRuntimeContext {
  if (settings.maxMessages <= 0 || settings.maxChars <= 0 || messages.length === 0) {
    return {
      messages: [],
      estimatedChars: 0,
      omittedMessages: messages.length,
      truncated: messages.length > 0,
      compressed: false,
      summaryChars: 0,
      reasoningReplayTokens: 0
    };
  }

  const limited = selectRecentMessages(messages, settings.maxMessages, settings.maxChars);
  if (settings.compression !== "semantic" || !limited.truncated || limited.omittedMessages === 0) {
    return {
      ...limited,
      compressed: false,
      summaryChars: 0,
      reasoningReplayTokens: 0
    };
  }

  return limitMessagesWithSemanticSummary(messages, settings, limited.omittedMessages, workingSet);
}

function limitMessagesWithSemanticSummary(
  messages: LlmMessage[],
  settings: NormalizedRuntimeContextOptions,
  firstOmittedMessages: number,
  workingSet: WorkingSet = { paths: [], summary: "" }
): LimitedRuntimeContext {
  const preferredRecentMessages = Math.max(0, settings.verbatimWindowTurns * 2);
  let omittedMessages = Math.min(firstOmittedMessages, Math.max(0, messages.length - preferredRecentMessages));
  let summaryMessage = semanticSummaryMessage(messages.slice(0, omittedMessages), settings.summaryMaxChars, workingSet);
  if (!summaryMessage || settings.maxMessages < 2 || settings.maxChars <= estimateMessageChars(summaryMessage)) {
    return {
      ...selectRecentMessages(messages, settings.maxMessages, settings.maxChars),
      compressed: false,
      summaryChars: 0,
      reasoningReplayTokens: 0
    };
  }

  let recent = selectRecentMessages(
    messages.slice(omittedMessages),
    settings.maxMessages - 1,
    Math.max(0, settings.maxChars - estimateMessageChars(summaryMessage))
  );

  for (let iteration = 0; iteration < 4 && recent.omittedMessages > 0; iteration += 1) {
    omittedMessages += recent.omittedMessages;
    summaryMessage = semanticSummaryMessage(messages.slice(0, omittedMessages), settings.summaryMaxChars, workingSet);
    if (!summaryMessage || settings.maxChars <= estimateMessageChars(summaryMessage)) {
      break;
    }
    recent = selectRecentMessages(
      messages.slice(omittedMessages),
      settings.maxMessages - 1,
      Math.max(0, settings.maxChars - estimateMessageChars(summaryMessage))
    );
  }

  if (!summaryMessage) {
    return {
      ...recent,
      omittedMessages,
      truncated: true,
      compressed: false,
      summaryChars: 0,
      reasoningReplayTokens: 0
    };
  }

  const messagesWithSummary = [summaryMessage, ...recent.messages];
  return {
    messages: messagesWithSummary,
    estimatedChars: messagesWithSummary.reduce((sum, message) => sum + estimateMessageChars(message), 0),
    omittedMessages,
    truncated: true,
    compressed: true,
    summaryChars: summaryMessage.content.length,
    reasoningReplayTokens: 0
  };
}

function selectRecentMessages(messages: LlmMessage[], maxMessages: number, maxChars: number): RecentRuntimeContext {
  const selected: LlmMessage[] = [];
  let estimatedChars = 0;
  let omittedMessages = 0;
  let truncated = false;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const remainingChars = Math.max(0, maxChars - estimatedChars);
    const remainingContentChars = Math.max(0, remainingChars - message.role.length);
    const boundedMessage =
      estimateMessageChars(message) > remainingChars
        ? { ...message, content: truncateText(message.content, remainingContentChars) }
        : message;
    const messageChars = estimateMessageChars(boundedMessage);
    const wouldExceedMessageLimit = selected.length >= maxMessages;
    const wouldExceedCharLimit = estimatedChars + messageChars > maxChars;

    if (wouldExceedMessageLimit || wouldExceedCharLimit) {
      omittedMessages = index + 1;
      truncated = true;
      break;
    }

    if (boundedMessage.content !== message.content) {
      truncated = true;
    }

    selected.unshift(boundedMessage);
    estimatedChars += messageChars;
  }

  const validSelected = dropLeadingToolMessages(selected);

  return {
    messages: validSelected.messages,
    estimatedChars: validSelected.estimatedChars,
    omittedMessages: omittedMessages + validSelected.droppedMessages,
    truncated: truncated || validSelected.droppedMessages > 0
  };
}

function normalizeOptions(options: RuntimeContextOptions): NormalizedRuntimeContextOptions {
  const maxInputTokens = Math.max(0, options.maxInputTokens ?? inputBudgetForModel(options.model));
  return {
    maxMessages: Math.max(0, options.maxMessages ?? Number.MAX_SAFE_INTEGER),
    maxChars: Math.max(0, options.maxChars ?? charsBudgetFromTokens(maxInputTokens)),
    maxInputTokens,
    model: options.model,
    includeToolResults: options.includeToolResults ?? true,
    toolResultMaxChars: options.toolResultMaxChars === undefined
      ? undefined
      : Math.max(0, options.toolResultMaxChars),
    compression: options.compression ?? "off",
    checkpoint: options.checkpoint ?? "off",
    checkpointCandidateRatio: options.checkpointCandidateRatio,
    checkpointRequiredRatio: options.checkpointRequiredRatio,
    checkpointRetainedTailTurns: options.checkpointRetainedTailTurns,
    summaryMaxChars: Math.max(256, options.summaryMaxChars ?? DEFAULT_SUMMARY_MAX_CHARS),
    verbatimWindowTurns: Math.max(0, options.verbatimWindowTurns ?? DEFAULT_VERBATIM_WINDOW_TURNS)
  };
}

function charsBudgetFromTokens(tokens: number) {
  return Math.floor((tokens / 1.35) * 3.3);
}

function estimateMessageChars(message: LlmMessage): number {
  return message.role.length +
    message.content.length +
    (message.reasoningContent?.length ?? 0) +
    (message.toolCallId?.length ?? 0) +
    JSON.stringify(message.toolCalls ?? []).length;
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

function semanticSummaryMessage(messages: LlmMessage[], maxChars: number, workingSet: WorkingSet): LlmMessage | null {
  if (messages.length === 0) {
    return null;
  }

  const userItems = recentRoleItems(messages, "user", 6);
  const assistantItems = recentRoleItems(messages, "assistant", 6);
  const toolItems = recentRoleItems(messages, "tool", 6);
  const sections = [
    `Earlier conversation compressed (${messages.length} omitted model messages). Preserve these facts when answering the current turn.`,
    formatSummarySection("Goal", userItems.slice(-3)),
    formatSummarySection("Constraints", userItems.filter((item) => /不要|不能|must|should|scope|范围|限制/i.test(item)).slice(-4)),
    formatSummarySection("Progress", [...assistantItems, ...toolItems].slice(-6)),
    formatSummarySection("Key Decisions", assistantItems.filter((item) => /决定|选择|采用|decision|use |keep /i.test(item)).slice(-4)),
    workingSet.summary ? `Working Set:\n${workingSet.summary}` : "",
    formatSummarySection("Next step", [...userItems, ...assistantItems].slice(-1))
  ].filter(Boolean);
  const content = truncateText(sections.join("\n\n"), maxChars);

  return {
    role: "system",
    content
  };
}

function deriveWorkingSet(messages: LlmMessage[]): WorkingSet {
  const pathCounts = new Map<string, number>();
  const toolNames = new Set<string>();
  for (const message of messages.slice(-80)) {
    for (const path of extractPaths(message.content)) {
      pathCounts.set(path, (pathCounts.get(path) ?? 0) + 1);
    }
    for (const call of message.toolCalls ?? []) {
      toolNames.add(call.name);
      const input = typeof call.input === "object" && call.input !== null ? call.input as Record<string, unknown> : {};
      for (const key of ["path", "target", "destination", "cwd", "workdir"]) {
        const value = input[key];
        if (typeof value === "string") {
          pathCounts.set(value, (pathCounts.get(value) ?? 0) + 1);
        }
      }
    }
  }

  const paths = [...pathCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 24)
    .map(([path]) => path);
  const tools = [...toolNames].sort().slice(0, 12);
  const summary = [
    paths.length ? `Paths: ${paths.join(", ")}` : "",
    tools.length ? `Tools: ${tools.join(", ")}` : ""
  ].filter(Boolean).join("\n");
  return { paths, summary };
}

function extractPaths(text: string): string[] {
  const matches = text.match(/(?:[\w.-]+\/)+(?:[\w.@-]+)(?:\.[\w.-]+)?/g) ?? [];
  return [...new Set(matches)]
    .filter((path) => !path.startsWith("http://") && !path.startsWith("https://"))
    .slice(0, 32);
}

function recentRoleItems(messages: LlmMessage[], role: LlmMessage["role"], maxItems: number): string[] {
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

function oneLine(value: string, maxChars: number) {
  return truncateText(value.trim().replace(/\s+/g, " "), maxChars);
}

function dropLeadingToolMessages(messages: LlmMessage[]) {
  let firstNonTool = 0;
  while (firstNonTool < messages.length && messages[firstNonTool].role === "tool") {
    firstNonTool += 1;
  }

  const validMessages = messages.slice(firstNonTool);
  return {
    messages: validMessages,
    droppedMessages: firstNonTool,
    estimatedChars: validMessages.reduce((sum, message) => sum + estimateMessageChars(message), 0)
  };
}

function estimateReasoningReplayTokens(messages: LlmMessage[]) {
  const chars = messages.reduce((sum, message) => sum + (message.reasoningContent?.length ?? 0), 0);
  return Math.max(0, Math.ceil((chars / 3.3) * 1.35));
}
