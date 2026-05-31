import type { LlmMessage, LlmToolDefinition } from "./llm";
import { requestSegment, type RequestSegment, type RequestSegmentName } from "./segment-hash";
import { stableHash } from "./stable-json";

export interface AssembleRequestInput {
  systemPrompt?: string;
  projectContext?: string;
  history?: LlmMessage[];
  userText: string;
  tools?: LlmToolDefinition[];
}

export interface AssembledRequest {
  messages: LlmMessage[];
  tools?: LlmToolDefinition[];
  segments: RequestSegment[];
  prefixHash: string;
  promptHash: string;
}

export type RequestSegmentDiffReason =
  | "first_request"
  | "none"
  | "core_changed"
  | "tool_changed"
  | "project_changed"
  | "ledger_changed"
  | "dynamic_tail_changed";

export interface RequestSegmentDiff {
  name: RequestSegmentName;
  label: string;
  previousHash?: string;
  currentHash: string;
  changed: boolean;
  breaksPrefix: boolean;
  reason: RequestSegmentDiffReason;
  message: string;
}

export interface RequestSegmentDiffSummary {
  reason: RequestSegmentDiffReason;
  message: string;
  breaksPrefix: boolean;
  changedSegments: RequestSegmentDiff[];
  allSegments: RequestSegmentDiff[];
}

export interface AppendOnlyPrefixCheck {
  ok: boolean;
  reason: "ok" | "tool_prefix_changed" | "message_rewritten" | "message_removed";
  message: string;
  mismatchIndex?: number;
}

export function assembleRequest(input: AssembleRequestInput): AssembledRequest {
  const systemPrompt = input.systemPrompt?.trim();
  const projectContext = input.projectContext?.trim();
  const messages: LlmMessage[] = [
    ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
    ...(projectContext ? [{ role: "system" as const, content: projectContext }] : []),
    ...(input.history ?? []),
    { role: "user", content: input.userText }
  ];
  const tools = sortToolDefinitions(input.tools);

  return {
    messages,
    tools,
    segments: buildRequestSegments(messages, tools),
    prefixHash: requestPrefixHash(messages, tools),
    promptHash: requestPromptHash(messages, tools)
  };
}

export function buildRequestSegments(messages: LlmMessage[], tools?: LlmToolDefinition[]): RequestSegment[] {
  const grouped = groupRequestMessages(messages);
  const sortedTools = sortToolDefinitions(tools) ?? [];
  return [
    requestSegment("core_prefix", "Core Prefix", grouped.corePrefix.map(toCanonicalRequestMessage), true, true),
    requestSegment("tool_prefix", "Tool Prefix", sortedTools, true, true),
    requestSegment("project_snapshot", "Project Snapshot", grouped.projectSnapshot.map(toCanonicalRequestMessage), true, true),
    requestSegment("conversation_ledger", "Conversation Ledger", grouped.conversationLedger.map(toCanonicalRequestMessage), true, false),
    requestSegment("dynamic_tail", "Dynamic Tail", grouped.dynamicTail.map(toCanonicalRequestMessage), false, false)
  ];
}

export function diffRequestSegments(
  previousSegments: readonly RequestSegment[] | undefined,
  currentSegments: readonly RequestSegment[]
): RequestSegmentDiffSummary {
  if (!previousSegments?.length) {
    return {
      reason: "first_request",
      message: "首次请求，没有上一轮 request metadata 可对比。",
      breaksPrefix: false,
      changedSegments: [],
      allSegments: currentSegments.map((segment) => ({
        name: segment.name,
        label: segment.label,
        currentHash: segment.hash,
        changed: false,
        breaksPrefix: false,
        reason: "first_request",
        message: "首次记录。"
      }))
    };
  }

  const previousByName = new Map(previousSegments.map((segment) => [segment.name, segment]));
  const allSegments = currentSegments.map((segment) => {
    const previous = previousByName.get(segment.name);
    const changed = Boolean(previous && previous.hash !== segment.hash);
    const breaksPrefix = Boolean(changed && segment.includedInPrefix && segment.name !== "conversation_ledger");
    const reason = changed ? reasonForSegment(segment.name) : "none";
    return {
      name: segment.name,
      label: segment.label,
      previousHash: previous?.hash,
      currentHash: segment.hash,
      changed,
      breaksPrefix,
      reason,
      message: changed ? messageForSegment(segment.name, breaksPrefix) : "未变化。"
    };
  });
  const changedSegments = allSegments.filter((segment) => segment.changed);
  const prefixBreakingSegment = changedSegments.find((segment) => segment.breaksPrefix);
  const dynamicSegment = changedSegments.find((segment) => segment.reason === "dynamic_tail_changed");

  if (prefixBreakingSegment) {
    return {
      reason: prefixBreakingSegment.reason,
      message: prefixBreakingSegment.message,
      breaksPrefix: true,
      changedSegments,
      allSegments
    };
  }

  if (dynamicSegment) {
    return {
      reason: dynamicSegment.reason,
      message: dynamicSegment.message,
      breaksPrefix: false,
      changedSegments,
      allSegments
    };
  }

  return {
    reason: "none",
    message: "缓存基线稳定，只有非 prefix 内容变化或没有变化。",
    breaksPrefix: false,
    changedSegments,
    allSegments
  };
}

export function checkAppendOnlyRequestPrefix(
  previous: Pick<AssembledRequest, "messages" | "tools">,
  current: Pick<AssembledRequest, "messages" | "tools">
): AppendOnlyPrefixCheck {
  if (stableHash(previous.tools ?? []) !== stableHash(current.tools ?? [])) {
    return {
      ok: false,
      reason: "tool_prefix_changed",
      message: "Tool Prefix changed between requests."
    };
  }

  if (current.messages.length < previous.messages.length) {
    return {
      ok: false,
      reason: "message_removed",
      message: "Current request has fewer messages than previous request."
    };
  }

  for (let index = 0; index < previous.messages.length; index += 1) {
    const previousMessage = stableHash(toCanonicalRequestMessage(previous.messages[index]));
    const currentMessage = stableHash(toCanonicalRequestMessage(current.messages[index]));
    if (previousMessage !== currentMessage) {
      return {
        ok: false,
        reason: "message_rewritten",
        message: `Request message ${index} changed instead of being preserved as an append-only prefix.`,
        mismatchIndex: index
      };
    }
  }

  return {
    ok: true,
    reason: "ok",
    message: "Current request preserves the previous request as an append-only prefix."
  };
}

export function assertAppendOnlyRequestPrefix(
  previous: Pick<AssembledRequest, "messages" | "tools">,
  current: Pick<AssembledRequest, "messages" | "tools">
): void {
  const check = checkAppendOnlyRequestPrefix(previous, current);
  if (!check.ok) {
    throw new Error(`Prefix invariant failed: ${check.message}`);
  }
}

export function checkStableRequestPrefixSegments(
  previous: Pick<AssembledRequest, "messages" | "tools">,
  current: Pick<AssembledRequest, "messages" | "tools">
): AppendOnlyPrefixCheck {
  const diff = diffRequestSegments(
    buildRequestSegments(previous.messages, previous.tools),
    buildRequestSegments(current.messages, current.tools)
  );
  const breakingSegment = diff.changedSegments.find((segment) => segment.breaksPrefix);

  if (!breakingSegment) {
    return {
      ok: true,
      reason: "ok",
      message: "Current request preserves stable prefix segments."
    };
  }

  return {
    ok: false,
    reason: breakingSegment.name === "tool_prefix" ? "tool_prefix_changed" : "message_rewritten",
    message: `${breakingSegment.label} changed instead of being preserved as a stable prefix segment.`
  };
}

export function assertStableRequestPrefixSegments(
  previous: Pick<AssembledRequest, "messages" | "tools">,
  current: Pick<AssembledRequest, "messages" | "tools">
): void {
  const check = checkStableRequestPrefixSegments(previous, current);
  if (!check.ok) {
    throw new Error(`Prefix invariant failed: ${check.message}`);
  }
}

export function requestPrefixHash(messages: LlmMessage[], tools?: LlmToolDefinition[]): string {
  return stableHash({
    messages: messages.slice(0, -1).map(toCanonicalRequestMessage),
    tools: sortToolDefinitions(tools) ?? []
  });
}

export function requestPromptHash(messages: LlmMessage[], tools?: LlmToolDefinition[]): string {
  return stableHash({
    messages: messages.map(toCanonicalRequestMessage),
    tools: sortToolDefinitions(tools) ?? undefined
  });
}

export function sortToolDefinitions(tools?: LlmToolDefinition[]): LlmToolDefinition[] | undefined {
  if (!tools?.length) {
    return undefined;
  }
  return tools.slice().sort((left, right) => left.function.name.localeCompare(right.function.name));
}

export function toCanonicalRequestMessage(message: LlmMessage): Record<string, unknown> {
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      content: message.content
    };
  }

  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant",
      content: message.content || null,
      reasoning_content: message.reasoningContent,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: {
          name: call.name,
          arguments: JSON.stringify(call.input ?? {})
        }
      }))
    };
  }

  return {
    role: message.role,
    content: message.content,
    reasoning_content: message.reasoningContent
  };
}

function groupRequestMessages(messages: LlmMessage[]) {
  let cursor = 0;
  const corePrefix: LlmMessage[] = [];
  const projectSnapshot: LlmMessage[] = [];

  if (messages[cursor]?.role === "system") {
    corePrefix.push(messages[cursor]);
    cursor += 1;
  }

  while (messages[cursor]?.role === "system") {
    projectSnapshot.push(messages[cursor]);
    cursor += 1;
  }

  const dynamicTail = messages.length > 0 ? [messages[messages.length - 1]] : [];
  const ledgerEnd = Math.max(cursor, messages.length - 1);
  return {
    corePrefix,
    projectSnapshot,
    conversationLedger: messages.slice(cursor, ledgerEnd),
    dynamicTail
  };
}

function reasonForSegment(name: RequestSegmentName): RequestSegmentDiffReason {
  switch (name) {
    case "core_prefix":
      return "core_changed";
    case "tool_prefix":
      return "tool_changed";
    case "project_snapshot":
      return "project_changed";
    case "conversation_ledger":
      return "ledger_changed";
    case "dynamic_tail":
      return "dynamic_tail_changed";
  }
}

function messageForSegment(name: RequestSegmentName, breaksPrefix: boolean): string {
  switch (name) {
    case "core_prefix":
      return "Core Prefix 变化，通常由 system prompt、模式或 DeepSeek 规则变化导致。";
    case "tool_prefix":
      return "Tool Prefix 变化，可能由内置工具、MCP 工具 schema 或工具排序变化导致。";
    case "project_snapshot":
      return "Project Snapshot 变化，可能由 workspace、项目指令或项目上下文快照变化导致。";
    case "conversation_ledger":
      return "Conversation Ledger 变化，可能是正常追加，也可能是历史被重写；需要结合 request prefix 检查。";
    case "dynamic_tail":
      return breaksPrefix
        ? "Dynamic Tail 变化并进入 prefix，请检查分层配置。"
        : "Dynamic Tail 变化，通常只是当前用户输入变化，不会破坏稳定 prefix。";
  }
}
