import { invoke } from "@tauri-apps/api/core";
import { SnapshotRecordSchema, type SnapshotRecord } from "@ore-code/protocol";
import type { FileToolHost } from "@ore-code/tools";
import type { TrackedFileChange } from "../features/changes/changeLedger";
import { createRuntimeFileHost, isTauriRuntime } from "./fileHost";

const BROWSER_SNAPSHOT_PREFIX = "ore-code.turnSnapshots.";

export interface TurnSnapshotStore {
  saveTurnSnapshot(record: SnapshotRecord): Promise<SnapshotRecord>;
  loadTurnSnapshot(snapshotId: string): Promise<SnapshotRecord>;
  saveSideSnapshot(input: SideSnapshotCreateInput): Promise<SideSnapshotRecord | null>;
  restoreTurnSnapshot(snapshotId: string, workspacePath: string, fileHost?: FileToolHost): Promise<SnapshotRestoreResult>;
  restoreTurnSnapshotFile(snapshotId: string, workspacePath: string, path: string, fileHost?: FileToolHost): Promise<SnapshotRestoreResult>;
}

export interface SideSnapshotCreateInput {
  label: "pre-turn" | "post-turn";
  snapshotId: string;
  threadId: string;
  turnId: string;
  workspacePath: string;
}

export interface SideSnapshotRecord {
  id: string;
  threadId: string;
  turnId: string;
  workspacePath: string;
  label: "pre-turn" | "post-turn";
  createdAt: string;
  fileCount: number;
  sideGitCommit?: string;
  sideGitBranch?: string;
  sideGitRepoPath?: string;
}

export type SnapshotRestoreResult = {
  ok: boolean;
  restoredFiles: string[];
  failures: string[];
  sideSnapshotId?: string;
  sideGitCommit?: string;
};

type TurnSnapshotBaseStore = Pick<TurnSnapshotStore, "saveTurnSnapshot" | "loadTurnSnapshot" | "saveSideSnapshot"> & {
  restoreSideSnapshot?: (snapshotId: string, workspacePath: string) => Promise<SnapshotRestoreResult>;
};

export function createTurnSnapshotStore(): TurnSnapshotStore {
  const baseStore: TurnSnapshotBaseStore = isTauriRuntime() ? createTauriTurnSnapshotStore() : createBrowserTurnSnapshotStore();

  return {
    ...baseStore,
    async saveSideSnapshot(input) {
      return baseStore.saveSideSnapshot(input);
    },
    async restoreTurnSnapshot(snapshotId, workspacePath, fileHost = createRuntimeFileHost()) {
      const snapshot = await baseStore.loadTurnSnapshot(snapshotId);
      if (snapshot.sideSnapshotId && baseStore.restoreSideSnapshot) {
        return baseStore.restoreSideSnapshot(snapshot.sideSnapshotId, workspacePath);
      }
      return restoreSnapshotWithHost(snapshot, workspacePath, fileHost);
    },
    async restoreTurnSnapshotFile(snapshotId, workspacePath, path, fileHost = createRuntimeFileHost()) {
      const snapshot = await baseStore.loadTurnSnapshot(snapshotId);
      return restoreSnapshotFileWithHost(snapshot, workspacePath, path, fileHost);
    }
  };
}

export function snapshotFromTrackedChanges(input: {
  changes: TrackedFileChange[];
  threadId: string;
  turnId: string;
  workspacePath: string;
  createdAt?: string;
  id?: string;
  sideSnapshotId?: string;
  sidePostSnapshotId?: string;
  sideGitCommit?: string;
  sidePostGitCommit?: string;
  sideGitBranch?: string;
}): SnapshotRecord {
  const id = input.id ?? `snapshot-${input.turnId}`;

  return {
    id,
    threadId: input.threadId,
    turnId: input.turnId,
    workspacePath: input.workspacePath,
    createdAt: input.createdAt ?? new Date().toISOString(),
    sideSnapshotId: input.sideSnapshotId,
    sidePostSnapshotId: input.sidePostSnapshotId,
    sideGitCommit: input.sideGitCommit,
    sidePostGitCommit: input.sidePostGitCommit,
    sideGitBranch: input.sideGitBranch,
    files: input.changes.map((change, index) => ({
      path: change.path,
      changeKind: change.changeKind,
      existedBefore: change.existedBefore,
      beforeContentRef: `${id}/${index}/before.txt`,
      afterContentRef: `${id}/${index}/after.txt`,
      additions: change.additions,
      deletions: change.deletions,
      diffRef: `${id}/${index}/diff.patch`,
      beforeContent: change.beforeContent,
      afterContent: change.afterContent,
      diff: change.diff
    }))
  };
}

export function trackedChangesFromSnapshot(snapshot: SnapshotRecord): TrackedFileChange[] {
  return snapshot.files
    .map((file) => ({
      id: `${snapshot.id}:${file.path}`,
      path: file.path,
      changeKind: file.changeKind === "deleted" ? "updated" as const : file.changeKind,
      existedBefore: file.existedBefore,
      beforeContent: file.beforeContent ?? "",
      afterContent: file.afterContent ?? "",
      diff: file.diff ?? "",
      additions: file.additions,
      deletions: file.deletions,
      undoable: Boolean(file.beforeContent || !file.existedBefore)
    }))
    .filter((change) => change.undoable);
}

export async function restoreSnapshotWithHost(
  snapshot: SnapshotRecord,
  workspacePath: string,
  fileHost: FileToolHost
): Promise<SnapshotRestoreResult> {
  const failures: string[] = [];
  const restoredFiles: string[] = [];

  for (const file of [...snapshot.files].reverse()) {
    try {
      if (file.existedBefore) {
        if (typeof file.beforeContent !== "string") {
          failures.push(`${file.path}: snapshot 缺少 before 内容`);
          continue;
        }
        await fileHost.writeText({ workspacePath, path: file.path, content: file.beforeContent });
      } else if (fileHost.deleteFile) {
        await fileHost.deleteFile({ workspacePath, path: file.path });
      } else {
        failures.push(`${file.path}: 当前运行环境不支持删除新建文件`);
        continue;
      }

      restoredFiles.push(file.path);
    } catch (error) {
      failures.push(`${file.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    ok: failures.length === 0,
    restoredFiles,
    failures
  };
}

export async function restoreSnapshotFileWithHost(
  snapshot: SnapshotRecord,
  workspacePath: string,
  path: string,
  fileHost: FileToolHost
): Promise<SnapshotRestoreResult> {
  const file = snapshot.files.find((item) => item.path === path);
  if (!file) {
    return {
      ok: false,
      restoredFiles: [],
      failures: [`${path}: snapshot 中没有该文件`]
    };
  }

  const failures: string[] = [];
  try {
    if (file.existedBefore) {
      if (typeof file.beforeContent !== "string") {
        return {
          ok: false,
          restoredFiles: [],
          failures: [`${file.path}: snapshot 缺少 before 内容`]
        };
      }

      await fileHost.writeText({ workspacePath, path: file.path, content: file.beforeContent });
    } else if (fileHost.deleteFile) {
      await fileHost.deleteFile({ workspacePath, path: file.path });
    } else {
      failures.push(`${file.path}: 当前运行环境不支持删除新建文件`);
    }
  } catch (error) {
    failures.push(`${file.path}: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    ok: failures.length === 0,
    restoredFiles: failures.length === 0 ? [file.path] : [],
    failures
  };
}

function createTauriTurnSnapshotStore(): Pick<TurnSnapshotStore, "saveTurnSnapshot" | "loadTurnSnapshot" | "saveSideSnapshot"> & {
  restoreSideSnapshot(snapshotId: string, workspacePath: string): Promise<SnapshotRestoreResult>;
} {
  return {
    async saveTurnSnapshot(record) {
      const result = await invoke<unknown>("snapshot_save", { snapshot: record });
      return SnapshotRecordSchema.parse(result);
    },
    async loadTurnSnapshot(snapshotId) {
      const result = await invoke<unknown>("snapshot_load", { snapshotId });
      return SnapshotRecordSchema.parse(result);
    },
    async saveSideSnapshot(input) {
      const result = await invoke<SideSnapshotRecord>("side_snapshot_create", { ...input });
      return result;
    },
    async restoreSideSnapshot(snapshotId, workspacePath) {
      const result = await invoke<SnapshotRestoreResult>("side_snapshot_restore", { snapshotId, workspacePath });
      return result;
    }
  };
}

function createBrowserTurnSnapshotStore(): Pick<TurnSnapshotStore, "saveTurnSnapshot" | "loadTurnSnapshot" | "saveSideSnapshot"> {
  return {
    async saveTurnSnapshot(record) {
      const snapshot = SnapshotRecordSchema.parse(record);
      window.localStorage.setItem(browserSnapshotKey(snapshot.id), JSON.stringify(snapshot));
      return snapshot;
    },
    async loadTurnSnapshot(snapshotId) {
      const raw = window.localStorage.getItem(browserSnapshotKey(snapshotId));
      if (!raw) {
        throw new Error("snapshot not found");
      }

      return SnapshotRecordSchema.parse(JSON.parse(raw));
    },
    async saveSideSnapshot() {
      return null;
    }
  };
}

function browserSnapshotKey(snapshotId: string) {
  return `${BROWSER_SNAPSHOT_PREFIX}${snapshotId}`;
}
