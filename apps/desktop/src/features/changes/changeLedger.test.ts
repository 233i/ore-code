import { describe, expect, it } from "vitest";
import type { FileToolHost } from "@ore-code/tools";
import type { RuntimeEvent } from "@ore-code/protocol";
import {
  buildTrackedChangeFileStats,
  buildVisibleTurnChanges,
  createChangeTrackingFileHost,
  latestRestoredPathsForTurn,
  latestTurnTrackedChangesFromEvents,
  latestTrackedChangeForPath,
  undoTrackedChanges,
  type TrackedFileChange
} from "./changeLedger";

describe("changeLedger", () => {
  it("records real before/after diffs for writes", async () => {
    const changes: TrackedFileChange[] = [];
    const host = createChangeTrackingFileHost(makeMemoryHost({ "src/app.ts": "old\ntext" }), (change) =>
      changes.push(change)
    );

    await host.writeText({ workspacePath: "/workspace", path: "src/app.ts", content: "new" });

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      path: "src/app.ts",
      changeKind: "updated",
      additions: 1,
      deletions: 2,
      undoable: true
    });
    expect(changes[0].diff).toContain("-old");
    expect(changes[0].diff).toContain("+new");
  });

  it("summarizes multiple tracked writes by file", async () => {
    const changes: TrackedFileChange[] = [];
    const baseHost = makeMemoryHost({ "notes.md": "a" });
    const host = createChangeTrackingFileHost(baseHost, (change) => changes.push(change));

    await host.writeText({ workspacePath: "/workspace", path: "notes.md", content: "b" });
    await host.writeText({ workspacePath: "/workspace", path: "new.md", content: "hello\nworld" });

    expect(buildTrackedChangeFileStats(changes)).toEqual([
      { path: "notes.md", status: "M", additions: 1, deletions: 1 },
      { path: "new.md", status: "A", additions: 2, deletions: 0 }
    ]);
    expect(latestTrackedChangeForPath(changes, "new.md")?.changeKind).toBe("created");
  });

  it("undoes tracked changes in reverse order", async () => {
    const changes: TrackedFileChange[] = [];
    const baseHost = makeMemoryHost({ "src/app.ts": "old" });
    const host = createChangeTrackingFileHost(baseHost, (change) => changes.push(change));

    await host.writeText({ workspacePath: "/workspace", path: "src/app.ts", content: "new" });
    await host.writeText({ workspacePath: "/workspace", path: "created.txt", content: "created" });

    const result = await undoTrackedChanges(baseHost, "/workspace", changes);

    expect(result).toEqual({ ok: true, failures: [] });
    expect(baseHost.files).toEqual({ "src/app.ts": "old" });
  });

  it("restores undoable changes from persisted file_changed events", () => {
    const changes = latestTurnTrackedChangesFromEvents([
      event({ seq: 0, turnId: "turn-1", type: "user_message", text: "old task" }),
      event({
        seq: 1,
        turnId: "turn-1",
        type: "file_changed",
        path: "old.txt",
        changeKind: "updated",
        existedBefore: true,
        beforeContent: "before",
        afterContent: "after",
        additions: 1,
        deletions: 1,
        undoable: true
      }),
      event({ seq: 2, turnId: "turn-2", type: "user_message", text: "new task" }),
      event({
        seq: 3,
        turnId: "turn-2",
        type: "file_changed",
        path: "new.txt",
        changeKind: "created",
        existedBefore: false,
        beforeContent: "",
        afterContent: "created",
        additions: 1,
        deletions: 0,
        undoable: true
      })
    ]);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      path: "new.txt",
      changeKind: "created",
      existedBefore: false,
      afterContent: "created"
    });
  });

  it("filters single-file snapshot restore events from visible turn changes", () => {
    const events: RuntimeEvent[] = [
      event({ seq: 0, turnId: "turn-1", type: "user_message", text: "edit" }),
      event({
        seq: 1,
        turnId: "turn-1",
        type: "snapshot_restored",
        snapshotId: "snapshot-1",
        scope: "file",
        paths: ["a.txt"],
        ok: true
      })
    ];

    expect([...latestRestoredPathsForTurn(events).paths]).toEqual(["a.txt"]);
    expect(buildVisibleTurnChanges(events, [], [
      { path: "a.txt", status: "M", additions: 1, deletions: 1 },
      { path: "b.txt", status: "M", additions: 1, deletions: 1 }
    ])).toEqual([{ path: "b.txt", status: "M", additions: 1, deletions: 1 }]);
  });

  it("hides all visible turn changes after a full snapshot restore", () => {
    const events: RuntimeEvent[] = [
      event({ seq: 0, turnId: "turn-1", type: "user_message", text: "edit" }),
      event({
        seq: 1,
        turnId: "turn-1",
        type: "snapshot_restored",
        snapshotId: "snapshot-1",
        scope: "turn",
        paths: ["a.txt", "b.txt"],
        ok: true
      })
    ];

    expect(buildVisibleTurnChanges(events, [], [
      { path: "a.txt", status: "M", additions: 1, deletions: 1 }
    ])).toEqual([]);
  });
});

function event<T extends Omit<RuntimeEvent, "id" | "threadId" | "createdAt">>(input: T): RuntimeEvent {
  return {
    id: `event-${input.seq}`,
    threadId: "thread-1",
    createdAt: "2026-05-11T00:00:00.000Z",
    ...input
  } as RuntimeEvent;
}

function makeMemoryHost(initialFiles: Record<string, string>): FileToolHost & { files: Record<string, string> } {
  const files = { ...initialFiles };

  return {
    files,
    async readText(input) {
      if (!(input.path in files)) {
        throw new Error("file not found");
      }

      return {
        path: input.path,
        content: files[input.path]
      };
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
      return {
        path: input.path,
        bytesWritten: input.content.length
      };
    },
    async deleteFile(input) {
      delete files[input.path];
    }
  };
}
