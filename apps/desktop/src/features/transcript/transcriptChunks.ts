import type { RuntimeEvent } from "@seekforge/protocol";
import { deriveToolCards, type ToolCardState } from "../tools/toolCards";
import {
  getToolDisplayName,
  getToolHumanSummary,
  toolStatusText
} from "../tools/toolPresentation";

export type PersistedTranscriptMessage = {
  id: string;
  message: { id: string; role: "user" | "assistant" | "failure"; text: string };
  type: "message";
};

export type PersistedTranscriptContextHint = {
  fileCount: number;
  id: string;
  message: string;
  paths: string[];
  status: "hit";
  type: "context_hint";
};

export type PersistedTranscriptReasoning = {
  block: { id: string; text: string };
  id: string;
  type: "reasoning";
};

export type PersistedTranscriptToolSummary = {
  callId: string;
  displayName: string;
  id: string;
  name: string;
  status: ToolCardState["status"];
  statusText: string;
  summary: string;
  type: "tool_summary";
};

export type PersistedTranscriptActivitySummary = {
  failedCount: number;
  id: string;
  reasoningCount: number;
  runningCount: number;
  summary: string;
  tools: Omit<PersistedTranscriptToolSummary, "id" | "type">[];
  type: "activity_summary";
};

export type PersistedTranscriptItem =
  | PersistedTranscriptMessage
  | PersistedTranscriptContextHint
  | PersistedTranscriptReasoning
  | PersistedTranscriptToolSummary
  | PersistedTranscriptActivitySummary;

export type TranscriptItemChunk = {
  id: string;
  index: number;
  itemCount: number;
  items: PersistedTranscriptItem[];
};

export type TranscriptChunkBundle = {
  chunkSize: number;
  chunks: TranscriptItemChunk[];
  threadId: string;
  totalItemCount: number;
  updatedAt: string;
  version: 1;
};

export type TranscriptTailLoad = {
  chunk: TranscriptItemChunk | null;
  hiddenItemCount: number;
  previousChunkIndex?: number | null;
  totalItemCount: number;
};

export type TranscriptHistoryGapItem = {
  hiddenItemCount: number;
  id: string;
  previousChunkIndex?: number | null;
  type: "history_gap";
};

const DEFAULT_CHUNK_SIZE = 80;
const DEFAULT_RECENT_EVENT_WINDOW = 360;
const MAX_REASONING_CHARS = 1_600;
const MAX_TOOL_SUMMARY_CHARS = 1_200;
const MAX_ACTIVITY_TOOLS = 8;

export function buildTranscriptChunkBundle(
  threadId: string,
  events: RuntimeEvent[],
  options: { chunkSize?: number } = {}
): TranscriptChunkBundle {
  const chunkSize = Math.max(1, options.chunkSize ?? DEFAULT_CHUNK_SIZE);
  const items = derivePersistedTranscriptItems(events);
  const chunks: TranscriptItemChunk[] = [];

  for (let start = 0; start < items.length; start += chunkSize) {
    const index = chunks.length;
    const chunkItems = items.slice(start, start + chunkSize);
    chunks.push({
      id: `chunk-${String(index).padStart(6, "0")}`,
      index,
      itemCount: chunkItems.length,
      items: chunkItems
    });
  }

  return {
    chunkSize,
    chunks,
    threadId,
    totalItemCount: items.length,
    updatedAt: events[events.length - 1]?.createdAt ?? new Date().toISOString(),
    version: 1
  };
}

export function transcriptItemsFromTail(tail: TranscriptTailLoad | null): Array<PersistedTranscriptItem | TranscriptHistoryGapItem> {
  if (!tail?.chunk) {
    return [];
  }
  if (tail.hiddenItemCount <= 0) {
    return tail.chunk.items;
  }
  return [
    {
      hiddenItemCount: tail.hiddenItemCount,
      id: `history-gap:${tail.hiddenItemCount}`,
      previousChunkIndex: tail.previousChunkIndex ?? null,
      type: "history_gap"
    },
    ...tail.chunk.items
  ];
}

export function transcriptItemsFromRecentEvents(
  events: RuntimeEvent[],
  options: { maxEvents?: number } = {}
): Array<PersistedTranscriptItem | TranscriptHistoryGapItem> {
  const maxEvents = Math.max(1, options.maxEvents ?? DEFAULT_RECENT_EVENT_WINDOW);
  if (events.length <= maxEvents) {
    return derivePersistedTranscriptItems(events);
  }

  const tailEvents = events.slice(events.length - maxEvents);
  const items = derivePersistedTranscriptItems(tailEvents);
  if (items.length === 0) {
    return [];
  }

  const hiddenEventCount = events.length - tailEvents.length;
  return [
    {
      hiddenItemCount: hiddenEventCount,
      id: `history-gap:events:${hiddenEventCount}:${tailEvents[0]?.id ?? "tail"}`,
      previousChunkIndex: null,
      type: "history_gap"
    },
    ...items
  ];
}

export function derivePersistedTranscriptItems(events: RuntimeEvent[]): PersistedTranscriptItem[] {
  const items: PersistedTranscriptItem[] = [];
  const cards = new Map(deriveToolCards(events).map((card) => [card.id, card]));
  const seenToolCards = new Set<string>();
  let assistantText = "";
  let assistantId: string | null = null;
  let reasoningText = "";
  let reasoningId: string | null = null;
  let activityGroup: PersistedActivityGroup | null = null;

  const flushActivity = () => {
    if (activityGroup && (activityGroup.reasoning.length > 0 || activityGroup.tools.length > 0)) {
      if (activityGroup.reasoning.length === 1 && activityGroup.tools.length === 0) {
        items.push({
          id: `reasoning:${activityGroup.reasoning[0].id}`,
          type: "reasoning",
          block: activityGroup.reasoning[0]
        });
      } else if (activityGroup.reasoning.length === 0 && activityGroup.tools.length === 1) {
        items.push(activityGroup.tools[0]);
      } else {
        items.push(activitySummary(activityGroup));
      }
    }
    activityGroup = null;
  };

  const flushAssistant = () => {
    const text = assistantText.trim();
    if (text && assistantId) {
      flushActivity();
      items.push({
        id: `message:${assistantId}`,
        type: "message",
        message: { id: assistantId, role: "assistant", text }
      });
    }
    assistantText = "";
    assistantId = null;
  };

  const flushReasoning = () => {
    const text = compactLongText(reasoningText.trim(), MAX_REASONING_CHARS);
    if (text && reasoningId) {
      activityGroup ??= { id: reasoningId, reasoning: [], tools: [] };
      activityGroup.reasoning.push({ id: reasoningId, text });
    }
    reasoningText = "";
    reasoningId = null;
  };

  const pushToolCard = (turnId: string, callId: string, options: { groupable?: boolean } = {}) => {
    const id = `${turnId}:${callId}`;
    const card = cards.get(id);
    if (!card || seenToolCards.has(id)) {
      return;
    }

    seenToolCards.add(id);
    const summary = toolSummary(card);
    if (options.groupable && isGroupableToolCard(card)) {
      activityGroup ??= { id, reasoning: [], tools: [] };
      activityGroup.tools.push(summary);
      return;
    }
    flushActivity();
    items.push(summary);
  };

  for (const event of events) {
    if (event.type === "user_message") {
      flushAssistant();
      flushReasoning();
      flushActivity();
      items.push({
        id: `message:${event.id}`,
        type: "message",
        message: { id: event.id, role: "user", text: event.text }
      });
      continue;
    }

    if (event.type === "codebase_context") {
      flushAssistant();
      flushReasoning();
      flushActivity();
      if (event.status === "hit") {
        items.push({
          fileCount: event.fileCount,
          id: `context:${event.id}`,
          message: event.message,
          paths: event.paths,
          status: "hit",
          type: "context_hint"
        });
      }
      continue;
    }

    if (event.type === "assistant_delta" || event.type === "assistant_message") {
      flushReasoning();
      flushActivity();
      assistantId ??= event.id;
      assistantText += event.text;
      continue;
    }

    if (event.type === "reasoning_delta") {
      flushAssistant();
      reasoningId ??= event.id;
      reasoningText += event.text;
      continue;
    }

    if (event.type === "tool_call_requested" || event.type === "approval_requested" || event.type === "tool_started") {
      flushAssistant();
      flushReasoning();
      pushToolCard(event.turnId, event.call.id, { groupable: true });
      continue;
    }

    if (event.type === "approval_decided") {
      flushAssistant();
      flushReasoning();
      pushToolCard(event.turnId, event.decision.callId);
      continue;
    }

    if (event.type === "tool_completed" || event.type === "tool_failed") {
      flushAssistant();
      flushReasoning();
      pushToolCard(event.turnId, event.result.callId, { groupable: true });
      continue;
    }

    if (event.type === "loop_guard") {
      flushAssistant();
      flushReasoning();
      flushActivity();
      items.push({
        id: `message:${event.id}`,
        type: "message",
        message: { id: event.id, role: event.level === "blocked" ? "failure" : "assistant", text: event.message }
      });
      continue;
    }

    if (event.type === "subagent_completed") {
      flushAssistant();
      flushReasoning();
      flushActivity();
      items.push({
        id: `message:${event.id}`,
        type: "message",
        message: {
          id: event.id,
          role: event.status === "completed" ? "assistant" : "failure",
          text: subagentCompletedText(event)
        }
      });
      continue;
    }

    if (event.type === "turn_failed") {
      flushAssistant();
      flushReasoning();
      flushActivity();
      items.push({
        id: `message:${event.id}`,
        type: "message",
        message: { id: event.id, role: "failure", text: friendlyTurnFailureMessage(event.message) }
      });
    }
  }

  flushAssistant();
  flushReasoning();
  flushActivity();
  return items;
}

type PersistedActivityGroup = {
  id: string;
  reasoning: Array<{ id: string; text: string }>;
  tools: PersistedTranscriptToolSummary[];
};

function toolSummary(card: ToolCardState): PersistedTranscriptToolSummary {
  return {
    callId: card.callId,
    displayName: getToolDisplayName(card),
    id: `tool:${card.id}`,
    name: card.name,
    status: card.status,
    statusText: toolStatusText(card.status),
    summary: compactLongText(getToolHumanSummary(card), MAX_TOOL_SUMMARY_CHARS),
    type: "tool_summary"
  };
}

function activitySummary(group: PersistedActivityGroup): PersistedTranscriptActivitySummary {
  const failedCount = group.tools.filter((tool) => tool.status === "failed").length;
  const runningCount = group.tools.filter((tool) => tool.status === "running" || tool.status === "requested").length;
  const summaryParts = [
    group.tools.length > 0 ? toolActivitySummary(group.tools) : null,
    group.reasoning.length > 0 ? `${group.reasoning.length} 次思考` : null,
    failedCount > 0 ? `${failedCount} 个失败` : null,
    runningCount > 0 ? `${runningCount} 个进行中` : null
  ].filter(Boolean);

  return {
    failedCount,
    id: `activity:${group.id}`,
    reasoningCount: group.reasoning.length,
    runningCount,
    summary: summaryParts.join(" · "),
    tools: group.tools.slice(0, MAX_ACTIVITY_TOOLS).map(compactToolForActivity),
    type: "activity_summary"
  };
}

function compactToolForActivity(tool: PersistedTranscriptToolSummary): Omit<PersistedTranscriptToolSummary, "id" | "type"> {
  return {
    callId: tool.callId,
    displayName: tool.displayName,
    name: tool.name,
    status: tool.status,
    statusText: tool.statusText,
    summary: tool.summary
  };
}

function toolActivitySummary(tools: Array<Pick<PersistedTranscriptToolSummary, "name">>) {
  const readCount = tools.filter((tool) => tool.name === "read_file").length;
  const listCount = tools.filter((tool) => tool.name === "list_dir").length;
  const searchCount = tools.filter((tool) => ["grep_files", "search_files", "tool_search"].includes(tool.name)).length;
  const otherCount = tools.length - readCount - listCount - searchCount;
  const parts = [
    readCount > 0 ? `读取 ${readCount} 个文件` : null,
    listCount > 0 ? `查看 ${listCount} 个目录` : null,
    searchCount > 0 ? `搜索 ${searchCount} 次` : null,
    otherCount > 0 ? `${otherCount} 个工具` : null
  ].filter(Boolean);
  return parts.join("，");
}

function isGroupableToolCard(card: ToolCardState) {
  if (card.status === "approval" || card.status === "failed") {
    return false;
  }
  return [
    "read_file",
    "list_dir",
    "grep_files",
    "search_files",
    "tool_search",
    "git_status",
    "git_diff",
    "lsp_diagnostics",
    "lsp_definition",
    "mcp_list_tools"
  ].includes(card.name);
}

function compactLongText(text: string, maxChars: number) {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars).trimEnd()}\n...`;
}

function subagentCompletedText(event: Extract<RuntimeEvent, { type: "subagent_completed" }>) {
  const statusText = event.status === "completed" ? "已完成" : event.status === "canceled" ? "已取消" : "失败";
  const role = subagentRoleLabel(event.role);
  const roleText = role ? `（${role}）` : "";
  const modelText = event.model ? ` · ${event.model}` : "";
  const summary = event.summary ? `：${event.summary}` : "";
  return `子任务 ${event.name}${roleText}${modelText} ${statusText}${summary}`;
}

function subagentRoleLabel(role: Extract<RuntimeEvent, { type: "subagent_completed" }>["role"]) {
  switch (role) {
    case "explorer":
      return "探索";
    case "worker":
      return "执行";
    case "reviewer":
      return "评审";
    case "general":
      return "通用";
    default:
      return "";
  }
}

function friendlyTurnFailureMessage(message: string) {
  if (/turn was stopped by the user/i.test(message)) {
    return "已停止当前任务。";
  }
  return message;
}
