import type { ToolCardState } from "../toolCards";
import type { MarkdownReadFile } from "../toolPresentationTypes";

export function statusVerb(card: ToolCardState, action: string) {
  switch (card.status) {
    case "requested":
      return `准备${action}`;
    case "approval":
      return `等待审批：${action}`;
    case "running":
      return `正在${action}`;
    case "completed":
      return `已${action}`;
    case "failed":
      return `${action}失败`;
  }
}

export function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function isMarkdownPath(path: string) {
  return /\.md(?:own)?$/i.test(path) || /\.markdown$/i.test(path);
}

export function markdownReadFileFromCard(card: ToolCardState): MarkdownReadFile | null {
  if (card.name !== "read_file") {
    return null;
  }

  const output = card.result?.output as { path?: unknown; content?: unknown } | undefined;
  if (typeof output?.path !== "string" || typeof output.content !== "string") {
    return null;
  }

  if (!isMarkdownPath(output.path)) {
    return null;
  }

  return {
    path: output.path,
    content: output.content
  };
}
