import type { ToolCardState } from "./toolCards";
import {
  getFileToolSummary,
  getMarkdownReadFile,
  getRetrievedArtifactSlice
} from "./summaries/fileSummary";
import { getShellCommand } from "./summaries/shellSummary";
import { statusVerb } from "./summaries/summaryUtils";
import { toolPresentationFor } from "./toolPresentationRegistry";
import type { CommandOutputPreviewData } from "./toolPresentationTypes";

export { getMarkdownReadFile, getRetrievedArtifactSlice, getShellCommand };

export function getToolDisplayName(card: ToolCardState) {
  return toolPresentationFor(card.name)?.label ?? card.name;
}

export function getToolHumanSummary(card: ToolCardState) {
  if (card.result?.error) {
    return card.result.error.message;
  }

  const presentation = toolPresentationFor(card.name);
  const summary = presentation?.summary?.(card);
  if (summary) {
    return summary;
  }

  if (card.result?.artifactId) {
    return `${statusVerb(card, "生成产物")}：${card.result.artifactId}`;
  }

  const shellResult = card.result?.output as { exitCode?: number; timedOut?: boolean } | undefined;
  if (typeof shellResult?.exitCode === "number") {
    return shellResult.timedOut ? `exit ${shellResult.exitCode} / timeout` : `exit ${shellResult.exitCode}`;
  }

  const fileSummary = getFileToolSummary(card);
  if (fileSummary) {
    return fileSummary;
  }

  if (card.approvalDecision) {
    return `审批：${card.approvalDecision}`;
  }

  return `${statusVerb(card, getToolDisplayName(card))}`;
}

export function getCommandOutput(card: ToolCardState): CommandOutputPreviewData | null {
  if (card.commandOutput && (card.commandOutput.stdout || card.commandOutput.stderr)) {
    return card.commandOutput;
  }

  const output = card.result?.output as { stdout?: unknown; stderr?: unknown } | undefined;
  const stdout = typeof output?.stdout === "string" ? output.stdout : "";
  const stderr = typeof output?.stderr === "string" ? output.stderr : "";

  if (!stdout && !stderr) {
    return null;
  }

  return { stdout, stderr, truncated: false };
}

export function toolCardPayload(card: ToolCardState) {
  if (!card.result) {
    return card.input;
  }

  if (card.result.error) {
    return card.result.error;
  }

  if (card.result.artifactId) {
    return {
      artifactId: card.result.artifactId,
      output: card.result.output
    };
  }

  return card.result.output;
}

export function toolStatusText(status: ToolCardState["status"]) {
  switch (status) {
    case "requested":
      return "已请求";
    case "approval":
      return "待审批";
    case "running":
      return "运行中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
  }
}

export function formatToolPayload(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}
