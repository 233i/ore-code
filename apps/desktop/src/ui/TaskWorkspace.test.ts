import { describe, expect, it } from "vitest";
import type { DurableTaskSnapshot } from "@ore-code/agent-core";
import {
  buildTaskSummary,
  selectTaskForWorkspace,
  sortTasksForWorkspace,
  taskStatusCounts,
  taskVerificationSummary
} from "./TaskWorkspace";

describe("TaskWorkspace helpers", () => {
  it("counts task states and active work", () => {
    const counts = taskStatusCounts([
      durableTask({ status: "running" }),
      durableTask({ status: "queued" }),
      durableTask({ status: "failed" }),
      durableTask({ status: "completed" }),
      durableTask({ status: "canceled" })
    ]);

    expect(counts).toMatchObject({
      active: 3,
      canceled: 1,
      completed: 1,
      failed: 1,
      queued: 1,
      running: 1,
      total: 5
    });
  });

  it("selects running work before recency and keeps visible selection", () => {
    const completed = durableTask({ id: "done", status: "completed", updatedAt: "2026-01-03T00:00:00.000Z" });
    const failed = durableTask({ id: "failed", status: "failed", updatedAt: "2026-01-04T00:00:00.000Z" });
    const running = durableTask({ id: "running", status: "running", updatedAt: "2026-01-01T00:00:00.000Z" });

    expect(sortTasksForWorkspace([completed, failed, running]).map((task) => task.id)).toEqual(["running", "failed", "done"]);
    expect(selectTaskForWorkspace([completed, failed, running])).toBe("running");
    expect(selectTaskForWorkspace([completed, failed, running], "failed")).toBe("failed");
  });

  it("summarizes verification gates for the closed loop", () => {
    const task = durableTask({
      gates: [
        { id: 1, name: "lint", status: "passed", summary: "ok", createdAt: "2026-01-01T00:00:00.000Z" },
        { id: 2, name: "test", status: "failed", summary: "1 failed", createdAt: "2026-01-01T00:00:00.000Z" },
        { id: 3, name: "manual", status: "unknown", summary: "not checked", createdAt: "2026-01-01T00:00:00.000Z" }
      ]
    });

    expect(taskVerificationSummary(task)).toMatchObject({
      failed: 1,
      passed: 1,
      resultText: "1 个失败，1 个通过",
      total: 3,
      unknown: 1
    });
  });

  it("builds a copyable summary with checklist, gates, artifacts, and session links", () => {
    const summary = buildTaskSummary(durableTask({
      artifacts: [{ id: 1, artifactId: "artifact-1", summary: "Patch", createdAt: "2026-01-01T00:00:00.000Z" }],
      checklist: [{ id: 1, content: "Implement UI", status: "completed", updatedAt: "2026-01-01T00:00:00.000Z" }],
      gates: [{ id: 1, name: "typecheck", status: "passed", command: "pnpm typecheck", summary: "ok", createdAt: "2026-01-01T00:00:00.000Z" }],
      executionThreadId: "execution-thread",
      sourceThreadId: "source-thread",
      turnId: "turn-1"
    }));

    expect(summary).toContain("## Checklist");
    expect(summary).toContain("typecheck");
    expect(summary).toContain("artifact-1");
    expect(summary).toContain("source-thread");
    expect(summary).toContain("execution-thread");
  });
});

function durableTask(overrides: Partial<DurableTaskSnapshot> = {}): DurableTaskSnapshot {
  return {
    id: "task-1",
    title: "Task",
    prompt: "Do work",
    status: "running",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    checklist: [],
    gates: [],
    artifacts: [],
    prAttempts: [],
    timeline: [],
    ...overrides
  };
}
