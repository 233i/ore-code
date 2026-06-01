import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { ChevronDownIcon, FolderIcon, PlayCircleIcon } from "tdesign-icons-react";
import type { RuntimeEvent } from "@ore-code/protocol";
import type {
  PersistedTranscriptActivitySummary,
  PersistedTranscriptContextHint,
  PersistedTranscriptItem,
  PersistedTranscriptToolSummary,
  TranscriptHistoryGapItem
} from "../features/transcript/transcriptChunks";
import type { ToolCardState } from "../features/tools/toolCards";
import {
  getToolDisplayName,
  getToolHumanSummary,
  toolStatusText
} from "../features/tools/toolPresentation";
import { MessageActions } from "./MessageActions";
import { MarkdownView } from "./MarkdownView";
import { ReasoningPanel, type ReasoningBlock } from "./ReasoningPanel";
import { ToolCard } from "./ToolCard";
import type { MessageFeedback } from "./composerTypes";

export type TranscriptMessage = { id: string; role: "user" | "assistant" | "failure"; text: string };
export type ActivityGroup = { id: string; reasoning: ReasoningBlock[]; tools: ToolCardState[] };
export type TranscriptItem =
  | PersistedTranscriptItem
  | TranscriptHistoryGapItem
  | { id: string; type: "message"; message: TranscriptMessage }
  | { id: string; type: "context"; context: Extract<RuntimeEvent, { type: "codebase_context" }> }
  | { id: string; type: "reasoning"; block: ReasoningBlock }
  | { id: string; type: "tool"; card: ToolCardState }
  | { id: string; type: "activity"; group: ActivityGroup };

type TranscriptProps = {
  children?: ReactNode;
  currentWorkspaceLabel: string;
  hasWorkspace: boolean;
  isRunning: boolean;
  items: TranscriptItem[];
  loadingEarlier?: boolean;
  messageFeedback: Record<string, MessageFeedback>;
  onCopyMessage: (text: string) => void;
  onExpandMessage: (message: TranscriptMessage) => void;
  onLoadEarlier?: (gap: TranscriptHistoryGapItem) => void;
  onOpenArtifact: (artifactId: string) => void;
  onOpenWorkspaceDialog: () => void;
  onRunStarter: (prompt: string) => void;
  onToggleMessageFeedback: (messageId: string, feedback: Exclude<MessageFeedback, null>) => void;
  scrollKey?: string;
};

export function Transcript({
  children,
  currentWorkspaceLabel,
  hasWorkspace,
  isRunning,
  items,
  loadingEarlier = false,
  messageFeedback,
  onCopyMessage,
  onExpandMessage,
  onLoadEarlier,
  onOpenArtifact,
  onOpenWorkspaceDialog,
  onRunStarter,
  onToggleMessageFeedback,
  scrollKey
}: TranscriptProps) {
  const isEmpty = items.length === 0;
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const shouldFollowOutputRef = useRef(true);
  const lastScrollKeyRef = useRef<string | undefined>(scrollKey);
  const lastItemKeyRef = useRef("");
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);

  useLayoutEffect(() => {
    if (scrollKey === undefined || items.length === 0) {
      return;
    }

    shouldFollowOutputRef.current = true;
    setShowJumpToBottom(false);
    const scrollToBottom = () => {
      virtuosoRef.current?.scrollToIndex({ align: "end", behavior: "auto", index: items.length - 1 });
    };
    const animationFrame = window.requestAnimationFrame(scrollToBottom);
    const immediateTimer = window.setTimeout(scrollToBottom, 0);
    const settledTimer = window.setTimeout(scrollToBottom, 80);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(immediateTimer);
      window.clearTimeout(settledTimer);
    };
  }, [items.length, scrollKey]);

  useLayoutEffect(() => {
    const itemKey = transcriptTailKey(items);
    const scrollKeyChanged = lastScrollKeyRef.current !== scrollKey;
    const itemsChanged = lastItemKeyRef.current !== itemKey;
    lastScrollKeyRef.current = scrollKey;
    lastItemKeyRef.current = itemKey;

    if (!itemsChanged || scrollKeyChanged) {
      return;
    }

    if (!shouldFollowOutputRef.current) {
      setShowJumpToBottom(true);
      return;
    }

    const scrollToBottom = () => {
      virtuosoRef.current?.scrollToIndex({ align: "end", behavior: "auto", index: Math.max(0, items.length - 1) });
    };
    const animationFrame = window.requestAnimationFrame(scrollToBottom);

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [items, scrollKey]);

  return (
    <div className="transcript-shell">
      {isEmpty ? (
        <section className="transcript" aria-label="Transcript">
          <TranscriptEmptyState
            currentWorkspaceLabel={currentWorkspaceLabel}
            hasWorkspace={hasWorkspace}
            isRunning={isRunning}
            onOpenWorkspaceDialog={onOpenWorkspaceDialog}
            onRunStarter={onRunStarter}
          />
          {children}
        </section>
      ) : (
        <Virtuoso
          alignToBottom
          atBottomStateChange={handleAtBottomStateChange}
          className="transcript transcript-virtuoso"
          computeItemKey={(_index, item) => item.id}
          components={{
            Footer: () => <div className="transcript-virtual-footer">{children}</div>
          }}
          data={items}
          followOutput={(isAtBottom) => (isAtBottom ? "auto" : false)}
          increaseViewportBy={{ bottom: 360, top: 360 }}
          initialTopMostItemIndex={Math.max(0, items.length - 1)}
          itemContent={(_index, item) => (
            <TranscriptItemView
              item={item}
              loadingEarlier={loadingEarlier}
              messageFeedback={messageFeedback}
              onCopyMessage={onCopyMessage}
              onExpandMessage={onExpandMessage}
              onLoadEarlier={onLoadEarlier}
              onOpenArtifact={onOpenArtifact}
              onToggleMessageFeedback={onToggleMessageFeedback}
            />
          )}
          key={scrollKey ?? "default"}
          ref={virtuosoRef}
        />
      )}
      {showJumpToBottom ? (
        <button className="transcript-jump-bottom" type="button" onClick={jumpToBottom}>
          <ChevronDownIcon size="15px" />
          <span>跳到底部</span>
        </button>
      ) : null}
    </div>
  );

  function handleAtBottomStateChange(atBottom: boolean) {
    shouldFollowOutputRef.current = atBottom;
    if (atBottom) {
      setShowJumpToBottom(false);
    }
  }

  function jumpToBottom() {
    if (items.length === 0) {
      return;
    }
    shouldFollowOutputRef.current = true;
    virtuosoRef.current?.scrollToIndex({ align: "end", behavior: "auto", index: items.length - 1 });
    setShowJumpToBottom(false);
  }
}

function transcriptTailKey(items: TranscriptItem[]): string {
  const item = items[items.length - 1];
  if (!item) {
    return "empty";
  }
  if (item.type === "message") {
    return `${item.id}:${item.message.text.length}`;
  }
  if (item.type === "reasoning") {
    return `${item.id}:${item.block.text.length}`;
  }
  if (item.type === "context") {
    return `${item.id}:${item.context.status}:${item.context.fileCount}`;
  }
  if (item.type === "context_hint") {
    return `${item.id}:${item.status}:${item.fileCount}`;
  }
  if (item.type === "activity") {
    const toolKey = item.group.tools.map((tool) => `${tool.id}:${tool.status}`).join("|");
    const reasoningChars = item.group.reasoning.reduce((total, block) => total + block.text.length, 0);
    return `${item.id}:${reasoningChars}:${toolKey}`;
  }
  if (item.type === "activity_summary") {
    return `${item.id}:${item.summary}:${item.runningCount}:${item.failedCount}`;
  }
  if (item.type === "tool_summary") {
    return `${item.id}:${item.status}:${item.summary.length}`;
  }
  if (item.type === "history_gap") {
    return `${item.id}:${item.hiddenItemCount}`;
  }
  return `${item.id}:${item.card.status}`;
}

function TranscriptItemView({
  item,
  loadingEarlier,
  messageFeedback,
  onCopyMessage,
  onExpandMessage,
  onLoadEarlier,
  onOpenArtifact,
  onToggleMessageFeedback
}: {
  item: TranscriptItem;
  loadingEarlier: boolean;
  messageFeedback: Record<string, MessageFeedback>;
  onCopyMessage: (text: string) => void;
  onExpandMessage: (message: TranscriptMessage) => void;
  onLoadEarlier?: (gap: TranscriptHistoryGapItem) => void;
  onOpenArtifact: (artifactId: string) => void;
  onToggleMessageFeedback: (messageId: string, feedback: Exclude<MessageFeedback, null>) => void;
}) {
  if (item.type === "reasoning") {
    return <ReasoningPanel block={item.block} />;
  }

  if (item.type === "tool") {
    return <ToolCard card={item.card} onOpenArtifact={onOpenArtifact} />;
  }

  if (item.type === "tool_summary") {
    return <ToolSummaryCard tool={item} />;
  }

  if (item.type === "activity") {
    return <ActivityGroupPanel group={item.group} />;
  }

  if (item.type === "activity_summary") {
    return <ActivitySummaryPanel activity={item} />;
  }

  if (item.type === "context") {
    return <CodebaseContextHint event={item.context} />;
  }

  if (item.type === "context_hint") {
    return <CodebaseContextHint event={item} />;
  }

  if (item.type === "history_gap") {
    return <HistoryGapNotice gap={item} loading={loadingEarlier} onLoadEarlier={onLoadEarlier} />;
  }

  const message = item.message;
  return (
    <article className={`message ${message.role}`}>
      {message.role === "assistant" ? <MarkdownView content={message.text} /> : message.text}
      {message.role === "assistant" ? (
        <MessageActions
          feedback={messageFeedback[message.id] ?? null}
          onCopy={() => onCopyMessage(message.text)}
          onDislike={() => onToggleMessageFeedback(message.id, "disliked")}
          onExpand={() => onExpandMessage(message)}
          onLike={() => onToggleMessageFeedback(message.id, "liked")}
        />
      ) : null}
    </article>
  );
}

function ToolSummaryCard({ tool }: { tool: PersistedTranscriptToolSummary }) {
  return (
    <section className={`tool-card transcript-event ${tool.status}`}>
      <div className="tool-card-heading">
        <span className={`event-dot${tool.status === "running" || tool.status === "requested" ? " running" : tool.status === "failed" ? " failed" : ""}`} aria-hidden="true" />
        <span className="tool-card-title">{tool.displayName}</span>
        <span className="tool-card-status">{tool.statusText}</span>
      </div>
      <div className="tool-card-body">
        <p>{tool.summary}</p>
      </div>
    </section>
  );
}

function ActivitySummaryPanel({ activity }: { activity: PersistedTranscriptActivitySummary }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section className={`activity-group transcript-event${activity.failedCount > 0 ? " failed" : ""}`}>
      <button className="event-row-button activity-row-button" type="button" onClick={() => setExpanded((current) => !current)}>
        <span className="event-row-title">
          <span className={`event-dot${activity.runningCount > 0 ? " running" : activity.failedCount > 0 ? " failed" : ""}`} aria-hidden="true" />
          <span className="activity-title">工作进展</span>
          <span className="activity-summary">{activity.summary}</span>
        </span>
        <span className="event-row-meta">{expanded ? "收起" : "展开"}</span>
      </button>
      {expanded ? (
        <div className="activity-group-body">
          {activity.tools.map((tool) => (
            <div className={`activity-entry tool ${tool.status}`} key={tool.callId}>
              <span>{tool.displayName}</span>
              <p>{compactToolSummary(tool.summary)}</p>
              <small>{tool.statusText}</small>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function HistoryGapNotice({
  gap,
  loading,
  onLoadEarlier
}: {
  gap: TranscriptHistoryGapItem;
  loading: boolean;
  onLoadEarlier?: (gap: TranscriptHistoryGapItem) => void;
}) {
  return (
    <aside className="transcript-history-gap" aria-label="较早历史已折叠">
      <span>已折叠较早历史</span>
      <small>{gap.hiddenItemCount} 条较早记录未挂载，继续对话仍会使用完整运行时上下文。</small>
      {onLoadEarlier ? (
        <button type="button" disabled={loading} onClick={() => onLoadEarlier(gap)}>
          {loading ? "加载中" : "加载更早"}
        </button>
      ) : null}
    </aside>
  );
}

function ActivityGroupPanel({ group }: { group: ActivityGroup }) {
  const [expanded, setExpanded] = useState(false);
  const toolCount = group.tools.length;
  const reasoningCount = group.reasoning.length;
  const failedCount = group.tools.filter((tool) => tool.status === "failed").length;
  const runningCount = group.tools.filter((tool) => tool.status === "running" || tool.status === "requested").length;
  const summaryParts = [
    toolCount > 0 ? toolActivitySummary(group.tools) : null,
    reasoningCount > 0 ? `${reasoningCount} 次思考` : null,
    failedCount > 0 ? `${failedCount} 个失败` : null,
    runningCount > 0 ? `${runningCount} 个进行中` : null
  ].filter(Boolean);

  return (
    <section className={`activity-group transcript-event${failedCount > 0 ? " failed" : ""}`}>
      <button className="event-row-button activity-row-button" type="button" onClick={() => setExpanded((current) => !current)}>
        <span className="event-row-title">
          <span className={`event-dot${runningCount > 0 ? " running" : failedCount > 0 ? " failed" : ""}`} aria-hidden="true" />
          <span className="activity-title">工作进展</span>
          <span className="activity-summary">{summaryParts.join(" · ")}</span>
        </span>
        <span className="event-row-meta">{expanded ? "收起" : "展开"}</span>
      </button>
      {expanded ? (
        <div className="activity-group-body">
          {group.reasoning.map((block, index) => (
            <div className="activity-entry reasoning" key={block.id}>
              <span>思考 {index + 1}</span>
              <p>{compactText(block.text)}</p>
            </div>
          ))}
          {group.tools.map((tool) => (
            <div className={`activity-entry tool ${tool.status}`} key={tool.id}>
              <span>{getToolDisplayName(tool)}</span>
              <p>{compactToolSummary(getToolHumanSummary(tool))}</p>
              <small>{toolStatusText(tool.status)}</small>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function toolActivitySummary(tools: ToolCardState[]) {
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

function compactToolSummary(summary: string) {
  return summary.replace(/\/Users\/[^:，\s)]+/g, (path) => compactPath(path));
}

function compactPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 4) {
    return path;
  }
  return `.../${parts.slice(-4).join("/")}`;
}

function compactText(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 160 ? `${normalized.slice(0, 160)}...` : normalized;
}

function CodebaseContextHint({ event }: { event: Extract<RuntimeEvent, { type: "codebase_context" }> | PersistedTranscriptContextHint }) {
  const previewPaths = event.paths.slice(0, 3);
  return (
    <aside className="codebase-context-hint" aria-label="代码库上下文">
      <span>项目索引</span>
      <strong>{event.message}</strong>
      {previewPaths.length > 0 ? <small>{previewPaths.join(" · ")}{event.paths.length > previewPaths.length ? " ..." : ""}</small> : null}
    </aside>
  );
}

function TranscriptEmptyState({
  currentWorkspaceLabel,
  hasWorkspace,
  isRunning,
  onOpenWorkspaceDialog,
  onRunStarter
}: {
  currentWorkspaceLabel: string;
  hasWorkspace: boolean;
  isRunning: boolean;
  onOpenWorkspaceDialog: () => void;
  onRunStarter: (prompt: string) => void;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-heading">
        <p className="run-meta"><span />就绪 · {currentWorkspaceLabel}</p>
        <h2>今天要改什么？</h2>
        <p>直接描述目标，或从下面的常用起步开始。</p>
      </div>
      <div className="starter-panel">
        {!hasWorkspace ? (
          <button className="workspace-empty-action" type="button" onClick={onOpenWorkspaceDialog}>
            <span><FolderIcon size="18px" /></span>
            <strong>选择项目文件夹</strong>
            <small>把这次对话绑定到正确的工作区</small>
          </button>
        ) : null}
        <div className="starter-grid" aria-label="起始任务">
          <button type="button" disabled={isRunning || !hasWorkspace} onClick={() => onRunStarter("列出当前工作区并总结项目结构")}>
            <span><FolderIcon size="18px" /></span>
            <strong>查看工作区</strong>
            <small>总结项目结构和关键模块</small>
          </button>
          <button type="button" disabled={isRunning || !hasWorkspace} onClick={() => onRunStarter("运行 pnpm --filter @ore-code/desktop test")}>
            <span><PlayCircleIcon size="18px" /></span>
            <strong>运行测试</strong>
            <small>检查当前桌面端状态</small>
          </button>
        </div>
      </div>
    </div>
  );
}

export function deriveTranscriptItems(events: RuntimeEvent[], toolCards: ToolCardState[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const cards = new Map(toolCards.map((card) => [card.id, card]));
  const seenToolCards = new Set<string>();
  let assistantText = "";
  let assistantId: string | null = null;
  let reasoningText = "";
  let reasoningId: string | null = null;
  let activityGroup: ActivityGroup | null = null;

  const flushActivity = () => {
    if (activityGroup && (activityGroup.reasoning.length > 0 || activityGroup.tools.length > 0)) {
      if (activityGroup.reasoning.length === 1 && activityGroup.tools.length === 0) {
        items.push({
          id: `reasoning:${activityGroup.reasoning[0].id}`,
          type: "reasoning",
          block: activityGroup.reasoning[0]
        });
      } else if (activityGroup.reasoning.length === 0 && activityGroup.tools.length === 1) {
        const card = activityGroup.tools[0];
        items.push({ id: `tool:${card.id}`, type: "tool", card });
      } else {
        items.push({
          id: `activity:${activityGroup.id}`,
          type: "activity",
          group: activityGroup
        });
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
    const text = reasoningText.trim();
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
    if (options.groupable && isGroupableToolCard(card)) {
      activityGroup ??= { id, reasoning: [], tools: [] };
      activityGroup.tools.push(card);
      return;
    }
    flushActivity();
    items.push({ id: `tool:${id}`, type: "tool", card });
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
          id: `context:${event.id}`,
          type: "context",
          context: event
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
