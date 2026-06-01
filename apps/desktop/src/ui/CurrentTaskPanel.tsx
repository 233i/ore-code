import { Tag } from "tdesign-react";
import type { DurableTaskSnapshot } from "@ore-code/agent-core";
import type { RuntimeEvent } from "@ore-code/protocol";

type SubagentCompletedEvent = Extract<RuntimeEvent, { type: "subagent_completed" }>;

export type CurrentTaskPanelProps = {
  latestSubagentEvent?: SubagentCompletedEvent | null;
  tasks: DurableTaskSnapshot[];
};

export function CurrentTaskPanel({ latestSubagentEvent, tasks }: CurrentTaskPanelProps) {
  const task = selectCurrentTask(tasks);
  if (!task && !latestSubagentEvent) {
    return null;
  }

  const progress = task ? taskChecklistProgress(task) : null;
  const currentItem = task ? currentChecklistItem(task) : null;
  const gate = task ? latestTaskGate(task) : null;

  return (
    <section className="current-task-panel" aria-label="当前任务">
      <header>
        <div>
          <span>当前任务</span>
          <strong>{task?.title ?? "子任务状态"}</strong>
        </div>
        {task ? (
          <Tag size="small" theme={taskStatusTheme(task.status)} variant="light">
            {taskStatusText(task.status)}
          </Tag>
        ) : null}
      </header>

      {task ? (
        <>
          {progress && progress.total > 0 ? (
            <div className="current-task-progress" aria-label="Checklist 进度">
              <span>
                <strong>{progress.completed}/{progress.total}</strong>
                <small>Checklist</small>
              </span>
              <div className="current-task-progress-bar" aria-hidden="true">
                <i style={{ width: `${progress.percent}%` }} />
              </div>
            </div>
          ) : null}

          {currentItem ? (
            <p className={`current-task-line ${currentItem.status}`}>
              <span>{checklistStatusText(currentItem.status)}</span>
              <strong>{currentItem.content}</strong>
            </p>
          ) : (
            <p className="current-task-line muted">{task.output ?? task.error ?? task.prompt}</p>
          )}

          {gate ? (
            <p className={`current-task-line gate ${gate.status}`}>
              <span>{gateStatusText(gate.status)}</span>
              <strong>{gate.name}</strong>
              {gate.durationMs !== undefined ? <small>{gate.durationMs}ms</small> : null}
            </p>
          ) : null}
        </>
      ) : null}

      {latestSubagentEvent ? (
        <p className={`current-task-line subagent ${latestSubagentEvent.status}`}>
          <span>子任务</span>
          <strong>{subagentStatusText(latestSubagentEvent)}</strong>
        </p>
      ) : null}
    </section>
  );
}

export function selectCurrentTask(tasks: DurableTaskSnapshot[]) {
  const candidates = tasks.filter((task) => task.status === "running" || task.status === "queued" || task.status === "failed");
  if (candidates.length === 0) {
    return null;
  }
  return [...candidates].sort(compareTaskPriority)[0] ?? null;
}

export function taskChecklistProgress(task: DurableTaskSnapshot) {
  const total = task.checklist.length;
  const completed = task.checklist.filter((item) => item.status === "completed").length;
  return {
    blocked: task.checklist.filter((item) => item.status === "blocked").length,
    completed,
    percent: total > 0 ? Math.round((completed / total) * 100) : 0,
    total
  };
}

export function currentChecklistItem(task: DurableTaskSnapshot) {
  return task.checklist.find((item) => item.status === "in_progress")
    ?? task.checklist.find((item) => item.status === "blocked")
    ?? task.checklist.find((item) => item.status === "pending")
    ?? null;
}

export function latestTaskGate(task: DurableTaskSnapshot) {
  return [...task.gates].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

function compareTaskPriority(a: DurableTaskSnapshot, b: DurableTaskSnapshot) {
  const statusDelta = taskPriority(a.status) - taskPriority(b.status);
  if (statusDelta !== 0) {
    return statusDelta;
  }
  return b.updatedAt.localeCompare(a.updatedAt);
}

function taskPriority(status: DurableTaskSnapshot["status"]) {
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

function taskStatusText(status: DurableTaskSnapshot["status"]) {
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

function taskStatusTheme(status: DurableTaskSnapshot["status"]) {
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

function checklistStatusText(status: DurableTaskSnapshot["checklist"][number]["status"]) {
  switch (status) {
    case "in_progress":
      return "进行中";
    case "blocked":
      return "阻塞";
    case "completed":
      return "完成";
    case "pending":
      return "下一步";
  }
}

function gateStatusText(status: DurableTaskSnapshot["gates"][number]["status"]) {
  switch (status) {
    case "passed":
      return "验证通过";
    case "failed":
      return "验证失败";
    case "unknown":
      return "验证记录";
  }
}

function subagentStatusText(event: SubagentCompletedEvent) {
  const name = event.name || event.agentId;
  const role = subagentRoleLabel(event.role);
  const prefix = role ? `${name} · ${role}` : name;
  const model = event.model ? `（${event.model}）` : "";
  if (event.status === "completed") {
    return `${prefix} 完成${model}：${event.summary}`;
  }
  if (event.status === "failed") {
    return `${prefix} 失败${model}：${event.error ?? event.summary}`;
  }
  return `${prefix} 已取消${model}：${event.summary}`;
}

function subagentRoleLabel(role: SubagentCompletedEvent["role"]) {
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
