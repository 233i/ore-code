import type { GitStatusHostOutput } from "@seekforge/tools";
import type { RuntimeEvent, ToolCall } from "@seekforge/protocol";

export interface ChangeFileStat {
  path: string;
  status: string;
  additions: number;
  deletions: number;
}

export function buildChangeFileStats(status: GitStatusHostOutput, diff: string): ChangeFileStat[] {
  const diffStats = parseUnifiedDiffStats(diff);
  const statusEntries = status.entries.map((entry) => ({
    path: normalizeGitStatusPath(entry.path),
    status: entry.status,
    additions: diffStats.get(normalizeGitStatusPath(entry.path))?.additions ?? 0,
    deletions: diffStats.get(normalizeGitStatusPath(entry.path))?.deletions ?? 0
  }));

  const statusPaths = new Set(statusEntries.map((entry) => entry.path));
  const diffOnlyEntries = [...diffStats.entries()]
    .filter(([path]) => !statusPaths.has(path))
    .map(([path, stat]) => ({
      path,
      status: "M",
      additions: stat.additions,
      deletions: stat.deletions
    }));

  return [...statusEntries, ...diffOnlyEntries].filter((entry) => entry.path);
}

export function buildTaskChangeFileStats(events: RuntimeEvent[]): ChangeFileStat[] {
  const turnId = latestUserTurnId(events);
  if (!turnId) {
    return [];
  }

  const turnEvents = events.filter((event) => event.turnId === turnId);
  const persistedFileChanges = turnEvents.filter((event) => event.type === "file_changed");
  if (persistedFileChanges.length > 0) {
    const persistedFiles = new Map<string, ChangeFileStat>();
    for (const event of persistedFileChanges) {
      mergeChangeStat(persistedFiles, {
        path: event.path,
        status: statusFromChangeKind(event.changeKind),
        additions: event.additions ?? 0,
        deletions: event.deletions ?? 0
      });
    }
    return [...persistedFiles.values()];
  }

  const calls = new Map<string, ToolCall>();
  const files = new Map<string, ChangeFileStat>();

  for (const event of turnEvents) {
    if (event.type === "tool_call_requested" || event.type === "tool_started" || event.type === "approval_requested") {
      calls.set(event.call.id, event.call);
      continue;
    }

    if (event.type !== "tool_completed" || !event.result.ok) {
      continue;
    }

    const call = calls.get(event.result.callId);
    if (!call) {
      continue;
    }

    for (const stat of statsFromToolResult(call, event.result.output)) {
      mergeChangeStat(files, stat);
    }
  }

  return [...files.values()];
}

export function sumChangeStat(files: ChangeFileStat[], key: "additions" | "deletions") {
  return files.reduce((sum, file) => sum + file[key], 0);
}

function latestUserTurnId(events: RuntimeEvent[]) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === "user_message") {
      return event.turnId;
    }
  }

  return null;
}

function statsFromToolResult(call: ToolCall, output: unknown): ChangeFileStat[] {
  if (call.name === "write_file") {
    const path = stringFromOutputPath(output, call.input);
    if (!path) {
      return [];
    }

    return [
      {
        path,
        status: "W",
        additions: lineCount(readStringField(call.input, "content")),
        deletions: 0
      }
    ];
  }

  if (call.name === "edit_file") {
    const path = stringFromOutputPath(output, call.input);
    if (!path) {
      return [];
    }

    return [
      {
        path,
        status: "M",
        additions: lineCount(readStringField(call.input, "newText")),
        deletions: lineCount(readStringField(call.input, "oldText"))
      }
    ];
  }

  if (call.name === "apply_patch") {
    const files = arrayField(output, "files");
    const patchStats = parseUnifiedDiffStats(readStringField(call.input, "patch"));
    return files.flatMap((file) => {
      const path = readStringField(file, "path");
      if (!path) {
        return [];
      }

      const stat = patchStats.get(path) ?? { additions: 0, deletions: 0 };
      return [{ path, status: "M", additions: stat.additions, deletions: stat.deletions }];
    });
  }

  return [];
}

function mergeChangeStat(files: Map<string, ChangeFileStat>, next: ChangeFileStat) {
  const existing = files.get(next.path);
  if (!existing) {
    files.set(next.path, next);
    return;
  }

  files.set(next.path, {
    path: next.path,
    status: existing.status === next.status ? existing.status : next.status,
    additions: existing.additions + next.additions,
    deletions: existing.deletions + next.deletions
  });
}

function statusFromChangeKind(kind: Extract<RuntimeEvent, { type: "file_changed" }>["changeKind"]) {
  switch (kind) {
    case "created":
      return "A";
    case "deleted":
      return "D";
    default:
      return "M";
  }
}

function stringFromOutputPath(output: unknown, fallbackInput: unknown) {
  return readStringField(output, "path") || readStringField(fallbackInput, "path");
}

function readStringField(value: unknown, key: string) {
  if (!value || typeof value !== "object" || !(key in value)) {
    return "";
  }

  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : "";
}

function arrayField(value: unknown, key: string) {
  if (!value || typeof value !== "object" || !(key in value)) {
    return [];
  }

  const field = (value as Record<string, unknown>)[key];
  return Array.isArray(field) ? field : [];
}

function lineCount(value: string) {
  if (!value) {
    return 0;
  }

  return value.replace(/\n$/, "").split(/\r?\n/).length;
}

export function parseUnifiedDiffStats(diff: string): Map<string, Pick<ChangeFileStat, "additions" | "deletions">> {
  const stats = new Map<string, Pick<ChangeFileStat, "additions" | "deletions">>();
  let currentPath: string | null = null;

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      currentPath = parseDiffGitPath(line);
      if (currentPath && !stats.has(currentPath)) {
        stats.set(currentPath, { additions: 0, deletions: 0 });
      }
      continue;
    }

    if (line.startsWith("+++ ")) {
      const nextPath = normalizeDiffPath(line.slice(4));
      if (nextPath && nextPath !== "/dev/null") {
        currentPath = nextPath;
        if (!stats.has(currentPath)) {
          stats.set(currentPath, { additions: 0, deletions: 0 });
        }
      }
      continue;
    }

    if (!currentPath) {
      continue;
    }

    const current = stats.get(currentPath) ?? { additions: 0, deletions: 0 };
    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.additions += 1;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      current.deletions += 1;
    }
    stats.set(currentPath, current);
  }

  return stats;
}

function parseDiffGitPath(line: string) {
  const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
  return normalizeDiffPath(match?.[2] ?? "");
}

function normalizeDiffPath(path: string) {
  return path.replace(/^"?[ab]\//, "").replace(/"$/, "");
}

function normalizeGitStatusPath(path: string) {
  return path.split(" -> ").pop() ?? path;
}
