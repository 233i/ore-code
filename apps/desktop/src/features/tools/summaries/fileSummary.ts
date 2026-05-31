import type { ToolCardState } from "../toolCards";
import type { RetrievedArtifactSlice } from "../toolPresentationTypes";
import { markdownReadFileFromCard, numberValue, statusVerb, stringValue } from "./summaryUtils";

export function getRetrievedArtifactSlice(card: ToolCardState): RetrievedArtifactSlice | null {
  if (card.name !== "retrieve_tool_result" || !card.result?.ok) {
    return null;
  }

  const output = card.result.output as Record<string, unknown> | undefined;
  const artifact = output?.artifact as Record<string, unknown> | undefined;
  const returnedLines = output?.returnedLines as Record<string, unknown> | undefined;

  if (
    !artifact ||
    typeof artifact.id !== "string" ||
    typeof output?.content !== "string" ||
    typeof output.totalLines !== "number" ||
    typeof returnedLines?.start !== "number" ||
    typeof returnedLines.end !== "number"
  ) {
    return null;
  }

  return {
    artifactId: artifact.id,
    mode: typeof output.mode === "string" ? output.mode : "tail",
    stream: typeof output.stream === "string" ? output.stream : "all",
    content: output.content,
    totalLines: output.totalLines,
    returnedLines: {
      start: returnedLines.start,
      end: returnedLines.end
    },
    truncated: output.truncated === true,
    charTruncated: output.charTruncated === true
  };
}

export const getMarkdownReadFile = markdownReadFileFromCard;

export function getArtifactSliceSummary(card: ToolCardState) {
  const artifactSlice = getRetrievedArtifactSlice(card);
  return artifactSlice
    ? `${statusVerb(card, "读取产物片段")}：${artifactSlice.artifactId} 第 ${artifactSlice.returnedLines.start}-${artifactSlice.returnedLines.end} 行`
    : null;
}

export function getReadFileSummary(card: ToolCardState) {
  const markdownFile = getMarkdownReadFile(card);
  if (markdownFile) {
    return `${statusVerb(card, "预览 Markdown")}：${markdownFile.path}`;
  }
  return getFileToolSummary(card);
}

export function getFileToolSummary(card: ToolCardState) {
  const input = card.input as Record<string, unknown> | undefined;
  const output = card.result?.output as Record<string, unknown> | undefined;
  const path = stringValue(output?.path) || stringValue(input?.path);

  if (card.name === "write_file") {
    const bytesWritten = numberValue(output?.bytesWritten);
    const suffix = bytesWritten === null ? "" : `（${bytesWritten} 字节）`;
    return path ? `${statusVerb(card, "写入文件")}：${path}${suffix}` : `${statusVerb(card, "写入文件")}${suffix}`;
  }

  if (card.name === "edit_file") {
    const replacements = numberValue(output?.replacements);
    const suffix = replacements === null ? "" : `（${replacements} 处替换）`;
    return path ? `${statusVerb(card, "编辑文件")}：${path}${suffix}` : `${statusVerb(card, "编辑文件")}${suffix}`;
  }

  if (card.name === "read_file") {
    return path ? `${statusVerb(card, "读取文件")}：${path}` : `${statusVerb(card, "读取文件")}`;
  }

  if (card.name === "list_dir") {
    const entries = Array.isArray(output?.entries) ? output.entries.length : null;
    const suffix = entries === null ? "" : `（${entries} 项）`;
    return path ? `${statusVerb(card, "列出目录")}：${path}${suffix}` : `${statusVerb(card, "列出目录")}${suffix}`;
  }

  return null;
}
