import type { FileToolHost } from "@ore-code/tools";
import type { RuntimeEvent } from "@ore-code/protocol";
import type { ChangeFileStat } from "./changeSummary";

export interface TrackedFileChange {
  id: string;
  path: string;
  changeKind: "created" | "updated";
  existedBefore: boolean;
  beforeContent: string;
  afterContent: string;
  diff: string;
  additions: number;
  deletions: number;
  undoable: boolean;
}

type FileChangedEvent = Extract<RuntimeEvent, { type: "file_changed" }>;

export interface RestoredTurnChanges {
  paths: Set<string>;
  turnRestored: boolean;
}

export function createChangeTrackingFileHost(
  host: FileToolHost,
  onChange: (change: TrackedFileChange) => void
): FileToolHost {
  return {
    ...host,
    async writeText(input) {
      const before = await readBeforeWrite(host, input.workspacePath, input.path);
      const output = await host.writeText(input);
      const path = normalizeTrackedPath(output.path, input.workspacePath);
      const diff = buildUnifiedDiff(path, before.content, input.content, before.existed);
      const stat = countDiffLines(diff);

      onChange({
        id: crypto.randomUUID(),
        path,
        changeKind: before.existed ? "updated" : "created",
        existedBefore: before.existed,
        beforeContent: before.content,
        afterContent: input.content,
        diff,
        additions: stat.additions,
        deletions: stat.deletions,
        undoable: before.existed || Boolean(host.deleteFile)
      });

      return output;
    }
  };
}

export function buildTrackedChangeFileStats(changes: TrackedFileChange[]): ChangeFileStat[] {
  const files = new Map<string, ChangeFileStat>();

  for (const change of changes) {
    const existing = files.get(change.path);
    const nextStatus = change.changeKind === "created" ? "A" : "M";

    files.set(change.path, {
      path: change.path,
      status: existing && existing.status !== nextStatus ? "M" : nextStatus,
      additions: (existing?.additions ?? 0) + change.additions,
      deletions: (existing?.deletions ?? 0) + change.deletions
    });
  }

  return [...files.values()];
}

export function latestTrackedChangeForPath(changes: TrackedFileChange[], path: string): TrackedFileChange | null {
  for (let index = changes.length - 1; index >= 0; index -= 1) {
    if (changes[index].path === path || changes[index].path.endsWith(`/${path}`)) {
      return changes[index];
    }
  }

  return null;
}

export function latestTurnTrackedChangesFromEvents(events: RuntimeEvent[]): TrackedFileChange[] {
  const turnId = latestUserTurnId(events);
  if (!turnId) {
    return [];
  }

  return events
    .filter((event): event is FileChangedEvent => event.turnId === turnId && event.type === "file_changed")
    .map((event) => ({
      id: event.id,
      path: event.path,
      changeKind: event.changeKind === "deleted" ? "updated" : event.changeKind,
      existedBefore: event.existedBefore ?? event.changeKind !== "created",
      beforeContent: event.beforeContent ?? "",
      afterContent: event.afterContent ?? "",
      diff: event.diff ?? "",
      additions: event.additions ?? 0,
      deletions: event.deletions ?? 0,
      undoable: event.undoable ?? Boolean(event.beforeContent || event.changeKind === "created")
    }))
    .filter((change) => change.undoable);
}

export function latestRestoredPathsForTurn(events: RuntimeEvent[]): RestoredTurnChanges {
  const turnId = latestUserTurnId(events);
  const restored: RestoredTurnChanges = { paths: new Set<string>(), turnRestored: false };
  if (!turnId) {
    return restored;
  }

  for (const event of events) {
    if (event.turnId !== turnId || event.type !== "snapshot_restored" || !event.ok) {
      continue;
    }

    if (event.scope === "turn") {
      restored.turnRestored = true;
    }

    for (const path of event.paths) {
      restored.paths.add(path);
    }
  }

  return restored;
}

export function buildVisibleTurnChanges(
  events: RuntimeEvent[],
  trackedChanges: TrackedFileChange[],
  persistedStats: ChangeFileStat[]
): ChangeFileStat[] {
  const restored = latestRestoredPathsForTurn(events);
  if (restored.turnRestored) {
    return [];
  }

  const files = trackedChanges.length > 0 ? buildTrackedChangeFileStats(trackedChanges) : persistedStats;
  if (restored.paths.size === 0) {
    return files;
  }

  return files.filter((file) => !restored.paths.has(file.path));
}

export async function undoTrackedChanges(host: FileToolHost, workspacePath: string, changes: TrackedFileChange[]) {
  const failures: string[] = [];

  for (const change of [...changes].reverse()) {
    try {
      if (change.existedBefore) {
        await host.writeText({ workspacePath, path: change.path, content: change.beforeContent });
      } else if (host.deleteFile) {
        await host.deleteFile({ workspacePath, path: change.path });
      } else {
        failures.push(`${change.path}: 当前运行环境不支持删除新建文件`);
      }
    } catch (error) {
      failures.push(`${change.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    ok: failures.length === 0,
    failures
  };
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

function buildUnifiedDiff(path: string, before: string, after: string, existedBefore: boolean) {
  const oldLines = splitLines(before);
  const newLines = splitLines(after);
  const lines = [`--- ${existedBefore ? `a/${path}` : "/dev/null"}`, `+++ b/${path}`];
  const oldLength = existedBefore ? oldLines.length : 0;
  lines.push(`@@ -1,${oldLength} +1,${newLines.length} @@`);

  if (existedBefore) {
    for (const line of oldLines) {
      lines.push(`-${line}`);
    }
  }

  for (const line of newLines) {
    lines.push(`+${line}`);
  }

  return lines.join("\n");
}

function countDiffLines(diff: string) {
  let additions = 0;
  let deletions = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      additions += 1;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      deletions += 1;
    }
  }

  return { additions, deletions };
}

function splitLines(content: string) {
  if (!content) {
    return [];
  }

  return content.replace(/\n$/, "").split(/\r?\n/);
}

async function readBeforeWrite(host: FileToolHost, workspacePath: string, path: string) {
  try {
    const result = await host.readText({ workspacePath, path });
    return { existed: true, content: result.content };
  } catch {
    return { existed: false, content: "" };
  }
}

function normalizeTrackedPath(path: string, workspacePath: string) {
  const normalizedWorkspace = workspacePath.replace(/\/$/, "");
  if (normalizedWorkspace !== "." && path.startsWith(`${normalizedWorkspace}/`)) {
    return path.slice(normalizedWorkspace.length + 1);
  }

  return path.replace(/^\.\//, "");
}
