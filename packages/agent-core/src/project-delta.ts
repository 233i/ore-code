import type { RuntimeEvent, ToolCall, ToolResult } from "@seekforge/protocol";

export type ProjectDeltaEvent = Extract<RuntimeEvent, { type: "project_delta" }>;
export type ProjectDeltaEventBody = Omit<ProjectDeltaEvent, "id" | "seq" | "threadId" | "turnId" | "createdAt">;

type ProjectDeltaChange = ProjectDeltaEvent["changedFiles"][number];
type ProjectDeltaTestResult = ProjectDeltaEvent["testResults"][number];
type ProjectDeltaError = ProjectDeltaEvent["errors"][number];
type ProjectDeltaArtifact = ProjectDeltaEvent["artifacts"][number];
type ProjectDeltaPinnedContext = ProjectDeltaEvent["pinnedContexts"][number];

const MAX_PATHS = 32;
const MAX_CHANGES = 24;
const MAX_TESTS = 8;
const MAX_ERRORS = 8;
const MAX_ARTIFACTS = 8;
const MAX_PINNED_CONTEXTS = 16;

export function buildProjectDeltaEventBody(events: readonly RuntimeEvent[], turnId: string): ProjectDeltaEventBody | null {
  const turnEvents = events.filter((event) => event.turnId === turnId);
  const toolCallsById = new Map<string, ToolCall>();
  for (const event of turnEvents) {
    if (event.type === "tool_call_requested") {
      toolCallsById.set(event.call.id, event.call);
    }
  }

  const changedFiles = uniqueChanges(turnEvents
    .filter((event): event is Extract<RuntimeEvent, { type: "file_changed" }> => event.type === "file_changed")
    .map((event) => ({
      path: event.path,
      changeKind: event.changeKind,
      additions: event.additions,
      deletions: event.deletions,
      snapshotId: event.snapshotId
    })));
  const readPaths = uniqueStrings(turnEvents
    .flatMap((event) => event.type === "tool_call_requested" ? readPathsFromToolCall(event.call) : []));
  const toolResultEvents = turnEvents
    .filter((event): event is Extract<RuntimeEvent, { type: "tool_completed" | "tool_failed" }> =>
      event.type === "tool_completed" || event.type === "tool_failed"
    );
  const testResults = toolResultEvents
    .map((event) => testResultFromToolEvent(event.result, toolCallsById.get(event.result.callId)))
    .filter((result): result is ProjectDeltaTestResult => Boolean(result))
    .slice(0, MAX_TESTS);
  const errors = [
    ...toolResultEvents
      .map((event) => errorFromToolEvent(event.result, toolCallsById.get(event.result.callId)))
      .filter((error): error is ProjectDeltaError => Boolean(error)),
    ...turnEvents
      .filter((event): event is Extract<RuntimeEvent, { type: "turn_failed" }> => event.type === "turn_failed")
      .map((event) => ({ source: "turn" as const, message: event.message }))
  ].slice(0, MAX_ERRORS);
  const artifacts = toolResultEvents
    .map((event) => artifactFromToolResult(event.result))
    .filter((artifact): artifact is ProjectDeltaArtifact => Boolean(artifact))
    .slice(0, MAX_ARTIFACTS);
  const pinnedContexts = derivePinnedContexts(events, turnId);
  const pinnedPaths = pinnedContexts
    .filter((context) => context.kind === "path")
    .map((context) => context.value);
  const workingSetPaths = uniqueStrings([
    ...changedFiles.map((change) => change.path),
    ...readPaths,
    ...pinnedPaths
  ]).slice(0, MAX_PATHS);

  if (
    changedFiles.length === 0 &&
    readPaths.length === 0 &&
    testResults.length === 0 &&
    errors.length === 0 &&
    artifacts.length === 0 &&
    pinnedContexts.length === 0
  ) {
    return null;
  }

  return {
    type: "project_delta",
    summary: projectDeltaSummary({
      artifacts,
      changedFiles,
      errors,
      readPaths,
      pinnedContexts,
      testResults,
      workingSetPaths
    }),
    readPaths: readPaths.slice(0, MAX_PATHS),
    changedFiles: changedFiles.slice(0, MAX_CHANGES),
    testResults,
    errors,
    artifacts,
    pinnedContexts,
    workingSetPaths
  };
}

export function formatProjectDeltaForModel(event: ProjectDeltaEvent): string {
  const body = [
    `[project_delta:${event.turnId}]`,
    `Summary: ${event.summary}`,
    formatSection("Changed files", event.changedFiles.map(formatChangedFile)),
    formatSection("Read or inspected paths", event.readPaths),
    formatSection("Tests and checks", event.testResults.map(formatTestResult)),
    formatSection("Errors", event.errors.map(formatError)),
    formatSection("Artifacts", event.artifacts.map(formatArtifact)),
    formatSection("Pinned context", event.pinnedContexts.map(formatPinnedContext)),
    formatSection("Working set", event.workingSetPaths)
  ].filter(Boolean).join("\n");

  return [
    "<internal_project_delta>",
    "This is internal project-state context for continuity only. Use it to remember changed files, inspected paths, artifacts, tests, errors, pinned context, and working set. Do not quote, summarize, append, or mention this block in visible user-facing replies unless the user explicitly asks to inspect internal context.",
    body,
    "</internal_project_delta>"
  ].join("\n");
}

function readPathsFromToolCall(call: ToolCall): string[] {
  if (!isReadLikeTool(call.name)) {
    return [];
  }
  const input = recordValue(call.input);
  if (!input) {
    return [];
  }

  return uniqueStrings([
    ...pathStrings(input.path),
    ...pathStrings(input.paths),
    ...pathStrings(input.target),
    ...pathStrings(input.destination),
    ...pathStrings(input.cwd),
    ...pathStrings(input.workdir),
    ...pathStrings(input.file),
    ...pathStrings(input.files)
  ]);
}

function isReadLikeTool(name: string) {
  return [
    "read_file",
    "list_dir",
    "grep_files",
    "file_search",
    "git_status",
    "git_diff",
    "git_log",
    "git_show",
    "git_blame",
    "lsp_hover",
    "lsp_definition",
    "lsp_references",
    "lsp_document_symbols"
  ].includes(name);
}

function testResultFromToolEvent(result: ToolResult, call: ToolCall | undefined): ProjectDeltaTestResult | null {
  if (!call || !isTestToolCall(call)) {
    return null;
  }
  const output = recordValue(result.output);
  const command = stringValue(output?.command) ?? commandFromToolCall(call);
  const exitCode = numberValue(output?.exitCode);
  const timedOut = booleanValue(output?.timedOut ?? output?.timeout);

  return {
    toolName: call.name,
    command,
    ok: result.ok && exitCode !== undefined ? exitCode === 0 : result.ok,
    exitCode,
    timedOut,
    artifactId: result.artifactId,
    summary: compactSummary(output?.summary ?? output?.artifactSummary ?? output?.stderr ?? output?.stdout)
  };
}

function isTestToolCall(call: ToolCall) {
  if (call.name === "run_tests") {
    return true;
  }
  if (call.name !== "exec_shell") {
    return false;
  }
  const command = commandFromToolCall(call);
  return Boolean(command && /\b(test|vitest|jest|pytest|cargo test|go test|dotnet test|pnpm test|npm test|yarn test|bun test)\b/i.test(command));
}

function commandFromToolCall(call: ToolCall | undefined) {
  const input = recordValue(call?.input);
  return stringValue(input?.command);
}

function errorFromToolEvent(result: ToolResult, call: ToolCall | undefined): ProjectDeltaError | null {
  if (result.ok && !result.error) {
    return null;
  }
  const message = result.error?.message ?? errorMessageFromOutput(result.output);
  if (!message) {
    return null;
  }
  const input = recordValue(call?.input);
  return {
    source: "tool",
    toolName: call?.name,
    message: compactSummary(message) ?? message,
    path: stringValue(input?.path)
  };
}

function errorMessageFromOutput(output: unknown) {
  const record = recordValue(output);
  return compactSummary(record?.stderr ?? record?.error ?? record?.message);
}

function artifactFromToolResult(result: ToolResult): ProjectDeltaArtifact | null {
  if (!result.artifactId) {
    return null;
  }
  const output = recordValue(result.output);
  return {
    artifactId: result.artifactId,
    sourceCallId: result.callId,
    summary: compactSummary(output?.artifactSummary ?? output?.summary),
    type: stringValue(output?.artifactType),
    size: numberValue(output?.artifactSize)
  };
}

function derivePinnedContexts(events: readonly RuntimeEvent[], turnId: string): ProjectDeltaPinnedContext[] {
  const pinned = new Map<string, ProjectDeltaPinnedContext>();
  for (const event of events) {
    if (event.type !== "project_delta" || event.turnId === turnId) {
      continue;
    }
    for (const context of event.pinnedContexts) {
      pinned.set(pinnedKey(context), context);
    }
  }

  const currentUserMessages = events
    .filter((event): event is Extract<RuntimeEvent, { type: "user_message" }> =>
      event.turnId === turnId && event.type === "user_message"
    )
    .map((event) => event.text);

  for (const text of currentUserMessages) {
    if (isClearPinnedContextIntent(text)) {
      pinned.clear();
      continue;
    }

    if (isUnpinContextIntent(text)) {
      for (const value of extractContextPaths(text)) {
        pinned.delete(`path:${value}`);
      }
      continue;
    }

    if (!isPinContextIntent(text)) {
      continue;
    }

    const paths = extractContextPaths(text);
    if (paths.length > 0) {
      for (const path of paths) {
        const context: ProjectDeltaPinnedContext = {
          kind: "path",
          value: path,
          sourceTurnId: pinned.get(`path:${path}`)?.sourceTurnId ?? turnId,
          lastMentionedTurnId: turnId,
          reason: compactSummary(text)
        };
        pinned.set(pinnedKey(context), context);
      }
      continue;
    }

    const instruction = compactSummary(text);
    if (instruction) {
      const context: ProjectDeltaPinnedContext = {
        kind: "instruction",
        value: instruction,
        sourceTurnId: pinned.get(`instruction:${instruction}`)?.sourceTurnId ?? turnId,
        lastMentionedTurnId: turnId,
        reason: "Explicit long-term reference request."
      };
      pinned.set(pinnedKey(context), context);
    }
  }

  return [...pinned.values()]
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.value.localeCompare(right.value))
    .slice(0, MAX_PINNED_CONTEXTS);
}

function pinnedKey(context: Pick<ProjectDeltaPinnedContext, "kind" | "value">) {
  return `${context.kind}:${context.value}`;
}

function isPinContextIntent(text: string) {
  return /(?:后续|以后|之后|长期|一直|默认|每次|后面).{0,16}(?:参考|使用|基于|按照|遵循|以.+为准)/i.test(text) ||
    /(?:记住|固定|pin|pinned|加入长期上下文|加入上下文).{0,24}(?:参考|上下文|文件|目录|规范|规则|路径)?/i.test(text);
}

function isUnpinContextIntent(text: string) {
  return /(?:不要再|不再|取消|移除|删除|解除).{0,16}(?:参考|固定|pin|pinned|长期上下文|上下文)/i.test(text);
}

function isClearPinnedContextIntent(text: string) {
  return /(?:清空|全部清除|全部移除|重置).{0,16}(?:长期上下文|固定上下文|pinned context|pin)/i.test(text);
}

function extractContextPaths(text: string): string[] {
  const backtickPaths = [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
  const barePaths = text.match(/(?:[A-Za-z]:[\\/][^\s，。；、"'`]+|\/[^\s，。；、"'`]+|(?:[\w.@-]+[\\/])+[\w.@-]+(?:\.[\w.-]+)?|[\w.@-]+\.(?:md|mdx|txt|json|toml|ya?ml|ts|tsx|js|jsx|rs|go|py|cs|java|cpp|c|h|hpp|css|scss|html|vue|svelte))/g) ?? [];
  return uniqueStrings([...backtickPaths, ...barePaths]
    .map((path) => path.trim().replace(/[),.，。；;]+$/g, ""))
    .filter((path) => path.length > 0 && !/^https?:\/\//i.test(path)));
}

function projectDeltaSummary(input: {
  artifacts: ProjectDeltaArtifact[];
  changedFiles: ProjectDeltaChange[];
  errors: ProjectDeltaError[];
  pinnedContexts: ProjectDeltaPinnedContext[];
  readPaths: string[];
  testResults: ProjectDeltaTestResult[];
  workingSetPaths: string[];
}) {
  return [
    input.changedFiles.length ? `${input.changedFiles.length} changed file(s)` : "",
    input.readPaths.length ? `${input.readPaths.length} inspected path(s)` : "",
    input.testResults.length ? `${input.testResults.length} test/check result(s)` : "",
    input.errors.length ? `${input.errors.length} error(s)` : "",
    input.artifacts.length ? `${input.artifacts.length} artifact(s)` : "",
    input.pinnedContexts.length ? `${input.pinnedContexts.length} pinned context(s)` : "",
    input.workingSetPaths.length ? `${input.workingSetPaths.length} working path(s)` : ""
  ].filter(Boolean).join(", ") || "Project activity recorded.";
}

function formatChangedFile(change: ProjectDeltaChange) {
  const stats = [
    change.additions !== undefined ? `+${change.additions}` : "",
    change.deletions !== undefined ? `-${change.deletions}` : ""
  ].filter(Boolean).join(" ");
  return `${change.changeKind} ${change.path}${stats ? ` (${stats})` : ""}`;
}

function formatTestResult(result: ProjectDeltaTestResult) {
  return [
    `${result.toolName}: ${result.ok ? "ok" : "failed"}`,
    result.exitCode !== undefined ? `exit=${result.exitCode}` : "",
    result.timedOut ? "timed out" : "",
    result.command ? `command=${result.command}` : "",
    result.artifactId ? `artifact=${result.artifactId}` : "",
    result.summary ? `summary=${result.summary}` : ""
  ].filter(Boolean).join(", ");
}

function formatError(error: ProjectDeltaError) {
  return [
    error.source,
    error.toolName ? `tool=${error.toolName}` : "",
    error.path ? `path=${error.path}` : "",
    error.message
  ].filter(Boolean).join(", ");
}

function formatArtifact(artifact: ProjectDeltaArtifact) {
  return [
    artifact.artifactId,
    artifact.type ? `type=${artifact.type}` : "",
    artifact.size !== undefined ? `size=${artifact.size}` : "",
    artifact.summary ? `summary=${artifact.summary}` : ""
  ].filter(Boolean).join(", ");
}

function formatPinnedContext(context: ProjectDeltaPinnedContext) {
  return [
    `${context.kind}=${context.value}`,
    `source=${context.sourceTurnId}`,
    context.lastMentionedTurnId ? `mentioned=${context.lastMentionedTurnId}` : "",
    context.reason ? `reason=${context.reason}` : ""
  ].filter(Boolean).join(", ");
}

function formatSection(title: string, items: string[]) {
  if (items.length === 0) {
    return "";
  }
  return `${title}:\n${items.map((item) => `- ${item}`).join("\n")}`;
}

function uniqueChanges(changes: ProjectDeltaChange[]): ProjectDeltaChange[] {
  const byPath = new Map<string, ProjectDeltaChange>();
  for (const change of changes) {
    byPath.set(change.path, change);
  }
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function pathStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return value ? [value] : [];
  }
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  }
  return [];
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function compactSummary(value: unknown): string | undefined {
  const text = stringValue(value);
  if (!text) {
    return undefined;
  }
  return text.replace(/\s+/g, " ").slice(0, 240);
}
