import { describe, expect, it } from "vitest";
import { ToolRegistry } from "@seekforge/tools";
import { MockLlmClient } from "./llm";
import { DurableTaskExecutor } from "./task-executor";
import { DurableTaskManager } from "./task-tools";

describe("DurableTaskExecutor", () => {
  it("claims and completes the oldest queued durable task", async () => {
    const manager = new DurableTaskManager();
    const task = await manager.create({ prompt: "Summarize the workspace", title: "Workspace summary" });
    const executor = new DurableTaskExecutor(manager, {
      workspacePath: "/workspace",
      createClient: async () => new MockLlmClient([
        { type: "assistant_delta", text: "done" },
        { type: "done" }
      ]),
      createRegistry: () => new ToolRegistry()
    });

    const result = await executor.runNext();

    expect(result).toMatchObject({
      ran: true,
      eventCount: 6,
      output: "done"
    });
    expect(result.task).toMatchObject({
      id: task.id,
      status: "completed",
      output: "done",
      eventCount: 6
    });
    expect(result.task?.threadId).toBe(`durable-task-${task.id}`);
    expect(result.task?.turnId).toBeTruthy();
  });

  it("marks a task failed when the model turn fails", async () => {
    const manager = new DurableTaskManager();
    await manager.create({ prompt: "Fail this task" });
    const executor = new DurableTaskExecutor(manager, {
      workspacePath: "/workspace",
      createClient: async () => new MockLlmClient([
        { type: "done", finishReason: "error" }
      ]),
      createRegistry: () => new ToolRegistry()
    });

    const result = await executor.runNext();

    expect(result.ran).toBe(true);
    expect(result.error).toBe("Model provider returned an error finish reason.");
    expect(result.task).toMatchObject({
      status: "failed",
      error: "Model provider returned an error finish reason."
    });
  });

  it("returns without work when no queued task exists", async () => {
    const manager = new DurableTaskManager();
    const executor = new DurableTaskExecutor(manager, {
      workspacePath: "/workspace",
      createClient: async () => new MockLlmClient([{ type: "done" }]),
      createRegistry: () => new ToolRegistry()
    });

    await expect(executor.runNext()).resolves.toEqual({ ran: false });
  });
});
