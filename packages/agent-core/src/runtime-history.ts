import type { RuntimeEvent } from "@ore-code/protocol";
import {
  createContextCheckpoint,
  type ContextCheckpointEventBody,
  type ContextCheckpointReport
} from "./checkpoint-controller";
import { shouldPreCompressToolOutputs } from "./capacity";
import { createContextBriefing } from "./context-briefing";
import type { ContextBriefingReport } from "./capacity";
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
  briefing?: "off" | "auto";
  checkpointCandidateRatio?: number;
  checkpointRequiredRatio?: number;
  checkpointRetainedTailTurns?: number;
  briefingRetainedTailTurns?: number;
  briefingMaxChars?: number;
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
  briefing: ContextBriefingReport;
  workingSetPaths: string[];
  workingSetSummary: string;
}

const DEFAULT_SUMMARY_MAX_CHARS = 4_000;
const DEFAULT_VERBATIM_WINDOW_TURNS = 16;
const PRECOMPRESS_FULL_TOOL_RESULT_TURNS = 6;
const PRECOMPRESS_TEXT_MAX_CHARS = 1_200;
const PRECOMPRESS_SEARCH_TEXT_MAX_CHARS = 1_600;
const PRECOMPRESS_HEAD_LINES = 8;
const PRECOMPRESS_TAIL_LINES = 36;
const PRECOMPRESS_IMPORTANT_LINE_LIMIT = 24;
const PRECOMPRESS_MAX_ARRAY_ITEMS = 6;

type NormalizedRuntimeContextOptions =
  Omit<Required<RuntimeContextOptions>, "model" | "toolResultMaxChars" | "checkpointCandidateRatio" | "checkpointRequiredRatio" | "checkpointRetainedTailTurns" | "briefingRetainedTailTurns"> & {
    model?: string;
    toolResultMaxChars?: number;
    checkpointCandidateRatio?: number;
    checkpointRequiredRatio?: number;
    checkpointRetainedTailTurns?: number;
    briefingRetainedTailTurns?: number;
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
  const retained = applyReasoningRetention([...messages], { model: settings.model });
  const precompressedMessages = preCompressToolResultsForModelInput(retained.messages, settings);
  const preBriefingWorkingSet = deriveWorkingSet(precompressedMessages);
  const briefingResult = createContextBriefing(precompressedMessages, {
    model: settings.model,
    maxInputTokens: settings.maxInputTokens,
    trigger: settings.briefing,
    retainedTailTurns: settings.briefingRetainedTailTurns,
    maxChars: settings.briefingMaxChars,
    workingSetSummary: preBriefingWorkingSet.summary
  });
  const checkpointResult = settings.checkpoint === "auto"
    ? createContextCheckpoint(briefingResult.messages, {
      model: settings.model,
      maxInputTokens: settings.maxInputTokens,
      candidateRatio: settings.checkpointCandidateRatio,
      requiredRatio: settings.checkpointRequiredRatio,
      retainedTailTurns: settings.checkpointRetainedTailTurns,
      summaryMaxChars: settings.summaryMaxChars
    })
    : createContextCheckpoint(briefingResult.messages, {
      model: settings.model,
      maxInputTokens: settings.maxInputTokens,
      disabled: true
    });
  const workingSet = deriveWorkingSet(checkpointResult.messages);
  const context = limitMessages(checkpointResult.messages, settings, workingSet);
  return {
    ...context,
    reasoningReplayTokens: estimateReasoningReplayTokens(context.messages),
    reasoningRetention: retained.report,
    checkpoint: checkpointResult.report,
    ...(checkpointResult.eventBody ? { checkpointEvent: checkpointResult.eventBody } : {}),
    briefing: briefingResult.report,
    workingSetPaths: workingSet.paths,
    workingSetSummary: workingSet.summary
  };
}

export function runtimeEventsToLlmMessages(events: RuntimeEvent[], options: RuntimeContextOptions = {}): LlmMessage[] {
  return buildRuntimeContext(events, options).messages;
}

function preCompressToolResultsForModelInput(messages: LlmMessage[], settings: NormalizedRuntimeContextOptions): LlmMessage[] {
  const shouldPreCompress = shouldPreCompressToolOutputs({
    model: settings.model,
    messages
  }, { maxInputTokens: settings.maxInputTokens });

  if (!shouldPreCompress) {
    return messages;
  }

  return preCompressOldToolResults(messages, PRECOMPRESS_FULL_TOOL_RESULT_TURNS);
}

function preCompressOldToolResults(messages: LlmMessage[], fullToolResultTurns: number): LlmMessage[] {
  const turnIndexes = messageTurnIndexes(messages);
  const latestTurnIndex = turnIndexes.reduce((latest, turnIndex) => Math.max(latest, turnIndex), 0);
  const firstFullToolResultTurn = Math.max(0, latestTurnIndex - fullToolResultTurns + 1);
  let changed = false;

  const compacted = messages.map((message, index) => {
    if (message.role !== "tool" || turnIndexes[index] >= firstFullToolResultTurn) {
      return message;
    }

    const content = compactToolMessageContent(message.content);
    if (content === message.content || content.length >= message.content.length) {
      return message;
    }

    changed = true;
    return { ...message, content };
  });

  return changed ? compacted : messages;
}

function messageTurnIndexes(messages: LlmMessage[]): number[] {
  let turnIndex = 0;
  return messages.map((message) => {
    if (message.role === "user") {
      turnIndex += 1;
    }
    return turnIndex;
  });
}

function compactToolMessageContent(content: string): string {
  const parsed = parseJsonRecord(content);
  if (!parsed) {
    return compactPlainToolText(content);
  }

  const output = toRecord(parsed.output) ?? undefined;
  const compacted: Record<string, unknown> = {
    callId: typeof parsed.callId === "string" ? parsed.callId : undefined,
    ok: typeof parsed.ok === "boolean" ? parsed.ok : undefined,
    artifactId: typeof parsed.artifactId === "string" ? parsed.artifactId : undefined,
    error: compactJsonLike(parsed.error),
    modelStatus: parsed.modelStatus,
    modelInstruction: parsed.modelInstruction,
    output: compactToolOutput(output)
  };

  return JSON.stringify(stripUndefined(compacted));
}

function compactPlainToolText(content: string): string {
  return JSON.stringify({
    output: {
      precompressed: true,
      kind: "plain_text",
      originalChars: content.length,
      text: compactTextForPrecompress(content, PRECOMPRESS_SEARCH_TEXT_MAX_CHARS)
    }
  });
}

function compactToolOutput(output: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!output) {
    return { precompressed: true, kind: "unknown" };
  }

  if (isShellLikeOutput(output)) {
    return stripUndefined({
      precompressed: true,
      kind: "shell",
      command: output.command,
      cwd: output.cwd,
      exitCode: output.exitCode,
      timedOut: output.timedOut,
      jobId: output.jobId,
      stdoutChars: textLength(output.stdout),
      stderrChars: textLength(output.stderr),
      stdoutTruncated: output.stdoutTruncated,
      stderrTruncated: output.stderrTruncated,
      stdoutSummary: compactTextForPrecompress(asText(output.stdout), PRECOMPRESS_TEXT_MAX_CHARS),
      stderrSummary: compactTextForPrecompress(asText(output.stderr), PRECOMPRESS_TEXT_MAX_CHARS)
    });
  }

  if (isSearchLikeOutput(output)) {
    return stripUndefined({
      precompressed: true,
      kind: "search",
      outputKeys: Object.keys(output),
      matches: compactArrayPreview(output.matches),
      results: compactArrayPreview(output.results),
      citations: compactArrayPreview(output.citations),
      textChars: textLength(output.text),
      contentChars: textLength(output.content),
      textSummary: compactTextForPrecompress(asText(output.text), PRECOMPRESS_SEARCH_TEXT_MAX_CHARS),
      contentSummary: compactTextForPrecompress(asText(output.content), PRECOMPRESS_SEARCH_TEXT_MAX_CHARS)
    });
  }

  return stripUndefined({
    precompressed: true,
    kind: "generic",
    outputKeys: Object.keys(output),
    preview: compactJsonLike(output)
  });
}

function isShellLikeOutput(output: Record<string, unknown>) {
  return "stdout" in output || "stderr" in output || "command" in output || "jobId" in output || "exitCode" in output;
}

function isSearchLikeOutput(output: Record<string, unknown>) {
  return "matches" in output || "results" in output || "citations" in output || "text" in output || "content" in output;
}

function compactTextForPrecompress(value: string, maxChars: number): string | undefined {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) {
    return undefined;
  }

  if (normalized.length <= maxChars) {
    return normalized;
  }

  const lines = normalized.split("\n");
  const importantLines = lines
    .filter((line) => /error|failed|failure|exception|traceback|fatal|panic|cannot|unable|denied|timeout|timed out|undefined reference|syntax error|tests? failed|warn(?:ing)?/i.test(line))
    .slice(0, PRECOMPRESS_IMPORTANT_LINE_LIMIT);
  const head = truncateText(lines.slice(0, PRECOMPRESS_HEAD_LINES).join("\n"), Math.floor(maxChars * 0.24));
  const tail = trimLeadingText(lines.slice(-PRECOMPRESS_TAIL_LINES).join("\n"), Math.floor(maxChars * 0.34));
  const important = truncateText(importantLines.map((line) => `! ${line}`).join("\n"), Math.floor(maxChars * 0.3));
  const sections = [
    "Summary:",
    `- originalChars=${normalized.length}`,
    `- originalLines=${lines.length}`,
    important ? `Important lines:\n${important}` : "",
    tail ? `Tail:\n${tail}` : "",
    head ? `Head:\n${head}` : ""
  ].filter(Boolean).join("\n");

  return truncateText(sections, maxChars);
}

function trimLeadingText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  if (maxChars <= 16) {
    return value.slice(-maxChars);
  }

  const omitted = value.length - maxChars;
  const prefix = `[trimmed ${omitted} leading chars]\n`;
  return `${prefix}${value.slice(Math.max(0, value.length - maxChars + prefix.length))}`;
}

function compactArrayPreview(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return {
    count: value.length,
    items: value.slice(0, PRECOMPRESS_MAX_ARRAY_ITEMS).map(compactJsonLike)
  };
}

function compactJsonLike(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > PRECOMPRESS_SEARCH_TEXT_MAX_CHARS
      ? compactTextForPrecompress(value, PRECOMPRESS_SEARCH_TEXT_MAX_CHARS)
      : value;
  }

  if (Array.isArray(value)) {
    return {
      count: value.length,
      items: value.slice(0, PRECOMPRESS_MAX_ARRAY_ITEMS).map(compactJsonLike)
    };
  }

  const record = toRecord(value);
  if (!record) {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record).slice(0, PRECOMPRESS_MAX_ARRAY_ITEMS * 2)) {
    result[key] = compactJsonLike(child);
  }
  return stripUndefined(result);
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    return toRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stripUndefined(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function asText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return "";
  }
  return JSON.stringify(value);
}

function textLength(value: unknown): number | undefined {
  return typeof value === "string" ? value.length : undefined;
}

type WorkingSet = { paths: string[]; summary: string };
type LimitedRuntimeContext = Omit<RuntimeContext, "reasoningRetention" | "checkpoint" | "checkpointEvent" | "briefing" | "workingSetPaths" | "workingSetSummary">;
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
    briefing: options.briefing ?? "auto",
    checkpointCandidateRatio: options.checkpointCandidateRatio,
    checkpointRequiredRatio: options.checkpointRequiredRatio,
    checkpointRetainedTailTurns: options.checkpointRetainedTailTurns,
    briefingRetainedTailTurns: options.briefingRetainedTailTurns,
    briefingMaxChars: Math.max(512, options.briefingMaxChars ?? 6_000),
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
