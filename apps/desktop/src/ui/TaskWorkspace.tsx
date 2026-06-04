import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Tag } from "tdesign-react";
import { CloseIcon, CopyIcon, LinkIcon, PlayCircleIcon, RefreshIcon, RollbackIcon, StopCircleIcon, TaskIcon } from "tdesign-icons-react";
import type { DurableTaskSnapshot } from "@ore-code/agent-core";
import type { ChangeReviewGroup } from "../features/changes/changeGroups";
import { currentChecklistItem, latestTaskGate, taskChecklistProgress } from "./CurrentTaskPanel";

type TaskStatus = DurableTaskSnapshot["status"];
type TaskGateStatus = DurableTaskSnapshot["gates"][number]["status"];
type TaskChecklistStatus = DurableTaskSnapshot["checklist"][number]["status"];

export type TaskWorkspaceProps = {
  busy: boolean;
  changeReviewFileCount: number;
  changeReviewGroups: ChangeReviewGroup[];
  currentWorkspaceLabel: string;
  message: string | null;
  onCancelTask: (taskId: string) => Promise<void>;
  onClose: () => void;
  onContinueTask: (taskId: string) => Promise<void>;
  onOpenArtifact: (artifactId: string) => void;
  onOpenChanges: () => void;
  onOpenRelatedSession: (threadId: string, task: DurableTaskSnapshot) => void;
  onRefresh: () => Promise<void>;
  onRetryTask: (taskId: string) => Promise<void>;
  tasks: DurableTaskSnapshot[];
  totalReviewAdditions: number;
  totalReviewDeletions: number;
  visible: boolean;
};

export function TaskWorkspace({
  busy,
  changeReviewFileCount,
  currentWorkspaceLabel,
  message,
  onCancelTask,
  onClose,
  onContinueTask,
  onOpenArtifact,
  onOpenChanges,
  onOpenRelatedSession,
  onRefresh,
  onRetryTask,
  tasks,
  totalReviewAdditions,
  totalReviewDeletions,
  visible
}: TaskWorkspaceProps) {
  const [copiedTaskId, setCopiedTaskId] = useState<string | null>(null);
  const [copyFailedTaskId, setCopyFailedTaskId] = useState<string | null>(null);
  const counts = useMemo(() => taskStatusCounts(tasks), [tasks]);
  const sortedTasks = useMemo(() => sortTasksForWorkspace(tasks), [tasks]);
  const { rootRef: taskWorkspaceRef, scrollRef: taskListRef } = useManualWheelScroll<HTMLDivElement, HTMLDivElement>();

  if (!visible) {
    return null;
  }

  const copyTaskSummary = async (task: DurableTaskSnapshot) => {
    try {
      await navigator.clipboard.writeText(buildTaskSummary(task));
      setCopiedTaskId(task.id);
      setCopyFailedTaskId(null);
    } catch {
      setCopiedTaskId(null);
      setCopyFailedTaskId(task.id);
    }
  };

  return (
    <section className="task-workspace" aria-label="任务" ref={taskWorkspaceRef}>
      <header className="task-workspace-header">
        <div>
          <h1>任务</h1>
          <p>{message ?? `${currentWorkspaceLabel} · ${counts.total} 个任务，${counts.active} 个待处理`}</p>
        </div>
        <div className="task-workspace-actions">
          <Button disabled={busy} icon={<RefreshIcon size="16px" />} shape="square" type="button" variant="text" onClick={() => void onRefresh()} />
          <Button aria-label="关闭任务" icon={<CloseIcon size="18px" />} shape="square" type="button" variant="text" onClick={onClose} />
        </div>
      </header>

      <main className="task-workspace-body">
        {changeReviewFileCount > 0 ? (
          <button className="task-change-link" type="button" onClick={onOpenChanges}>
            当前变更 {changeReviewFileCount} 个文件 · +{totalReviewAdditions}/-{totalReviewDeletions}
          </button>
        ) : null}

        <div className="task-list-scroll" ref={taskListRef}>
          {sortedTasks.map((task) => (
            <TaskListItem
              busy={busy}
              copyState={copiedTaskId === task.id ? "copied" : copyFailedTaskId === task.id ? "failed" : "idle"}
              key={task.id}
              task={task}
              onCancel={() => void onCancelTask(task.id)}
              onContinue={() => void onContinueTask(task.id)}
              onCopy={() => void copyTaskSummary(task)}
              onOpenArtifact={onOpenArtifact}
              onOpenRelatedSession={(threadId) => onOpenRelatedSession(threadId, task)}
              onRetry={() => void onRetryTask(task.id)}
            />
          ))}

          {sortedTasks.length === 0 ? (
            <div className="task-workspace-empty">
              <TaskIcon size="28px" />
              <strong>没有任务</strong>
              <p>多步骤工作开始后，会在这里显示状态。</p>
            </div>
          ) : null}
        </div>
      </main>
    </section>
  );
}

function useManualWheelScroll<TRoot extends HTMLElement, TScroll extends HTMLElement>() {
  const rootRef = useRef<TRoot | null>(null);
  const scrollRef = useRef<TScroll | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      const scrollElement = scrollRef.current;
      if (!scrollElement) {
        return;
      }
      if (!isWheelInsideElement(event, root)) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();

      const maxScrollTop = scrollElement.scrollHeight - scrollElement.clientHeight;
      if (maxScrollTop <= 0) {
        scrollElement.scrollTop = 0;
        return;
      }

      const nextScrollTop = Math.max(0, Math.min(maxScrollTop, scrollElement.scrollTop + normalizeWheelDelta(event, scrollElement.clientHeight)));
      scrollElement.scrollTop = nextScrollTop;
    };

    document.addEventListener("wheel", handleWheel, { capture: true, passive: false });
    return () => {
      document.removeEventListener("wheel", handleWheel, { capture: true });
    };
  }, []);

  return { rootRef, scrollRef };
}

function normalizeWheelDelta(event: WheelEvent, pageSize: number) {
  if (event.deltaMode === 1) {
    return event.deltaY * 16;
  }
  if (event.deltaMode === 2) {
    return event.deltaY * pageSize;
  }
  return event.deltaY;
}

function isWheelInsideElement(event: WheelEvent, element: HTMLElement) {
  const target = event.target;
  if (target instanceof Node && element.contains(target)) {
    return true;
  }

  const rect = element.getBoundingClientRect();
  return event.clientX >= rect.left
    && event.clientX <= rect.right
    && event.clientY >= rect.top
    && event.clientY <= rect.bottom;
}

function TaskListItem({
  busy,
  copyState,
  onCancel,
  onContinue,
  onCopy,
  onOpenArtifact,
  onOpenRelatedSession,
  onRetry,
  task
}: {
  busy: boolean;
  copyState: "idle" | "copied" | "failed";
  onCancel: () => void;
  onContinue: () => void;
  onCopy: () => void;
  onOpenArtifact: (artifactId: string) => void;
  onOpenRelatedSession: (threadId: string) => void;
  onRetry: () => void;
  task: DurableTaskSnapshot;
}) {
  const currentItem = currentChecklistItem(task);
  const gate = latestTaskGate(task);
  const progress = taskChecklistProgress(task);
  const verification = taskVerificationSummary(task);
  const executionThreadId = task.executionThreadId ?? task.threadId;
  const terminal = task.status === "completed" || task.status === "failed" || task.status === "canceled";
  const canCancel = task.status === "running" || task.status === "queued";

  return (
    <article className={`task-list-card ${task.status}`}>
      <header>
        <span className={`task-status-dot ${task.status}`} aria-hidden="true" />
        <div>
          <strong>{task.title}</strong>
          <small>{formatDateTime(task.updatedAt)} 更新</small>
        </div>
        <Tag size="small" theme={taskStatusTheme(task.status)} variant="light">
          {taskStatusText(task.status)}
        </Tag>
      </header>

      <p className="task-list-current">
        {currentItem?.content ?? gate?.summary ?? gate?.name ?? terminalResultText(task)}
      </p>

      <div className="task-list-meta">
        <span>Checklist {progress.completed}/{progress.total}</span>
        <span>Gate {verification.passed}/{verification.total}</span>
        {task.artifacts.length > 0 ? <span>Artifact {task.artifacts.length}</span> : null}
      </div>

      <footer className="task-list-actions">
        <Button disabled={busy || !canCancel} icon={<StopCircleIcon size="14px" />} size="small" theme="danger" type="button" variant="text" onClick={onCancel}>
          取消
        </Button>
        <Button disabled={busy || !terminal} icon={<RollbackIcon size="14px" />} size="small" type="button" variant="text" onClick={onRetry}>
          重试
        </Button>
        <Button disabled={busy || !terminal} icon={<PlayCircleIcon size="14px" />} size="small" theme="primary" type="button" variant="text" onClick={onContinue}>
          继续
        </Button>
        <Button icon={<CopyIcon size="14px" />} size="small" type="button" variant="text" onClick={onCopy}>
          {copyState === "copied" ? "已复制" : copyState === "failed" ? "失败" : "复制"}
        </Button>
        {task.artifacts.slice(0, 1).map((artifact) => (
          <Button key={artifact.id} size="small" type="button" variant="text" onClick={() => onOpenArtifact(artifact.artifactId)}>
            Artifact
          </Button>
        ))}
        {task.sourceThreadId ? (
          <Button icon={<LinkIcon size="13px" />} size="small" type="button" variant="text" onClick={() => onOpenRelatedSession(task.sourceThreadId!)}>
            来源
          </Button>
        ) : null}
        {executionThreadId ? (
          <Button icon={<LinkIcon size="13px" />} size="small" type="button" variant="text" onClick={() => onOpenRelatedSession(executionThreadId)}>
            执行
          </Button>
        ) : null}
      </footer>
    </article>
  );
}

export function taskStatusCounts(tasks: DurableTaskSnapshot[]) {
  const counts: Record<TaskStatus | "active" | "total", number> = {
    active: 0,
    canceled: 0,
    completed: 0,
    failed: 0,
    queued: 0,
    running: 0,
    total: tasks.length
  };

  for (const task of tasks) {
    counts[task.status] += 1;
  }
  counts.active = counts.running + counts.queued + counts.failed;
  return counts;
}

export function selectTaskForWorkspace(tasks: DurableTaskSnapshot[], selectedTaskId?: string | null) {
  if (selectedTaskId && tasks.some((task) => task.id === selectedTaskId)) {
    return selectedTaskId;
  }
  return sortTasksForWorkspace(tasks)[0]?.id ?? null;
}

export function sortTasksForWorkspace(tasks: DurableTaskSnapshot[]) {
  return [...tasks].sort((a, b) => {
    const priorityDelta = taskPriority(a.status) - taskPriority(b.status);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

export function taskVerificationSummary(task: DurableTaskSnapshot) {
  const passed = task.gates.filter((gate) => gate.status === "passed").length;
  const failed = task.gates.filter((gate) => gate.status === "failed").length;
  const unknown = task.gates.filter((gate) => gate.status === "unknown").length;
  const total = task.gates.length;

  return {
    failed,
    passed,
    resultText: total === 0
      ? "尚未验证"
      : failed > 0
        ? `${failed} 个失败，${passed} 个通过`
        : `${passed} 个通过，${unknown} 个未确认`,
    total,
    unknown
  };
}

export function buildTaskSummary(task: DurableTaskSnapshot) {
  const verification = taskVerificationSummary(task);
  const lines = [
    `# ${task.title}`,
    `状态：${taskStatusText(task.status)}`,
    `任务 ID：${task.id}`,
    "",
    "## 原始目标",
    task.prompt,
    "",
    "## 当前结果",
    terminalResultText(task),
    verification.resultText
  ];

  if (task.checklist.length > 0) {
    lines.push("", "## Checklist");
    for (const item of task.checklist) {
      lines.push(`- [${item.status === "completed" ? "x" : " "}] ${checklistStatusText(item.status)}：${item.content}`);
    }
  }

  if (task.gates.length > 0) {
    lines.push("", "## 验证 Gates");
    for (const gate of task.gates) {
      lines.push(`- ${gateStatusText(gate.status)}：${gate.name}${gate.command ? ` (${gate.command})` : ""} -> ${gate.summary}`);
    }
  }

  if (task.artifacts.length > 0) {
    lines.push("", "## Artifacts");
    for (const artifact of task.artifacts) {
      lines.push(`- ${artifact.summary}：${artifact.artifactId}`);
    }
  }

  if (task.workspacePath) {
    lines.push("", "## 工作区", `- workspacePath：${task.workspacePath}`);
  }

  if (task.sourceThreadId || task.executionThreadId || task.threadId) {
    lines.push(
      "",
      "## 会话",
      `- sourceThreadId：${task.sourceThreadId ?? "无"}`,
      `- executionThreadId：${task.executionThreadId ?? task.threadId ?? "无"}`,
      `- turnId：${task.turnId ?? "无"}`
    );
  }

  return lines.join("\n");
}

function taskPriority(status: TaskStatus) {
  switch (status) {
    case "running":
      return 0;
    case "queued":
      return 1;
    case "failed":
      return 2;
    case "completed":
      return 3;
    case "canceled":
      return 4;
  }
}

function terminalResultText(task: DurableTaskSnapshot) {
  if (task.error) {
    return task.error;
  }
  if (task.output) {
    return task.output;
  }
  if (task.status === "running") {
    return "任务正在执行。";
  }
  if (task.status === "queued") {
    return "任务正在排队。";
  }
  if (task.status === "completed") {
    return "任务已完成，但没有输出摘要。";
  }
  if (task.status === "canceled") {
    return "任务已取消。";
  }
  return "任务失败，但没有错误摘要。";
}

function taskStatusText(status: TaskStatus) {
  switch (status) {
    case "queued":
      return "排队";
    case "running":
      return "运行中";
    case "completed":
      return "完成";
    case "failed":
      return "失败";
    case "canceled":
      return "取消";
  }
}

function taskStatusTheme(status: TaskStatus) {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
    case "canceled":
      return "danger";
    case "running":
      return "warning";
    default:
      return "default";
  }
}

function checklistStatusText(status: TaskChecklistStatus) {
  switch (status) {
    case "in_progress":
      return "进行中";
    case "blocked":
      return "阻塞";
    case "completed":
      return "完成";
    case "pending":
      return "待处理";
  }
}

function gateStatusText(status: TaskGateStatus) {
  switch (status) {
    case "passed":
      return "通过";
    case "failed":
      return "失败";
    case "unknown":
      return "未确认";
  }
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit"
  }).format(date);
}
