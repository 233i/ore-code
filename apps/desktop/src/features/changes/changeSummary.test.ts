import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "@seekforge/protocol";
import { buildChangeFileStats, buildTaskChangeFileStats, sumChangeStat } from "./changeSummary";

describe("buildChangeFileStats", () => {
  it("counts additions and deletions per changed file", () => {
    const files = buildChangeFileStats(
      {
        isRepo: true,
        entries: [
          { status: "M", path: "src/app.ts" },
          { status: "A", path: "src/new.ts" }
        ],
        raw: ""
      },
      [
        "diff --git a/src/app.ts b/src/app.ts",
        "--- a/src/app.ts",
        "+++ b/src/app.ts",
        "@@ -1,2 +1,3 @@",
        "-old",
        "+new",
        "+next",
        " context",
        "diff --git a/src/new.ts b/src/new.ts",
        "--- /dev/null",
        "+++ b/src/new.ts",
        "@@ -0,0 +1 @@",
        "+created"
      ].join("\n")
    );

    expect(files).toEqual([
      { path: "src/app.ts", status: "M", additions: 2, deletions: 1 },
      { path: "src/new.ts", status: "A", additions: 1, deletions: 0 }
    ]);
    expect(sumChangeStat(files, "additions")).toBe(3);
    expect(sumChangeStat(files, "deletions")).toBe(1);
  });

  it("keeps status-only entries when diff has no line stats", () => {
    expect(
      buildChangeFileStats(
        {
          isRepo: true,
          entries: [{ status: "??", path: "untracked.txt" }],
          raw: ""
        },
        ""
      )
    ).toEqual([{ path: "untracked.txt", status: "??", additions: 0, deletions: 0 }]);
  });
});

describe("buildTaskChangeFileStats", () => {
  it("returns only files changed by the latest task write tools", () => {
    const events: RuntimeEvent[] = [
      event({ id: "u1", turnId: "turn-1", type: "user_message", text: "old task" }),
      event({
        id: "old-call",
        turnId: "turn-1",
        type: "tool_call_requested",
        call: { id: "write-old", name: "write_file", input: { path: "old.md", content: "# Old" } }
      }),
      event({
        id: "old-done",
        turnId: "turn-1",
        type: "tool_completed",
        result: { callId: "write-old", ok: true, output: { path: "old.md", bytesWritten: 5 } }
      }),
      event({ id: "u2", turnId: "turn-2", type: "user_message", text: "new task" }),
      event({
        id: "edit-call",
        turnId: "turn-2",
        type: "tool_call_requested",
        call: {
          id: "edit-1",
          name: "edit_file",
          input: { path: "src/App.tsx", oldText: "old\ntext", newText: "new" }
        }
      }),
      event({
        id: "edit-done",
        turnId: "turn-2",
        type: "tool_completed",
        result: { callId: "edit-1", ok: true, output: { path: "src/App.tsx", bytesWritten: 3, replacements: 1 } }
      })
    ];

    expect(buildTaskChangeFileStats(events)).toEqual([
      { path: "src/App.tsx", status: "M", additions: 1, deletions: 2 }
    ]);
  });

  it("returns empty when the latest task has no file writes", () => {
    const events: RuntimeEvent[] = [
      event({ id: "u1", turnId: "turn-1", type: "user_message", text: "list files" }),
      event({
        id: "list-call",
        turnId: "turn-1",
        type: "tool_call_requested",
        call: { id: "list-1", name: "list_dir", input: { path: "." } }
      }),
      event({
        id: "list-done",
        turnId: "turn-1",
        type: "tool_completed",
        result: { callId: "list-1", ok: true, output: { entries: [] } }
      })
    ];

    expect(buildTaskChangeFileStats(events)).toEqual([]);
  });

  it("uses persisted file_changed events for the latest task", () => {
    const events: RuntimeEvent[] = [
      event({ id: "u1", turnId: "turn-1", type: "user_message", text: "old task" }),
      event({
        id: "old-change",
        turnId: "turn-1",
        type: "file_changed",
        path: "old.md",
        changeKind: "created",
        additions: 1,
        deletions: 0,
        diff: "--- /dev/null\n+++ b/old.md\n+old"
      }),
      event({ id: "u2", turnId: "turn-2", type: "user_message", text: "new task" }),
      event({
        id: "new-call",
        turnId: "turn-2",
        type: "tool_call_requested",
        call: { id: "write-new", name: "write_file", input: { path: "src/new.ts", content: "a\nb\nc" } }
      }),
      event({
        id: "new-done",
        turnId: "turn-2",
        type: "tool_completed",
        result: { callId: "write-new", ok: true, output: { path: "src/new.ts", bytesWritten: 5 } }
      }),
      event({
        id: "new-change",
        turnId: "turn-2",
        type: "file_changed",
        path: "src/new.ts",
        changeKind: "updated",
        additions: 3,
        deletions: 1,
        diff: "--- a/src/new.ts\n+++ b/src/new.ts\n-old\n+new"
      })
    ];

    expect(buildTaskChangeFileStats(events)).toEqual([
      { path: "src/new.ts", status: "M", additions: 3, deletions: 1 }
    ]);
  });
});

function event<T extends Omit<RuntimeEvent, "seq" | "threadId" | "createdAt">>(input: T): RuntimeEvent {
  return {
    seq: 1,
    threadId: "thread-1",
    createdAt: "2026-05-10T00:00:00.000Z",
    ...input
  } as RuntimeEvent;
}
