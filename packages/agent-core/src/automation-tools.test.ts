import { describe, expect, it } from "vitest";
import { AutomationManager, createAutomationTools, type AutomationState } from "./automation-tools";
import { DurableTaskManager } from "./task-tools";

const context = {
  workspacePath: "/workspace",
  mode: "agent" as const,
  trustedWorkspace: false
};

describe("createAutomationTools", () => {
  it("creates, reads, pauses, resumes, and deletes automations", async () => {
    const manager = new AutomationManager();
    const tools = createAutomationTools(manager);
    const create = tools.find((tool) => tool.name === "automation_create")!;
    const read = tools.find((tool) => tool.name === "automation_read")!;
    const pause = tools.find((tool) => tool.name === "automation_pause")!;
    const resume = tools.find((tool) => tool.name === "automation_resume")!;
    const del = tools.find((tool) => tool.name === "automation_delete")!;

    const created = await create.execute({
      name: "Hourly repo check",
      prompt: "Check repo health",
      rrule: "FREQ=HOURLY;INTERVAL=2;BYDAY=MO,TU"
    }, context);
    const automation = created.output as { id: string; status: string; nextRunAt?: string; rrule: string };
    expect(automation).toMatchObject({
      status: "active",
      rrule: "FREQ=HOURLY;INTERVAL=2;BYDAY=MO,TU"
    });
    expect(automation.nextRunAt).toBeTruthy();

    const paused = await pause.execute({ automation_id: automation.id }, context);
    expect(paused.output).toMatchObject({ status: "paused" });

    const resumed = await resume.execute({ automation_id: automation.id }, context);
    expect(resumed.output).toMatchObject({ status: "active" });

    const loaded = await read.execute({ automation_id: automation.id }, context);
    expect(loaded.output).toMatchObject({
      automation: {
        id: automation.id,
        name: "Hourly repo check"
      },
      recentRuns: []
    });

    const deleted = await del.execute({ automation_id: automation.id }, context);
    expect(deleted.output).toMatchObject({ id: automation.id });
  });

  it("runs an automation by enqueueing a durable task and records run history", async () => {
    const taskManager = new DurableTaskManager();
    const manager = new AutomationManager({ taskManager });
    const tools = createAutomationTools(manager);

    const created = await tools.find((tool) => tool.name === "automation_create")!.execute({
      name: "Weekly triage",
      prompt: "Triage open issues",
      rrule: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=30",
      cwds: ["/workspace"]
    }, context);
    const automationId = (created.output as { id: string }).id;

    const run = await tools.find((tool) => tool.name === "automation_run")!.execute({
      automation_id: automationId
    }, context);
    expect(run.output).toMatchObject({
      run: {
        automationId,
        status: "running"
      },
      taskCreated: true
    });
    expect((run.output as { run: { taskId?: string } }).run.taskId).toMatch(/^task-/);
    expect(await taskManager.list({ workspacePath: "/workspace" })).toMatchObject([
      {
        prompt: "Triage open issues",
        workspacePath: "/workspace"
      }
    ]);

    const loaded = await tools.find((tool) => tool.name === "automation_read")!.execute({
      automation_id: automationId
    }, context);
    expect(loaded.output).toMatchObject({
      recentRuns: [
        {
          automationId,
          status: "running"
        }
      ]
    });
  });

  it("persists automations through a store", async () => {
    let saved: AutomationState | null = null;
    const store = {
      async load() {
        return saved;
      },
      async save(state: AutomationState) {
        saved = state;
      }
    };
    const firstManager = new AutomationManager({ store });
    const firstTools = createAutomationTools(firstManager);
    const created = await firstTools.find((tool) => tool.name === "automation_create")!.execute({
      name: "Daily-ish",
      prompt: "Run checks",
      rrule: "FREQ=HOURLY;INTERVAL=24"
    }, context);

    const secondManager = new AutomationManager({ store });
    const secondTools = createAutomationTools(secondManager);
    const listed = await secondTools.find((tool) => tool.name === "automation_list")!.execute({}, context);
    expect(listed.output).toMatchObject([
      {
        id: (created.output as { id: string }).id,
        name: "Daily-ish"
      }
    ]);
  });

  it("runs due scheduled automations once per schedule slot", async () => {
    const taskManager = new DurableTaskManager();
    const saved: AutomationState = {
      automations: [{
        schemaVersion: 1,
        id: "automation-due",
        name: "Due job",
        prompt: "Run due job",
        rrule: "FREQ=HOURLY;INTERVAL=1",
        cwds: [],
        status: "active",
        createdAt: "2026-05-14T00:00:00.000Z",
        updatedAt: "2026-05-14T00:00:00.000Z",
        nextRunAt: "2026-05-14T01:00:00.000Z"
      }],
      runs: []
    };
    const store = {
      async load() {
        return saved;
      },
      async save(state: AutomationState) {
        saved.automations = state.automations;
        saved.runs = state.runs;
      }
    };
    const manager = new AutomationManager({ store, taskManager });

    const first = await manager.runDue("/workspace", new Date("2026-05-14T01:05:00.000Z"));
    const second = await manager.runDue("/workspace", new Date("2026-05-14T01:06:00.000Z"));

    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      run: {
        automationId: "automation-due",
        scheduledFor: "2026-05-14T01:00:00.000Z",
        status: "running"
      },
      taskCreated: true
    });
    expect(second).toHaveLength(0);
    expect(saved.runs).toHaveLength(1);
    expect(saved.automations[0].nextRunAt).toBe("2026-05-14T02:00:00.000Z");
  });

  it("does not run due automations for another workspace", async () => {
    const taskManager = new DurableTaskManager();
    const saved: AutomationState = {
      automations: [{
        schemaVersion: 1,
        id: "automation-other",
        name: "Other job",
        prompt: "Run other job",
        rrule: "FREQ=HOURLY;INTERVAL=1",
        cwds: ["/other"],
        status: "active",
        createdAt: "2026-05-14T00:00:00.000Z",
        updatedAt: "2026-05-14T00:00:00.000Z",
        nextRunAt: "2026-05-14T01:00:00.000Z"
      }],
      runs: []
    };
    const store = {
      async load() {
        return saved;
      },
      async save(state: AutomationState) {
        saved.automations = state.automations;
        saved.runs = state.runs;
      }
    };
    const manager = new AutomationManager({ store, taskManager });

    await expect(manager.runDue("/workspace", new Date("2026-05-14T01:05:00.000Z"))).resolves.toEqual([]);
    expect(await taskManager.list({ workspacePath: "/other" })).toEqual([]);
  });

  it("rejects unsupported RRULE fields", async () => {
    const manager = new AutomationManager();
    await expect(manager.create({
      name: "Bad schedule",
      prompt: "Run bad schedule",
      rrule: "FREQ=WEEKLY;BYSECOND=5"
    })).rejects.toThrow("Unsupported RRULE field");
  });
});
