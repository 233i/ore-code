import type { ArtifactRecord } from "@ore-code/protocol";
import { z } from "zod";
import type { ToolSpec } from "./spec";

const DEFAULT_MAX_LINES = 200;
const DEFAULT_MAX_CHARS = 40_000;

const RetrieveToolResultInputSchema = z.object({
  artifactId: z.string().min(1),
  mode: z.enum(["head", "tail", "range", "all"]).default("tail"),
  stream: z.enum(["all", "stdout", "stderr"]).default("all"),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  maxLines: z.number().int().positive().max(1000).default(DEFAULT_MAX_LINES),
  maxChars: z.number().int().positive().max(100_000).default(DEFAULT_MAX_CHARS)
});

export interface ArtifactToolHost {
  read(id: string): Promise<ArtifactRecord>;
}

export interface RetrieveToolResultOutput {
  artifact: Omit<ArtifactRecord, "content">;
  mode: "head" | "tail" | "range" | "all";
  stream: "all" | "stdout" | "stderr";
  content: string;
  totalLines: number;
  returnedLines: {
    start: number;
    end: number;
  };
  truncated: boolean;
  charTruncated: boolean;
}

export function createRetrieveToolResultTool(
  host: ArtifactToolHost
): ToolSpec<z.infer<typeof RetrieveToolResultInputSchema>, RetrieveToolResultOutput> {
  return {
    name: "retrieve_tool_result",
    description:
      "Read a stored large tool result artifact by artifactId. Use this to inspect head, tail, or a line range from long shell logs, MCP output, diffs, or test reports.",
    capability: "readonly",
    approval: "never",
    inputSchema: RetrieveToolResultInputSchema,
    async execute(input) {
      let artifact: ArtifactRecord;
      try {
        artifact = await host.read(input.artifactId);
      } catch (error) {
        return {
          callId: "retrieve_tool_result",
          ok: false,
          error: {
            code: "artifact_not_found",
            message: error instanceof Error ? error.message : `Artifact not found: ${input.artifactId}`
          }
        };
      }

      const selected = selectArtifactContent(artifact, input.stream);
      if (!selected.ok) {
        return {
          callId: "retrieve_tool_result",
          ok: false,
          error: {
            code: "artifact_stream_not_found",
            message: selected.message
          }
        };
      }

      const lines = splitLines(selected.content);
      const range = resolveLineRange({
        totalLines: lines.length,
        mode: input.mode,
        startLine: input.startLine,
        endLine: input.endLine,
        maxLines: input.maxLines
      });
      if (!range.ok) {
        return {
          callId: "retrieve_tool_result",
          ok: false,
          error: {
            code: "invalid_line_range",
            message: range.message
          }
        };
      }

      const content = joinSelectedLines(lines, range.start, range.end);
      const capped = capContent(content, input.maxChars, input.mode);

      return {
        callId: "retrieve_tool_result",
        ok: true,
        output: {
          artifact: metadataFor(artifact),
          mode: input.mode,
          stream: input.stream,
          content: capped.content,
          totalLines: lines.length,
          returnedLines: {
            start: range.start,
            end: range.end
          },
          truncated: range.truncated || capped.truncated,
          charTruncated: capped.truncated
        }
      };
    }
  };
}

export function createArtifactTools(host: ArtifactToolHost): ToolSpec[] {
  return [createRetrieveToolResultTool(host)];
}

function metadataFor(artifact: ArtifactRecord): Omit<ArtifactRecord, "content"> {
  return {
    id: artifact.id,
    type: artifact.type,
    size: artifact.size,
    createdAt: artifact.createdAt,
    summary: artifact.summary,
    sourceCallId: artifact.sourceCallId
  };
}

function selectArtifactContent(
  artifact: ArtifactRecord,
  stream: "all" | "stdout" | "stderr"
): { ok: true; content: string } | { ok: false; message: string } {
  if (stream === "all") {
    return { ok: true, content: artifact.content };
  }

  if (artifact.type !== "shell-log") {
    return {
      ok: false,
      message: `stream=${stream} is only available for shell-log artifacts.`
    };
  }

  const shellLog = parseShellLogArtifact(artifact.content);
  return {
    ok: true,
    content: stream === "stdout" ? shellLog.stdout : shellLog.stderr
  };
}

function parseShellLogArtifact(content: string) {
  if (!content.startsWith("stdout\n")) {
    return { stdout: content, stderr: "" };
  }

  const marker = "\n\nstderr\n";
  const markerIndex = content.indexOf(marker);
  if (markerIndex === -1) {
    return { stdout: content.slice("stdout\n".length), stderr: "" };
  }

  return {
    stdout: content.slice("stdout\n".length, markerIndex),
    stderr: content.slice(markerIndex + marker.length)
  };
}

function splitLines(content: string) {
  if (!content) {
    return [];
  }

  return content.split(/\r?\n/);
}

function resolveLineRange(input: {
  totalLines: number;
  mode: "head" | "tail" | "range" | "all";
  startLine?: number;
  endLine?: number;
  maxLines: number;
}): { ok: true; start: number; end: number; truncated: boolean } | { ok: false; message: string } {
  if (input.totalLines === 0) {
    return { ok: true, start: 0, end: 0, truncated: false };
  }

  if (input.mode === "all") {
    return {
      ok: true,
      start: 1,
      end: input.totalLines,
      truncated: false
    };
  }

  if (input.mode === "head") {
    return {
      ok: true,
      start: 1,
      end: Math.min(input.maxLines, input.totalLines),
      truncated: input.totalLines > input.maxLines
    };
  }

  if (input.mode === "tail") {
    return {
      ok: true,
      start: Math.max(1, input.totalLines - input.maxLines + 1),
      end: input.totalLines,
      truncated: input.totalLines > input.maxLines
    };
  }

  if (!input.startLine) {
    return { ok: false, message: "mode=range requires startLine." };
  }

  const requestedEnd = input.endLine ?? input.startLine + input.maxLines - 1;
  if (requestedEnd < input.startLine) {
    return { ok: false, message: "endLine must be greater than or equal to startLine." };
  }

  const cappedEnd = Math.min(requestedEnd, input.startLine + input.maxLines - 1, input.totalLines);
  return {
    ok: true,
    start: Math.min(input.startLine, input.totalLines),
    end: cappedEnd,
    truncated: requestedEnd > cappedEnd
  };
}

function joinSelectedLines(lines: string[], startLine: number, endLine: number) {
  if (startLine === 0 || endLine === 0) {
    return "";
  }

  return lines.slice(startLine - 1, endLine).join("\n");
}

function capContent(content: string, maxChars: number, mode: "head" | "tail" | "range" | "all") {
  if (content.length <= maxChars) {
    return { content, truncated: false };
  }

  return {
    content: mode === "tail" ? content.slice(content.length - maxChars) : content.slice(0, maxChars),
    truncated: true
  };
}
