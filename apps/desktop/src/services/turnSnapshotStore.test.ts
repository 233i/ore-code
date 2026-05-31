import { describe, expect, it } from "vitest";
import type { FileToolHost } from "@seekforge/tools";
import {
  restoreSnapshotFileWithHost,
  restoreSnapshotWithHost,
  snapshotFromTrackedChanges,
  trackedChangesFromSnapshot
} from "./turnSnapshotStore";
import type { TrackedFileChange } from "../features/changes/changeLedger";

describe("turnSnapshotStore", () => {
  it("creates restorable snapshot records from tracked changes", () => {
    const snapshot = snapshotFromTrackedChanges({
      changes: [trackedChange({ path: "src/app.ts", beforeContent: "old", afterContent: "new" })],
      threadId: "thread-1",
      turnId: "turn-1",
      workspacePath: "/workspace",
      createdAt: "2026-05-11T00:00:00.000Z",
      id: "snapshot-test",
      sideSnapshotId: "side-snapshot-turn-1-pre",
      sidePostSnapshotId: "side-snapshot-turn-1-post"
    });

    expect(snapshot).toMatchObject({
      id: "snapshot-test",
      threadId: "thread-1",
      turnId: "turn-1",
      workspacePath: "/workspace",
      sideSnapshotId: "side-snapshot-turn-1-pre",
      sidePostSnapshotId: "side-snapshot-turn-1-post",
      files: [
        {
          path: "src/app.ts",
          beforeContentRef: "snapshot-test/0/before.txt",
          afterContentRef: "snapshot-test/0/after.txt",
          diffRef: "snapshot-test/0/diff.patch"
        }
      ]
    });
    expect(trackedChangesFromSnapshot(snapshot)[0]).toMatchObject({
      path: "src/app.ts",
      beforeContent: "old",
      afterContent: "new",
      undoable: true
    });
  });

  it("restores modified files to their before content", async () => {
    const snapshot = snapshotFromTrackedChanges({
      changes: [trackedChange({ path: "note.txt", beforeContent: "before", afterContent: "after" })],
      threadId: "thread-1",
      turnId: "turn-1",
      workspacePath: "/workspace",
      id: "snapshot-restore"
    });
    const host = makeMemoryHost({ "note.txt": "after" });

    const result = await restoreSnapshotWithHost(snapshot, "/workspace", host);

    expect(result).toEqual({ ok: true, restoredFiles: ["note.txt"], failures: [] });
    expect(host.files["note.txt"]).toBe("before");
  });

  it("deletes files that were created during the turn", async () => {
    const snapshot = snapshotFromTrackedChanges({
      changes: [
        trackedChange({
          path: "created.txt",
          changeKind: "created",
          existedBefore: false,
          beforeContent: "",
          afterContent: "created"
        })
      ],
      threadId: "thread-1",
      turnId: "turn-1",
      workspacePath: "/workspace",
      id: "snapshot-delete"
    });
    const host = makeMemoryHost({ "created.txt": "created" });

    const result = await restoreSnapshotWithHost(snapshot, "/workspace", host);

    expect(result.ok).toBe(true);
    expect("created.txt" in host.files).toBe(false);
  });

  it("restores one modified file from a snapshot", async () => {
    const snapshot = snapshotFromTrackedChanges({
      changes: [
        trackedChange({ path: "a.txt", beforeContent: "a-before", afterContent: "a-after" }),
        trackedChange({ path: "b.txt", beforeContent: "b-before", afterContent: "b-after" })
      ],
      threadId: "thread-1",
      turnId: "turn-1",
      workspacePath: "/workspace",
      id: "snapshot-one-file"
    });
    const host = makeMemoryHost({ "a.txt": "a-after", "b.txt": "b-after" });

    const result = await restoreSnapshotFileWithHost(snapshot, "/workspace", "a.txt", host);

    expect(result).toEqual({ ok: true, restoredFiles: ["a.txt"], failures: [] });
    expect(host.files).toEqual({ "a.txt": "a-before", "b.txt": "b-after" });
  });

  it("fails one-file restore when before content is missing", async () => {
    const snapshot = snapshotFromTrackedChanges({
      changes: [trackedChange({ path: "broken.txt", beforeContent: undefined, afterContent: "after" })],
      threadId: "thread-1",
      turnId: "turn-1",
      workspacePath: "/workspace",
      id: "snapshot-broken"
    });
    snapshot.files[0].beforeContent = undefined;

    const result = await restoreSnapshotFileWithHost(snapshot, "/workspace", "broken.txt", makeMemoryHost({ "broken.txt": "after" }));

    expect(result.ok).toBe(false);
    expect(result.failures[0]).toContain("snapshot 缺少 before 内容");
  });
});

function trackedChange(input: Partial<TrackedFileChange> & Pick<TrackedFileChange, "path">): TrackedFileChange {
  return {
    id: `change:${input.path}`,
    path: input.path,
    changeKind: input.changeKind ?? "updated",
    existedBefore: input.existedBefore ?? true,
    beforeContent: input.beforeContent ?? "before",
    afterContent: input.afterContent ?? "after",
    diff: input.diff ?? "--- a/file\n+++ b/file\n-before\n+after",
    additions: input.additions ?? 1,
    deletions: input.deletions ?? 1,
    undoable: input.undoable ?? true
  };
}

function makeMemoryHost(initialFiles: Record<string, string>): FileToolHost & { files: Record<string, string> } {
  const files = { ...initialFiles };

  return {
    files,
    async readText(input) {
      return { path: input.path, content: files[input.path] ?? "" };
    },
    async listDir() {
      return { entries: [] };
    },
    async searchFiles() {
      return { matches: [], truncated: false };
    },
    async grepFiles() {
      return { matches: [], truncated: false };
    },
    async writeText(input) {
      files[input.path] = input.content;
      return { path: input.path, bytesWritten: input.content.length };
    },
    async deleteFile(input) {
      delete files[input.path];
    }
  };
}
