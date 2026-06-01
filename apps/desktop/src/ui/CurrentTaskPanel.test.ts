import { describe, expect, it } from "vitest";
import type { DurableTaskSnapshot } from "@ore-code/agent-core";
import { currentChecklistItem, latestTaskGate, selectCurrentTask, taskChecklistProgress } from "./CurrentTaskPanel";

describe("CurrentTaskPanel helpers", () => {
  it("selects the active task by status priority before recency", () => {
    const completed = durableTask({ id: "done", status: "completed", updatedAt: "2026-01-03T00:00:00.000Z" });
    const queued = durableTask({ id: "queued", status: "queued", updatedAt: "2026-01-02T00:00:00.000Z" });
    const running = durableTask({ id: "running", status: "running", updatedAt: "2026-01-01T00:00:00.000Z" });

    expect(selectCurrentTask([completed, queued, running])?.id).toBe("running");
  });

  it("stays quiet when only terminal tasks remain", () => {
    expect(selectCurrentTask([
      durableTask({ id: "done", status: "completed" }),
      durableTask({ id: "canceled", status: "canceled" })
    ])).toBeNull();
  });

  it("derives checklist progress and current item", () => {
    const task = durableTask({
      checklist: [
        { id: 1, content: "Read docs", status: "completed", updatedAt: "2026-01-01T00:00:00.000Z" },
        { id: 2, content: "Patch UI", status: "in_progress", updatedAt: "2026-01-01T00:00:00.000Z" },
        { id: 3, content: "Run tests", status: "pending", updatedAt: "2026-01-01T00:00:00.000Z" }
      ]
    });

    expect(taskChecklistProgress(task)).toMatchObject({ completed: 1, percent: 33, total: 3 });
    expect(currentChecklistItem(task)?.content).toBe("Patch UI");
  });

  it("selects the newest gate result", () => {
    const task = durableTask({
      gates: [
        {
          id: 1,
          name: "old",
          status: "failed",
          summary: "failed",
          createdAt: "2026-01-01T00:00:00.000Z"
        },
        {
          id: 2,
          name: "new",
          status: "passed",
          summary: "passed",
          createdAt: "2026-01-02T00:00:00.000Z"
        }
      ]
    });

    expect(latestTaskGate(task)?.name).toBe("new");
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
