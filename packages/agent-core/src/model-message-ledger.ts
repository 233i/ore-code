import type { RuntimeEvent, ToolCall, ToolResult } from "@ore-code/protocol";
import type { LlmMessage } from "./llm";
import { formatLazyContextForModel } from "./lazy-context";
import { formatProjectDeltaForModel } from "./project-delta";
import { serializeToolResultForModel } from "./tool-result-message";

export interface ModelMessageLedgerOptions {
  includeToolResults?: boolean;
  toolResultMaxChars?: number;
}

type ModelLedgerEntry =
  | { type: "message"; message: LlmMessage }
  | { type: "assistant"; parts: AssistantPart[]; reasoningContent?: string }
  | {
    type: "tool_interaction";
    parts: AssistantPart[];
    reasoningContent?: string;
    toolCalls: ToolCall[];
    toolResults: ToolResult[];
  };

type InteractionRequestEvent = Extract<RuntimeEvent, { type: "interaction_requested" }>;
type AssistantPart =
  | { type: "text"; text: string }
  | { type: "orphan_tool_result"; result: ToolResult };

export class ModelMessageLedger {
  private readonly entries: ModelLedgerEntry[] = [];
  private readonly interactionRequests = new Map<string, InteractionRequestEvent>();
  private assistantParts: AssistantPart[] = [];
  private reasoningText = "";
  private pendingToolCalls: ToolCall[] = [];
  private pendingToolResults: ToolResult[] = [];

  static fromEvents(events: readonly RuntimeEvent[]): ModelMessageLedger {
    const ledger = new ModelMessageLedger();
    ledger.appendMany(events);
    return ledger;
  }

  appendMany(events: readonly RuntimeEvent[]): void {
    for (const event of events) {
      this.append(event);
    }
  }

  append(event: RuntimeEvent): void {
    if (event.type === "user_message") {
      this.flushToolInteractionEntry();
      this.flushAssistantEntry();
      this.entries.push({ type: "message", message: { role: "user", content: event.text } });
      return;
    }

    if (event.type === "reasoning_delta") {
      this.flushToolInteractionEntry();
      this.reasoningText += event.text;
      return;
    }

    if (event.type === "assistant_delta" || event.type === "assistant_message") {
      this.flushToolInteractionEntry();
      this.assistantParts.push({ type: "text", text: event.text });
      return;
    }

    if (event.type === "interaction_requested") {
      this.flushToolInteractionEntry();
      this.flushAssistantEntry();
      this.interactionRequests.set(event.requestId, event);
      this.entries.push({ type: "message", message: { role: "assistant", content: interactionRequestSummary(event) } });
      return;
    }

    if (event.type === "interaction_decided") {
      this.flushToolInteractionEntry();
      this.flushAssistantEntry();
      this.entries.push({
        type: "message",
        message: { role: "user", content: interactionDecisionSummary(event, this.interactionRequests.get(event.requestId)) }
      });
      return;
    }

    if (event.type === "subagent_completed") {
      this.flushToolInteractionEntry();
      this.flushAssistantEntry();
      this.entries.push({ type: "message", message: { role: "assistant", content: subagentCompletionSummary(event) } });
      return;
    }

    if (event.type === "project_delta") {
      this.flushToolInteractionEntry();
      this.flushAssistantEntry();
      this.entries.push({ type: "message", message: { role: "system", content: formatProjectDeltaForModel(event) } });
      return;
    }

    if (event.type === "lazy_context_loaded") {
      this.flushToolInteractionEntry();
      this.flushAssistantEntry();
      if (event.content) {
        this.entries.push({ type: "message", message: { role: "assistant", content: formatLazyContextForModel(event) } });
      }
      return;
    }

    if (event.type === "context_checkpoint") {
      this.entries.splice(0, this.entries.length, ...event.checkpointMessages.map((message) => ({
        type: "message" as const,
        message: cloneLlmMessage(message)
      })));
      this.interactionRequests.clear();
      this.assistantParts = [];
      this.reasoningText = "";
      this.pendingToolCalls = [];
      this.pendingToolResults = [];
      return;
    }

    if (event.type === "tool_call_requested") {
      this.pendingToolCalls.push(event.call);
      return;
    }

    if (event.type === "tool_completed" || event.type === "tool_failed") {
      if (this.pendingToolCalls.length > 0) {
        this.pendingToolResults.push(event.result);
      } else {
        this.assistantParts.push({ type: "orphan_tool_result", result: cloneToolResult(event.result) });
      }
      return;
    }

    if (event.type === "turn_failed") {
      this.flushToolInteractionEntry();
      this.assistantParts.push({ type: "text", text: `\n\n[turn_failed] ${event.message}` });
    }
  }

  messages(options: ModelMessageLedgerOptions = {}): LlmMessage[] {
    const clone = this.clone();
    clone.flushToolInteractionEntry();
    clone.flushAssistantEntry();
    return clone.entries.flatMap((entry) => modelMessagesFromLedgerEntry(entry, options));
  }

  private clone(): ModelMessageLedger {
    const clone = new ModelMessageLedger();
    clone.entries.push(...this.entries.map(cloneLedgerEntry));
    for (const [key, value] of this.interactionRequests) {
      clone.interactionRequests.set(key, value);
    }
    clone.assistantParts = this.assistantParts.map(cloneAssistantPart);
    clone.reasoningText = this.reasoningText;
    clone.pendingToolCalls = this.pendingToolCalls.map(cloneToolCall);
    clone.pendingToolResults = this.pendingToolResults.map(cloneToolResult);
    return clone;
  }

  private flushAssistantEntry(): void {
    const reasoningContent = this.reasoningText.trim();
    if (this.assistantParts.length > 0 || reasoningContent) {
      this.entries.push({
        type: "assistant",
        parts: this.assistantParts.map(cloneAssistantPart),
        ...(reasoningContent ? { reasoningContent } : {})
      });
    }
    this.assistantParts = [];
    this.reasoningText = "";
  }

  private flushToolInteractionEntry(): void {
    if (this.pendingToolCalls.length === 0) {
      return;
    }

    const reasoningContent = this.reasoningText.trim();
    this.entries.push({
      type: "tool_interaction",
      parts: this.assistantParts.map(cloneAssistantPart),
      ...(reasoningContent ? { reasoningContent } : {}),
      toolCalls: this.pendingToolCalls.map(cloneToolCall),
      toolResults: this.pendingToolResults.map(cloneToolResult)
    });

    this.assistantParts = [];
    this.reasoningText = "";
    this.pendingToolCalls = [];
    this.pendingToolResults = [];
  }
}

export function modelMessagesFromEvents(events: readonly RuntimeEvent[], options: ModelMessageLedgerOptions = {}): LlmMessage[] {
  return ModelMessageLedger.fromEvents(events).messages(options);
}

function modelMessagesFromLedgerEntry(entry: ModelLedgerEntry, options: ModelMessageLedgerOptions): LlmMessage[] {
  if (entry.type === "message") {
    return [cloneLlmMessage(entry.message)];
  }

  if (entry.type === "assistant") {
    const content = assistantPartsToContent(entry.parts, options).trim();
    if (!content && !entry.reasoningContent) {
      return [];
    }
    return [{
      role: "assistant",
      content,
      ...(entry.reasoningContent ? { reasoningContent: entry.reasoningContent } : {})
    }];
  }

  const content = assistantPartsToContent(entry.parts, options).trim();
  const includeToolResults = options.includeToolResults ?? true;
  if (!includeToolResults) {
    if (!content && !entry.reasoningContent) {
      return [];
    }
    return [{
      role: "assistant",
      content,
      ...(entry.reasoningContent ? { reasoningContent: entry.reasoningContent } : {})
    }];
  }

  return [
    {
      role: "assistant",
      content,
      ...(entry.reasoningContent ? { reasoningContent: entry.reasoningContent } : {}),
      toolCalls: entry.toolCalls.map(cloneToolCall)
    },
    ...entry.toolResults.map((result) => ({
      role: "tool" as const,
      toolCallId: result.callId,
      content: serializeToolEventForLedger(result, options)
    }))
  ];
}

function subagentCompletionSummary(event: Extract<RuntimeEvent, { type: "subagent_completed" }>) {
  return [
    `[subagent_completed:${event.agentId}] ${event.name} ${event.status}`,
    event.role ? `Role: ${event.role}` : "",
    event.model ? `Model: ${event.model}` : "",
    event.summary ? `Summary: ${event.summary}` : "",
    event.error ? `Error: ${event.error}` : "",
    `Events: ${event.eventCount}`
  ].filter(Boolean).join("\n");
}

function interactionRequestSummary(event: InteractionRequestEvent) {
  const options = event.options.map((option) => {
    const recommended = option.id === event.recommendedOptionId ? " (recommended)" : "";
    const detail = option.value ?? option.description;
    return `- ${option.id}: ${option.label}${recommended}${detail ? ` = ${detail}` : ""}`;
  });
  return [
    `[interaction_requested:${event.requestId}] ${event.title}`,
    event.message,
    ...options
  ].join("\n");
}

function interactionDecisionSummary(
  event: Extract<RuntimeEvent, { type: "interaction_decided" }>,
  request: InteractionRequestEvent | undefined
) {
  if (event.decision.type === "custom") {
    return `[interaction_decided:${event.requestId}] User provided custom input: ${event.decision.customText}`;
  }

  const decision = event.decision;
  const option = request?.options.find((candidate) => candidate.id === decision.optionId);
  const value = decision.value ?? option?.value ?? option?.label ?? decision.optionId;
  return `[interaction_decided:${event.requestId}] User selected ${decision.optionId}: ${value}`;
}

function serializeToolEventForLedger(result: ToolResult, options: ModelMessageLedgerOptions = {}) {
  const modelResult = result.artifactId ? summarizeArtifactResult(result) : result;
  const serialized = serializeToolResultForModel(modelResult);
  return options.toolResultMaxChars === undefined
    ? serialized
    : truncateText(serialized, Math.max(0, options.toolResultMaxChars));
}

function summarizeArtifactResult(result: ToolResult): ToolResult {
  const output = typeof result.output === "object" && result.output !== null
    ? result.output as Record<string, unknown>
    : undefined;
  return {
    callId: result.callId,
    ok: result.ok,
    artifactId: result.artifactId,
    error: result.error,
    output: {
      artifactSummary: typeof output?.artifactSummary === "string" ? output.artifactSummary : undefined,
      outputKeys: output ? Object.keys(output) : [],
      stdoutTruncated: output?.stdoutTruncated,
      stderrTruncated: output?.stderrTruncated,
      contentTruncated: output?.contentTruncated
    }
  };
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

function cloneLedgerEntry(entry: ModelLedgerEntry): ModelLedgerEntry {
  if (entry.type === "message") {
    return { type: "message", message: cloneLlmMessage(entry.message) };
  }
  if (entry.type === "assistant") {
    return {
      type: "assistant",
      parts: entry.parts.map(cloneAssistantPart),
      ...(entry.reasoningContent ? { reasoningContent: entry.reasoningContent } : {})
    };
  }
  return {
    type: "tool_interaction",
    parts: entry.parts.map(cloneAssistantPart),
    ...(entry.reasoningContent ? { reasoningContent: entry.reasoningContent } : {}),
    toolCalls: entry.toolCalls.map(cloneToolCall),
    toolResults: entry.toolResults.map(cloneToolResult)
  };
}

function assistantPartsToContent(parts: AssistantPart[], options: ModelMessageLedgerOptions) {
  const includeToolResults = options.includeToolResults ?? true;
  return parts.map((part) => {
    if (part.type === "text") {
      return part.text;
    }
    if (!includeToolResults) {
      return "";
    }
    return `\n\n[tool:${part.result.callId}] ${serializeToolEventForLedger(part.result, options)}`;
  }).join("");
}

function cloneAssistantPart(part: AssistantPart): AssistantPart {
  if (part.type === "text") {
    return { ...part };
  }
  return { type: "orphan_tool_result", result: cloneToolResult(part.result) };
}

function cloneLlmMessage(message: LlmMessage): LlmMessage {
  return {
    ...message,
    ...(message.toolCalls ? { toolCalls: message.toolCalls.map(cloneToolCall) } : {})
  };
}

function cloneToolCall(call: ToolCall): ToolCall {
  return {
    ...call,
    input: cloneJsonLike(call.input)
  };
}

function cloneToolResult(result: ToolResult): ToolResult {
  return {
    ...result,
    output: cloneJsonLike(result.output),
    error: result.error ? { ...result.error } : undefined
  };
}

function cloneJsonLike<T>(value: T): T {
  if (value === undefined || value === null || typeof value !== "object") {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}
