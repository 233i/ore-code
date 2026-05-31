import { z } from "zod";
import type { ShellToolHost, ToolSpec } from "@seekforge/tools";

type TaskStatus = "queued" | "running" | "completed" | "failed" | "canceled";
type ChecklistStatus = "pending" | "in_progress" | "completed" | "blocked";
type GateStatus = "passed" | "failed" | "unknown";
type PrPreflightStatus = "unknown" | "passed" | "failed" | "skipped";

const MAX_GATE_TIMEOUT_MS = 300_000;
const DEFAULT_GATE_TIMEOUT_MS = 60_000;

const TaskCreateInputSchema = z.object({
  prompt: z.string().trim().min(1),
  title: z.string().trim().min(1).max(120).optional()
});

const TaskIdInputSchema = z.object({
  taskId: z.string().trim().min(1).optional()
});

const TaskUpdateInputSchema = TaskIdInputSchema.extend({
  status: z.enum(["queued", "running", "completed", "failed", "canceled"]).optional(),
  title: z.string().trim().min(1).max(120).optional(),
  error: z.string().trim().min(1).optional()
});

const ChecklistItemInputSchema = z.object({
  content: z.string().trim().min(1),
  status: z.enum(["pending", "in_progress", "completed", "blocked"]).optional()
});

const ChecklistWriteInputSchema = TaskIdInputSchema.extend({
  items: z.array(ChecklistItemInputSchema).min(1).max(100)
});

const ChecklistAddInputSchema = TaskIdInputSchema.extend({
  content: z.string().trim().min(1),
  status: z.enum(["pending", "in_progress", "completed", "blocked"]).optional()
});

const ChecklistUpdateInputSchema = TaskIdInputSchema.extend({
  id: z.number().int().positive(),
  content: z.string().trim().min(1).optional(),
  status: z.enum(["pending", "in_progress", "completed", "blocked"]).optional()
});

const GateRunInputSchema = TaskIdInputSchema.extend({
  command: z.string().trim().min(1),
  name: z.string().trim().min(1).max(120).optional(),
  timeoutMs: z.number().int().positive().max(MAX_GATE_TIMEOUT_MS).optional()
});

const GateRecordInputSchema = TaskIdInputSchema.extend({
  name: z.string().trim().min(1).max(120),
  status: z.enum(["passed", "failed", "unknown"]).optional(),
  command: z.string().trim().min(1).optional(),
  exitCode: z.number().int().nullable().optional(),
  summary: z.string().trim().min(1).optional(),
  artifactId: z.string().trim().min(1).optional(),
  durationMs: z.number().int().nonnegative().optional()
});

const ArtifactRecordInputSchema = TaskIdInputSchema.extend({
  artifactId: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  type: z.string().trim().min(1).optional()
});

const PrAttemptRecordInputSchema = TaskIdInputSchema.extend({
  summary: z.string().trim().min(1),
  patchArtifactId: z.string().trim().min(1).optional(),
  preflightStatus: z.enum(["unknown", "passed", "failed", "skipped"]).optional()
});

const PrAttemptIdInputSchema = TaskIdInputSchema.extend({
  attemptId: z.number().int().positive()
});

export interface TaskChecklistItem {
  id: number;
  content: string;
  status: ChecklistStatus;
  updatedAt: string;
}

export interface TaskGate {
  id: number;
  name: string;
  status: GateStatus;
  command?: string;
  exitCode?: number | null;
  summary: string;
  artifactId?: string;
  durationMs?: number;
  createdAt: string;
}

export interface TaskArtifactRef {
  id: number;
  artifactId: string;
  summary: string;
  type?: string;
  createdAt: string;
}

export interface TaskPrAttempt {
  id: number;
  summary: string;
  patchArtifactId?: string;
  preflightStatus: PrPreflightStatus;
  preflightSummary?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskTimelineEntry {
  id: number;
  type: "task" | "checklist" | "gate" | "artifact" | "pr_attempt";
  message: string;
  createdAt: string;
}

export interface DurableTaskSnapshot {
  id: string;
  title: string;
  prompt: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  endedAt?: string;
  threadId?: string;
  turnId?: string;
  eventCount?: number;
  output?: string;
  checklist: TaskChecklistItem[];
  gates: TaskGate[];
  artifacts: TaskArtifactRef[];
  prAttempts: TaskPrAttempt[];
  timeline: TaskTimelineEntry[];
  error?: string;
}

export interface DurableTaskState {
  activeTaskId?: string;
  tasks: DurableTaskSnapshot[];
}

export interface DurableTaskStore {
  load(): Promise<DurableTaskState | null>;
  save(state: DurableTaskState): Promise<void>;
}

export interface TaskToolOptions {
  shellHost?: ShellToolHost;
}

export class DurableTaskManager {
  private readonly tasks = new Map<string, DurableTaskSnapshot>();
  private activeTaskId?: string;
  private loadPromise?: Promise<void>;

  constructor(private readonly store?: DurableTaskStore) {}

  async reload() {
    this.loadPromise = undefined;
    this.tasks.clear();
    this.activeTaskId = undefined;
    await this.ensureLoaded();
  }

  async create(input: z.infer<typeof TaskCreateInputSchema>) {
    await this.ensureLoaded();
    const now = new Date().toISOString();
    const task: DurableTaskSnapshot = {
      id: `task-${crypto.randomUUID()}`,
      title: input.title ?? summarizePrompt(input.prompt),
      prompt: input.prompt,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      checklist: [],
      gates: [],
      artifacts: [],
      prAttempts: [],
      timeline: [{
        id: 1,
        type: "task",
        message: "Task created.",
        createdAt: now
      }]
    };
    this.tasks.set(task.id, task);
    this.activeTaskId = task.id;
    await this.persist();
    return this.snapshot(task);
  }

  async list() {
    await this.ensureLoaded();
    return [...this.tasks.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((task) => this.snapshot(task));
  }

  async read(taskId?: string) {
    await this.ensureLoaded();
    return this.snapshot(this.requireTask(taskId));
  }

  async update(input: z.infer<typeof TaskUpdateInputSchema>) {
    await this.ensureLoaded();
    const task = this.requireTask(input.taskId);
    if (input.title) {
      task.title = input.title;
    }
    if (input.status) {
      task.status = input.status;
    }
    if (input.error) {
      task.error = input.error;
    }
    this.appendTimeline(task, "task", `Task updated${input.status ? `: ${input.status}` : ""}.`);
    this.touch(task);
    await this.persist();
    return this.snapshot(task);
  }

  async cancel(taskId?: string) {
    await this.ensureLoaded();
    const task = this.requireTask(taskId);
    task.status = "canceled";
    task.error = "Canceled by user or agent.";
    this.appendTimeline(task, "task", "Task canceled.");
    this.touch(task);
    await this.persist();
    return this.snapshot(task);
  }

  async claimNextQueued() {
    await this.ensureLoaded();
    const task = [...this.tasks.values()]
      .filter((candidate) => candidate.status === "queued")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!task) {
      return null;
    }
    task.status = "running";
    task.startedAt = new Date().toISOString();
    task.endedAt = undefined;
    task.error = undefined;
    this.activeTaskId = task.id;
    this.appendTimeline(task, "task", "Task execution started.");
    this.touch(task);
    await this.persist();
    return this.snapshot(task);
  }

  async completeExecution(input: {
    taskId: string;
    threadId: string;
    turnId: string;
    eventCount: number;
    output?: string;
  }) {
    await this.ensureLoaded();
    const task = this.requireTask(input.taskId);
    task.status = "completed";
    task.threadId = input.threadId;
    task.turnId = input.turnId;
    task.eventCount = input.eventCount;
    task.output = input.output;
    task.endedAt = new Date().toISOString();
    task.error = undefined;
    this.appendTimeline(task, "task", "Task execution completed.");
    this.touch(task);
    await this.persist();
    return this.snapshot(task);
  }

  async failExecution(input: {
    taskId: string;
    threadId: string;
    turnId: string;
    eventCount: number;
    error: string;
    output?: string;
  }) {
    await this.ensureLoaded();
    const task = this.requireTask(input.taskId);
    task.status = "failed";
    task.threadId = input.threadId;
    task.turnId = input.turnId;
    task.eventCount = input.eventCount;
    task.output = input.output;
    task.error = input.error;
    task.endedAt = new Date().toISOString();
    this.appendTimeline(task, "task", `Task execution failed: ${input.error}`);
    this.touch(task);
    await this.persist();
    return this.snapshot(task);
  }

  async writeChecklist(input: z.infer<typeof ChecklistWriteInputSchema>) {
    await this.ensureLoaded();
    const task = this.requireTask(input.taskId);
    const now = new Date().toISOString();
    task.checklist = input.items.map((item, index) => ({
      id: index + 1,
      content: item.content,
      status: item.status ?? "pending",
      updatedAt: now
    }));
    this.appendTimeline(task, "checklist", `Checklist replaced with ${task.checklist.length} item(s).`);
    this.touch(task);
    await this.persist();
    return this.snapshot(task);
  }

  async addChecklist(input: z.infer<typeof ChecklistAddInputSchema>) {
    await this.ensureLoaded();
    const task = this.requireTask(input.taskId);
    const now = new Date().toISOString();
    const item: TaskChecklistItem = {
      id: nextNumberId(task.checklist),
      content: input.content,
      status: input.status ?? "pending",
      updatedAt: now
    };
    task.checklist.push(item);
    this.appendTimeline(task, "checklist", `Checklist item added: ${input.content}`);
    this.touch(task);
    await this.persist();
    return { task: this.snapshot(task), item };
  }

  async updateChecklist(input: z.infer<typeof ChecklistUpdateInputSchema>) {
    await this.ensureLoaded();
    const task = this.requireTask(input.taskId);
    const item = task.checklist.find((candidate) => candidate.id === input.id);
    if (!item) {
      throw new Error(`Unknown checklist item ${input.id} for task ${task.id}.`);
    }
    if (input.content) {
      item.content = input.content;
    }
    if (input.status) {
      item.status = input.status;
    }
    item.updatedAt = new Date().toISOString();
    this.appendTimeline(task, "checklist", `Checklist item ${input.id} updated${input.status ? `: ${input.status}` : ""}.`);
    this.touch(task);
    await this.persist();
    return { task: this.snapshot(task), item: { ...item } };
  }

  async listChecklist(taskId?: string) {
    await this.ensureLoaded();
    const task = this.requireTask(taskId);
    return { taskId: task.id, checklist: task.checklist.map((item) => ({ ...item })) };
  }

  async runGate(
    input: z.infer<typeof GateRunInputSchema>,
    workspacePath: string,
    shellHost?: ShellToolHost,
    onOutput?: (delta: { stream: "stdout" | "stderr"; text: string }) => void
  ) {
    await this.ensureLoaded();
    const task = this.requireTask(input.taskId);
    if (!shellHost) {
      throw new Error("task_gate_run requires a shell host.");
    }
    const output = await shellHost.run({
      workspacePath,
      command: input.command,
      timeoutMs: input.timeoutMs ?? DEFAULT_GATE_TIMEOUT_MS,
      onOutput
    });
    const summary = summarizeGateOutput(output.stdout, output.stderr, output.timedOut);
    const gate = this.addGate(task, {
      name: input.name ?? input.command,
      command: output.command,
      exitCode: output.exitCode,
      status: output.exitCode === 0 && !output.timedOut ? "passed" : "failed",
      summary,
      durationMs: output.durationMs
    });
    await this.persist();
    return { task: this.snapshot(task), gate, output };
  }

  async recordGate(input: z.infer<typeof GateRecordInputSchema>) {
    await this.ensureLoaded();
    const task = this.requireTask(input.taskId);
    const gate = this.addGate(task, {
      name: input.name,
      command: input.command,
      exitCode: input.exitCode,
      status: input.status ?? gateStatusFromExitCode(input.exitCode),
      summary: input.summary ?? "Gate result recorded.",
      artifactId: input.artifactId,
      durationMs: input.durationMs
    });
    await this.persist();
    return { task: this.snapshot(task), gate };
  }

  async recordArtifact(input: z.infer<typeof ArtifactRecordInputSchema>) {
    await this.ensureLoaded();
    const task = this.requireTask(input.taskId);
    const ref: TaskArtifactRef = {
      id: nextNumberId(task.artifacts),
      artifactId: input.artifactId,
      summary: input.summary,
      type: input.type,
      createdAt: new Date().toISOString()
    };
    task.artifacts.push(ref);
    this.appendTimeline(task, "artifact", `Artifact recorded: ${input.summary}`);
    this.touch(task);
    await this.persist();
    return { task: this.snapshot(task), artifact: { ...ref } };
  }

  async recordPrAttempt(input: z.infer<typeof PrAttemptRecordInputSchema>) {
    await this.ensureLoaded();
    const task = this.requireTask(input.taskId);
    const now = new Date().toISOString();
    const attempt: TaskPrAttempt = {
      id: nextNumberId(task.prAttempts),
      summary: input.summary,
      patchArtifactId: input.patchArtifactId,
      preflightStatus: input.preflightStatus ?? "unknown",
      createdAt: now,
      updatedAt: now
    };
    task.prAttempts.push(attempt);
    this.appendTimeline(task, "pr_attempt", `PR attempt recorded: ${input.summary}`);
    this.touch(task);
    await this.persist();
    return { task: this.snapshot(task), attempt: { ...attempt } };
  }

  async listPrAttempts(taskId?: string) {
    await this.ensureLoaded();
    const task = this.requireTask(taskId);
    return { taskId: task.id, attempts: task.prAttempts.map((attempt) => ({ ...attempt })) };
  }

  async readPrAttempt(input: z.infer<typeof PrAttemptIdInputSchema>) {
    await this.ensureLoaded();
    const task = this.requireTask(input.taskId);
    const attempt = task.prAttempts.find((candidate) => candidate.id === input.attemptId);
    if (!attempt) {
      throw new Error(`Unknown PR attempt ${input.attemptId} for task ${task.id}.`);
    }
    return { taskId: task.id, attempt: { ...attempt } };
  }

  async preflightPrAttempt(input: z.infer<typeof PrAttemptIdInputSchema>) {
    await this.ensureLoaded();
    const task = this.requireTask(input.taskId);
    const attempt = task.prAttempts.find((candidate) => candidate.id === input.attemptId);
    if (!attempt) {
      throw new Error(`Unknown PR attempt ${input.attemptId} for task ${task.id}.`);
    }
    attempt.preflightStatus = attempt.patchArtifactId ? "unknown" : "skipped";
    attempt.preflightSummary = attempt.patchArtifactId
      ? "Patch artifact preflight is recorded as pending integration with artifact replay."
      : "No patch artifact was attached to this PR attempt.";
    attempt.updatedAt = new Date().toISOString();
    this.appendTimeline(task, "pr_attempt", `PR attempt ${attempt.id} preflight: ${attempt.preflightStatus}.`);
    this.touch(task);
    await this.persist();
    return { task: this.snapshot(task), attempt: { ...attempt } };
  }

  private addGate(task: DurableTaskSnapshot, input: Omit<TaskGate, "id" | "createdAt">) {
    const gate: TaskGate = {
      ...input,
      id: nextNumberId(task.gates),
      createdAt: new Date().toISOString()
    };
    task.gates.push(gate);
    this.appendTimeline(task, "gate", `Gate ${gate.status}: ${gate.name}`);
    this.touch(task);
    return { ...gate };
  }

  private requireTask(taskId?: string) {
    const id = taskId ?? this.activeTaskId;
    if (!id) {
      throw new Error("No active durable task. Create a task first or pass taskId.");
    }
    const task = this.tasks.get(id);
    if (!task) {
      throw new Error(`Unknown durable task: ${id}`);
    }
    this.activeTaskId = id;
    return task;
  }

  private appendTimeline(task: DurableTaskSnapshot, type: TaskTimelineEntry["type"], message: string) {
    task.timeline.push({
      id: nextNumberId(task.timeline),
      type,
      message,
      createdAt: new Date().toISOString()
    });
  }

  private touch(task: DurableTaskSnapshot) {
    task.updatedAt = new Date().toISOString();
  }

  private snapshot(task: DurableTaskSnapshot): DurableTaskSnapshot {
    return structuredClone(task);
  }

  private async ensureLoaded() {
    if (!this.store) {
      return;
    }
    if (!this.loadPromise) {
      this.loadPromise = this.store.load()
        .then((state) => {
          if (!state) {
            return;
          }
          this.tasks.clear();
          for (const task of state.tasks) {
            this.tasks.set(task.id, this.snapshot(task));
          }
          this.activeTaskId = state.activeTaskId;
        });
    }
    await this.loadPromise;
  }

  private async persist() {
    if (!this.store) {
      return;
    }
    await this.store.save({
      activeTaskId: this.activeTaskId,
      tasks: [...this.tasks.values()].map((task) => this.snapshot(task))
    });
  }
}

export function createTaskTools(manager: DurableTaskManager, options: TaskToolOptions = {}): ToolSpec[] {
  return [
    {
      name: "task_create",
      description: "Create a durable long-running task object for multi-step work. Use this before checklists, gates, artifacts, and PR attempts.",
      capability: "readonly",
      approval: "never",
      inputSchema: TaskCreateInputSchema,
      async execute(input) {
        return { callId: "task_create", ok: true, output: await manager.create(TaskCreateInputSchema.parse(input)) };
      }
    },
    {
      name: "task_list",
      description: "List durable tasks, newest updated first.",
      capability: "readonly",
      approval: "never",
      inputSchema: z.object({}),
      async execute() {
        return { callId: "task_list", ok: true, output: await manager.list() };
      }
    },
    {
      name: "task_read",
      description: "Read a durable task. If taskId is omitted, reads the active task.",
      capability: "readonly",
      approval: "never",
      inputSchema: TaskIdInputSchema,
      async execute(input) {
        return { callId: "task_read", ok: true, output: await manager.read(TaskIdInputSchema.parse(input).taskId) };
      }
    },
    {
      name: "task_update",
      description: "Update durable task status, title, or error summary.",
      capability: "readonly",
      approval: "never",
      inputSchema: TaskUpdateInputSchema,
      async execute(input) {
        return { callId: "task_update", ok: true, output: await manager.update(TaskUpdateInputSchema.parse(input)) };
      }
    },
    {
      name: "task_cancel",
      description: "Mark a durable task as canceled. If taskId is omitted, cancels the active task.",
      capability: "readonly",
      approval: "never",
      inputSchema: TaskIdInputSchema,
      async execute(input) {
        return { callId: "task_cancel", ok: true, output: await manager.cancel(TaskIdInputSchema.parse(input).taskId) };
      }
    },
    {
      name: "checklist_write",
      description: "Replace the active task checklist with ordered items.",
      capability: "readonly",
      approval: "never",
      inputSchema: ChecklistWriteInputSchema,
      async execute(input) {
        return { callId: "checklist_write", ok: true, output: await manager.writeChecklist(ChecklistWriteInputSchema.parse(input)) };
      }
    },
    {
      name: "checklist_add",
      description: "Add one checklist item to the active task.",
      capability: "readonly",
      approval: "never",
      inputSchema: ChecklistAddInputSchema,
      async execute(input) {
        return { callId: "checklist_add", ok: true, output: await manager.addChecklist(ChecklistAddInputSchema.parse(input)) };
      }
    },
    {
      name: "checklist_update",
      description: "Update one checklist item by id.",
      capability: "readonly",
      approval: "never",
      inputSchema: ChecklistUpdateInputSchema,
      async execute(input) {
        return { callId: "checklist_update", ok: true, output: await manager.updateChecklist(ChecklistUpdateInputSchema.parse(input)) };
      }
    },
    {
      name: "checklist_list",
      description: "List checklist items for a task. If taskId is omitted, lists the active task checklist.",
      capability: "readonly",
      approval: "never",
      inputSchema: TaskIdInputSchema,
      async execute(input) {
        return { callId: "checklist_list", ok: true, output: await manager.listChecklist(TaskIdInputSchema.parse(input).taskId) };
      }
    },
    {
      name: "task_gate_run",
      description: "Run a verification command and attach the pass/fail gate result to the active durable task.",
      capability: "shell",
      approval: "required",
      inputSchema: GateRunInputSchema,
      async execute(input, context) {
        return {
          callId: "task_gate_run",
          ok: true,
          output: await manager.runGate(
            GateRunInputSchema.parse(input),
            context.workspacePath,
            options.shellHost,
            context.onCommandOutput && context.toolCallId
              ? (delta) => context.onCommandOutput?.({ callId: context.toolCallId ?? "task_gate_run", ...delta })
              : undefined
          )
        };
      }
    },
    {
      name: "task_gate_record",
      description: "Record an external verification gate result on the active durable task.",
      capability: "readonly",
      approval: "never",
      inputSchema: GateRecordInputSchema,
      async execute(input) {
        return { callId: "task_gate_record", ok: true, output: await manager.recordGate(GateRecordInputSchema.parse(input)) };
      }
    },
    {
      name: "task_artifact_record",
      description: "Attach an existing artifact id and summary to the active durable task.",
      capability: "readonly",
      approval: "never",
      inputSchema: ArtifactRecordInputSchema,
      async execute(input) {
        return { callId: "task_artifact_record", ok: true, output: await manager.recordArtifact(ArtifactRecordInputSchema.parse(input)) };
      }
    },
    {
      name: "pr_attempt_record",
      description: "Record a PR attempt for the active durable task, optionally linked to a patch artifact.",
      capability: "readonly",
      approval: "never",
      inputSchema: PrAttemptRecordInputSchema,
      async execute(input) {
        return { callId: "pr_attempt_record", ok: true, output: await manager.recordPrAttempt(PrAttemptRecordInputSchema.parse(input)) };
      }
    },
    {
      name: "pr_attempt_list",
      description: "List PR attempts for the active durable task.",
      capability: "readonly",
      approval: "never",
      inputSchema: TaskIdInputSchema,
      async execute(input) {
        return { callId: "pr_attempt_list", ok: true, output: await manager.listPrAttempts(TaskIdInputSchema.parse(input).taskId) };
      }
    },
    {
      name: "pr_attempt_read",
      description: "Read one PR attempt by id.",
      capability: "readonly",
      approval: "never",
      inputSchema: PrAttemptIdInputSchema,
      async execute(input) {
        return { callId: "pr_attempt_read", ok: true, output: await manager.readPrAttempt(PrAttemptIdInputSchema.parse(input)) };
      }
    },
    {
      name: "pr_attempt_preflight",
      description: "Record preflight status for a PR attempt. This currently tracks metadata and reserves the hook for patch replay.",
      capability: "readonly",
      approval: "never",
      inputSchema: PrAttemptIdInputSchema,
      async execute(input) {
        return { callId: "pr_attempt_preflight", ok: true, output: await manager.preflightPrAttempt(PrAttemptIdInputSchema.parse(input)) };
      }
    }
  ];
}

function summarizePrompt(prompt: string) {
  const firstLine = prompt.trim().split(/\r?\n/, 1)[0] ?? "Durable task";
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}

function nextNumberId(items: Array<{ id: number }>) {
  return items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
}

function gateStatusFromExitCode(exitCode: number | null | undefined): GateStatus {
  if (exitCode === undefined) {
    return "unknown";
  }
  return exitCode === 0 ? "passed" : "failed";
}

function summarizeGateOutput(stdout: string, stderr: string, timedOut: boolean) {
  if (timedOut) {
    return "Command timed out.";
  }
  const text = `${stdout}\n${stderr}`.trim().replace(/\s+/g, " ");
  if (!text) {
    return "Command completed without output.";
  }
  return text.length > 500 ? `${text.slice(0, 497)}...` : text;
}
