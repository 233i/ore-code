import type { ToolCardState } from "../toolCards";
import { numberValue, statusVerb, stringValue } from "./summaryUtils";

export function getTaskSummary(card: ToolCardState) {
  const output = card.result?.output as Record<string, unknown> | undefined;
  if (Array.isArray(output?.tasks)) {
    return `任务列表：${output.tasks.length} 个`;
  }

  const task = taskFromOutput(output);
  const input = card.input as Record<string, unknown> | undefined;
  const title = stringValue(task?.title) || stringValue(input?.title) || stringValue(input?.prompt) || "当前任务";
  const status = stringValue(task?.status);
  const suffix = status ? `（${taskStatusText(status)}）` : "";
  return `${statusVerb(card, getTaskAction(card.name))}：${title}${suffix}`;
}

export function getChecklistSummary(card: ToolCardState) {
  const output = card.result?.output as Record<string, unknown> | undefined;
  const task = taskFromOutput(output);
  const checklist = Array.isArray(output?.checklist)
    ? output.checklist
    : Array.isArray(task?.checklist) ? task.checklist : [];
  const item = output?.item as Record<string, unknown> | undefined;

  if (item) {
    const content = stringValue(item.content) || "清单项";
    const status = stringValue(item.status);
    const suffix = status ? `（${checklistStatusText(status)}）` : "";
    return `${statusVerb(card, getChecklistAction(card.name))}：${content}${suffix}`;
  }

  if (checklist.length > 0) {
    const completed = checklist.filter((candidate) => {
      const itemRecord = candidate as Record<string, unknown>;
      return itemRecord.status === "completed";
    }).length;
    return `${statusVerb(card, getChecklistAction(card.name))}：${completed}/${checklist.length} 完成`;
  }

  return `${statusVerb(card, getChecklistAction(card.name))}`;
}

export function getTaskGateSummary(card: ToolCardState) {
  const output = card.result?.output as Record<string, unknown> | undefined;
  const gate = output?.gate as Record<string, unknown> | undefined;
  const input = card.input as Record<string, unknown> | undefined;
  const name = stringValue(gate?.name) || stringValue(input?.name) || stringValue(input?.command) || "验证";
  const status = stringValue(gate?.status);
  const durationMs = numberValue(gate?.durationMs);
  const statusSuffix = status ? `（${gateStatusText(status)}${durationMs === null ? "" : ` · ${durationMs}ms`}）` : "";
  return `${statusVerb(card, card.name === "task_gate_run" ? "执行验证" : "记录验证")}：${name}${statusSuffix}`;
}

export function getTaskArtifactSummary(card: ToolCardState) {
  const output = card.result?.output as Record<string, unknown> | undefined;
  const artifact = output?.artifact as Record<string, unknown> | undefined;
  const input = card.input as Record<string, unknown> | undefined;
  const summary = stringValue(artifact?.summary) || stringValue(input?.summary) || stringValue(artifact?.artifactId) || stringValue(input?.artifactId) || "产物";
  return `${statusVerb(card, "记录产物")}：${summary}`;
}

export function getPrAttemptSummary(card: ToolCardState) {
  const output = card.result?.output as Record<string, unknown> | undefined;
  if (Array.isArray(output?.attempts)) {
    return `PR 尝试：${output.attempts.length} 个`;
  }
  const attempt = output?.attempt as Record<string, unknown> | undefined;
  const input = card.input as Record<string, unknown> | undefined;
  const summary = stringValue(attempt?.summary) || stringValue(input?.summary) || "PR 尝试";
  const status = stringValue(attempt?.preflightStatus);
  const suffix = status ? `（preflight ${status}）` : "";
  return `${statusVerb(card, getPrAttemptAction(card.name))}：${summary}${suffix}`;
}

function taskFromOutput(output: Record<string, unknown> | undefined) {
  if (!output) {
    return undefined;
  }
  const nested = output.task as Record<string, unknown> | undefined;
  if (nested && typeof nested === "object") {
    return nested;
  }
  return output;
}

function getTaskAction(name: string) {
  switch (name) {
    case "task_create":
      return "创建任务";
    case "task_update":
      return "更新任务";
    case "task_cancel":
      return "取消任务";
    default:
      return "读取任务";
  }
}

function getChecklistAction(name: string) {
  switch (name) {
    case "checklist_write":
      return "更新清单";
    case "checklist_add":
      return "添加清单项";
    case "checklist_update":
      return "更新清单项";
    default:
      return "读取清单";
  }
}

function getPrAttemptAction(name: string) {
  switch (name) {
    case "pr_attempt_record":
      return "记录 PR 尝试";
    case "pr_attempt_preflight":
      return "检查 PR 尝试";
    default:
      return "读取 PR 尝试";
  }
}

function taskStatusText(status: string) {
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
    default:
      return status;
  }
}

function checklistStatusText(status: string) {
  switch (status) {
    case "pending":
      return "待处理";
    case "in_progress":
      return "进行中";
    case "completed":
      return "完成";
    case "blocked":
      return "阻塞";
    default:
      return status;
  }
}

function gateStatusText(status: string) {
  switch (status) {
    case "passed":
      return "通过";
    case "failed":
      return "失败";
    case "unknown":
      return "未知";
    default:
      return status;
  }
}
