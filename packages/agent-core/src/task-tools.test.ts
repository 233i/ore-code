import { describe, expect, it } from "vitest";
import { createTaskTools, DurableTaskManager, type DurableTaskState } from "./task-tools";
import type { ShellToolHost } from "@seekforge/tools";

const context = {
  workspacePath: "/workspace",
  mode: "agent" as const,
  trustedWorkspace: false
};

describe("createTaskTools", () => {
  it("creates a durable task and manages checklist state", async () => {
    const manager = new DurableTaskManager();
    const tools = createTaskTools(manager);
    const taskCreate = tools.find((tool) => tool.name === "task_create")!;
    const checklistWrite = tools.find((tool) => tool.name === "checklist_write")!;
    const checklistUpdate = tools.find((tool) => tool.name === "checklist_update")!;
    const checklistList = tools.find((tool) => tool.name === "checklist_list")!;

    const created = await taskCreate.execute({ prompt: "Ship durable task support" }, context);
    expect(created.output).toMatchObject({
      title: "Ship durable task support",
      status: "queued"
    });

    await checklistWrite.execute({
      items: [
        { content: "Add task object", status: "completed" },
        { content: "Run gate", status: "pending" }
      ]
    }, context);
    await checklistUpdate.execute({ id: 2, status: "in_progress" }, context);

    const listed = await checklistList.execute({}, context);
    expect(listed.output).toMatchObject({
      checklist: [
        { id: 1, content: "Add task object", status: "completed" },
        { id: 2, content: "Run gate", status: "in_progress" }
      ]
    });
  });

  it("runs verification gates through the shell host", async () => {
    const shellHost: ShellToolHost = {
      async run(input) {
        return {
          command: input.command,
          exitCode: 0,
          stdout: "tests passed",
          stderr: "",
          durationMs: 123,
          timedOut: false
        };
      }
    };
    const manager = new DurableTaskManager();
    const tools = createTaskTools(manager, { shellHost });

    await tools.find((tool) => tool.name === "task_create")!.execute({ prompt: "Verify task" }, context);
    const gate = await tools.find((tool) => tool.name === "task_gate_run")!.execute({
      name: "unit tests",
      command: "pnpm test"
    }, context);

    expect(gate.output).toMatchObject({
      gate: {
        name: "unit tests",
        status: "passed",
        command: "pnpm test",
        summary: "tests passed"
      },
      output: {
        exitCode: 0
      }
    });
  });

  it("records PR attempts and persists task state through a store", async () => {
    let saved: DurableTaskState | null = null;
    const store = {
      async load() {
        return saved;
      },
      async save(state: DurableTaskState) {
        saved = state;
      }
    };
    const firstManager = new DurableTaskManager(store);
    const firstTools = createTaskTools(firstManager);

    await firstTools.find((tool) => tool.name === "task_create")!.execute({ prompt: "Open PR" }, context);
    await firstTools.find((tool) => tool.name === "pr_attempt_record")!.execute({
      summary: "First patch",
      patchArtifactId: "artifact-1"
    }, context);

    const secondManager = new DurableTaskManager(store);
    const secondTools = createTaskTools(secondManager);
    const attempts = await secondTools.find((tool) => tool.name === "pr_attempt_list")!.execute({}, context);

    expect(attempts.output).toMatchObject({
      attempts: [
        {
          id: 1,
          summary: "First patch",
          patchArtifactId: "artifact-1",
          preflightStatus: "unknown"
        }
      ]
    });
  });
});
