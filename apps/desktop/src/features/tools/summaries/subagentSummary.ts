import type { ToolCardState } from "../toolCards";
import { deriveRlmProgressForToolCard } from "../rlmProgress";
import { numberValue, statusVerb, stringValue } from "./summaryUtils";

export function getRlmSummary(card: ToolCardState) {
  const progress = deriveRlmProgressForToolCard(card);
  if (progress) {
    return progress.failed > 0
      ? `RLM ${progress.completed}/${progress.total} 完成，${progress.failed} 失败`
      : `RLM ${progress.completed}/${progress.total} 完成`;
  }

  const output = card.result?.output as Record<string, unknown> | undefined;
  const promptCount = typeof output?.promptCount === "number" ? output.promptCount : null;
  const failedCount = typeof output?.failedCount === "number" ? output.failedCount : 0;
  if (promptCount !== null) {
    return failedCount > 0 ? `RLM ${promptCount} 子任务，${failedCount} 失败` : `RLM ${promptCount} 子任务完成`;
  }
  return null;
}

export function getSubagentSummary(card: ToolCardState) {
  const input = card.input as Record<string, unknown> | undefined;
  const output = card.result?.output as Record<string, unknown> | undefined;
  if (Array.isArray(output?.agents)) {
    const agents = output.agents.filter((agent): agent is Record<string, unknown> => Boolean(agent) && typeof agent === "object");
    const running = agents.filter((agent) => agent.status === "running").length;
    const failed = agents.filter((agent) => agent.status === "failed").length;
    const suffix = failed > 0 ? `，${failed} 失败` : "";
    return `子智能体：${running}/${agents.length} 运行中${suffix}`;
  }

  const name = stringValue(output?.name) || stringValue(input?.name) || stringValue(input?.agentId) || "子智能体";
  const status = stringValue(output?.status);
  const role = subagentRoleLabel(stringValue(output?.role) || stringValue(input?.role));
  const model = stringValue(output?.model);
  const activeCount = numberValue(output?.activeCount);
  const maxConcurrent = numberValue(output?.maxConcurrent);
  const details = [
    role,
    model,
    activeCount !== null && maxConcurrent !== null ? `并发 ${activeCount}/${maxConcurrent}` : ""
  ].filter(Boolean).join(" · ");
  const statusText = status ? `（${subagentStatusText(status)}${details ? ` · ${details}` : ""}）` : details ? `（${details}）` : "";
  const error = stringValue(output?.error);
  const errorSuffix = status === "failed" && error ? `：${error}` : "";
  return `${statusVerb(card, getSubagentAction(card.name))}：${name}${statusText}${errorSuffix}`;
}

function getSubagentAction(name: string) {
  switch (name) {
    case "agent_spawn":
      return "启动子智能体";
    case "agent_wait":
      return "等待子智能体";
    case "agent_send_input":
      return "继续子智能体";
    case "agent_cancel":
      return "取消子智能体";
    case "agent_resume":
      return "恢复子智能体";
    default:
      return "读取子智能体";
  }
}

function subagentRoleLabel(role: string) {
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

function subagentStatusText(status: string) {
  switch (status) {
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
