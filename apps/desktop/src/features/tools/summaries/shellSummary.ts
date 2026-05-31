import type { ToolCardState } from "../toolCards";
import { statusVerb } from "./summaryUtils";

export function getShellCommand(card: ToolCardState) {
  if (card.name !== "exec_shell" && card.name !== "start_shell_job" && card.name !== "run_tests") {
    return "";
  }

  const input = card.input as { command?: unknown } | undefined;
  const output = card.result?.output as { command?: unknown } | undefined;
  if (typeof output?.command === "string") {
    return output.command;
  }
  return typeof input?.command === "string" ? input.command : "";
}

export function getShellSummary(card: ToolCardState) {
  const shellCommand = getShellCommand(card);
  return shellCommand ? `${statusVerb(card, "执行命令")}：${shellCommand}` : null;
}
