import { z } from "zod";
import type { ToolSpec } from "@seekforge/tools";
import type { DurableTaskManager } from "./task-tools";

type AutomationStatus = "active" | "paused";
type AutomationRunStatus = "queued" | "running" | "completed" | "failed" | "canceled";
type WeekdayToken = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

const CURRENT_AUTOMATION_SCHEMA_VERSION = 1;
const CURRENT_AUTOMATION_RUN_SCHEMA_VERSION = 1;
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;

const AutomationIdInputSchema = z.object({
  automation_id: z.string().trim().min(1)
});

const AutomationCreateInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1),
  rrule: z.string().trim().min(1),
  cwds: z.array(z.string().trim().min(1)).max(16).optional(),
  paused: z.boolean().optional()
});

const AutomationListInputSchema = z.object({
  limit: z.number().int().positive().max(MAX_LIST_LIMIT).optional()
});

const AutomationUpdateInputSchema = AutomationIdInputSchema.extend({
  name: z.string().trim().min(1).max(120).optional(),
  prompt: z.string().trim().min(1).optional(),
  rrule: z.string().trim().min(1).optional(),
  cwds: z.array(z.string().trim().min(1)).max(16).optional(),
  status: z.enum(["active", "paused"]).optional()
});

export interface AutomationRecord {
  schemaVersion: number;
  id: string;
  name: string;
  prompt: string;
  rrule: string;
  cwds: string[];
  status: AutomationStatus;
  createdAt: string;
  updatedAt: string;
  nextRunAt?: string;
  lastRunAt?: string;
}

export interface AutomationRunRecord {
  schemaVersion: number;
  id: string;
  automationId: string;
  scheduledFor: string;
  status: AutomationRunStatus;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  taskId?: string;
  threadId?: string;
  turnId?: string;
  error?: string;
}

export interface AutomationState {
  automations: AutomationRecord[];
  runs: AutomationRunRecord[];
}

export interface AutomationStore {
  load(): Promise<AutomationState | null>;
  save(state: AutomationState): Promise<void>;
}

export interface AutomationManagerOptions {
  taskManager?: DurableTaskManager;
  store?: AutomationStore;
}

interface ParsedRrule {
  kind: "hourly" | "weekly";
  intervalHours?: number;
  byday?: WeekdayToken[];
  byhour?: number;
  byminute?: number;
}

export class AutomationManager {
  private readonly automations = new Map<string, AutomationRecord>();
  private readonly runs = new Map<string, AutomationRunRecord[]>();
  private loadPromise?: Promise<void>;

  constructor(private readonly options: AutomationManagerOptions = {}) {}

  async reload() {
    this.loadPromise = undefined;
    this.automations.clear();
    this.runs.clear();
    await this.ensureLoaded();
  }

  async create(input: z.infer<typeof AutomationCreateInputSchema>) {
    await this.ensureLoaded();
    const normalizedRrule = normalizeAndValidateRrule(input.rrule);
    const now = new Date();
    const status: AutomationStatus = input.paused ? "paused" : "active";
    const automation: AutomationRecord = {
      schemaVersion: CURRENT_AUTOMATION_SCHEMA_VERSION,
      id: `automation-${crypto.randomUUID()}`,
      name: input.name.trim(),
      prompt: input.prompt.trim(),
      rrule: normalizedRrule,
      cwds: input.cwds ?? [],
      status,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      nextRunAt: status === "active" ? nextRunAfter(normalizedRrule, now).toISOString() : undefined
    };
    this.automations.set(automation.id, automation);
    await this.persist();
    return this.snapshotAutomation(automation);
  }

  async list(limit = DEFAULT_LIST_LIMIT) {
    await this.ensureLoaded();
    return [...this.automations.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, Math.min(Math.max(limit, 1), MAX_LIST_LIMIT))
      .map((automation) => this.snapshotAutomation(automation));
  }

  async read(automationId: string) {
    await this.ensureLoaded();
    const automation = this.requireAutomation(automationId);
    return {
      automation: this.snapshotAutomation(automation),
      recentRuns: this.listRunsForAutomation(automation.id, 20)
    };
  }

  async update(input: z.infer<typeof AutomationUpdateInputSchema>) {
    await this.ensureLoaded();
    const automation = this.requireAutomation(input.automation_id);
    if (input.name) {
      automation.name = input.name.trim();
    }
    if (input.prompt) {
      automation.prompt = input.prompt.trim();
    }
    if (input.rrule) {
      automation.rrule = normalizeAndValidateRrule(input.rrule);
    }
    if (input.cwds) {
      automation.cwds = [...input.cwds];
    }
    if (input.status) {
      automation.status = input.status;
    }
    automation.nextRunAt = automation.status === "active"
      ? nextRunAfter(automation.rrule, new Date()).toISOString()
      : undefined;
    automation.updatedAt = new Date().toISOString();
    await this.persist();
    return this.snapshotAutomation(automation);
  }

  async pause(automationId: string) {
    return this.update({ automation_id: automationId, status: "paused" });
  }

  async resume(automationId: string) {
    return this.update({ automation_id: automationId, status: "active" });
  }

  async delete(automationId: string) {
    await this.ensureLoaded();
    const automation = this.requireAutomation(automationId);
    const deleted = this.snapshotAutomation(automation);
    this.automations.delete(automationId);
    this.runs.delete(automationId);
    await this.persist();
    return deleted;
  }

  async runNow(automationId: string, workspacePath: string) {
    await this.ensureLoaded();
    const automation = this.requireAutomation(automationId);
    const now = new Date();
    const run = await this.enqueueRun(automation, now);
    await this.persist();

    return {
      run: { ...run },
      automation: this.snapshotAutomation(automation),
      workspacePath,
      taskCreated: Boolean(run.taskId)
    };
  }

  async runDue(workspacePath: string, now = new Date()) {
    await this.ensureLoaded();
    const outputs: Array<{
      run: AutomationRunRecord;
      automation: AutomationRecord;
      workspacePath: string;
      taskCreated: boolean;
    }> = [];

    for (const automation of this.automations.values()) {
      if (automation.status !== "active") {
        continue;
      }
      if (!automation.nextRunAt) {
        automation.nextRunAt = nextRunAfter(automation.rrule, now).toISOString();
        automation.updatedAt = now.toISOString();
        continue;
      }
      const dueAt = new Date(automation.nextRunAt);
      if (dueAt > now) {
        continue;
      }
      const alreadyRanSlot = this.listRunsForAutomation(automation.id, 25)
        .some((run) => run.scheduledFor === automation.nextRunAt);
      if (alreadyRanSlot) {
        automation.nextRunAt = nextRunAfter(automation.rrule, dueAt).toISOString();
        automation.updatedAt = now.toISOString();
        continue;
      }

      const run = await this.enqueueRun(automation, dueAt);
      outputs.push({
        run: { ...run },
        automation: this.snapshotAutomation(automation),
        workspacePath,
        taskCreated: Boolean(run.taskId)
      });
    }

    if (outputs.length > 0) {
      await this.persist();
    }
    return outputs;
  }

  private async enqueueRun(automation: AutomationRecord, scheduledFor: Date) {
    const now = new Date();
    const run: AutomationRunRecord = {
      schemaVersion: CURRENT_AUTOMATION_RUN_SCHEMA_VERSION,
      id: `automation-run-${crypto.randomUUID()}`,
      automationId: automation.id,
      scheduledFor: scheduledFor.toISOString(),
      status: "queued",
      createdAt: now.toISOString()
    };

    try {
      if (this.options.taskManager) {
        const task = await this.options.taskManager.create({
          title: `Automation: ${automation.name}`,
          prompt: automation.prompt
        });
        run.status = "running";
        run.startedAt = new Date().toISOString();
        run.taskId = task.id;
      }
      automation.lastRunAt = run.startedAt ?? run.createdAt;
      automation.updatedAt = new Date().toISOString();
      automation.nextRunAt = automation.status === "active"
        ? nextRunAfter(automation.rrule, scheduledFor).toISOString()
        : undefined;
    } catch (error) {
      run.status = "failed";
      run.endedAt = new Date().toISOString();
      run.error = error instanceof Error ? error.message : String(error);
    }

    this.runs.set(automation.id, [run, ...this.listRunsForAutomation(automation.id)]);
    return run;
  }

  private requireAutomation(automationId: string) {
    const automation = this.automations.get(automationId);
    if (!automation) {
      throw new Error(`Unknown automation: ${automationId}`);
    }
    return automation;
  }

  private listRunsForAutomation(automationId: string, limit = MAX_LIST_LIMIT) {
    return [...(this.runs.get(automationId) ?? [])]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((run) => ({ ...run }));
  }

  private snapshotAutomation(automation: AutomationRecord) {
    return { ...automation, cwds: [...automation.cwds] };
  }

  private async ensureLoaded() {
    if (!this.options.store) {
      return;
    }
    if (!this.loadPromise) {
      this.loadPromise = this.options.store.load()
        .then((state) => {
          if (!state) {
            return;
          }
          this.automations.clear();
          this.runs.clear();
          for (const automation of state.automations) {
            this.automations.set(automation.id, this.snapshotAutomation(automation));
          }
          for (const run of state.runs) {
            this.runs.set(run.automationId, [run, ...(this.runs.get(run.automationId) ?? [])]);
          }
        });
    }
    await this.loadPromise;
  }

  private async persist() {
    if (!this.options.store) {
      return;
    }
    await this.options.store.save({
      automations: [...this.automations.values()].map((automation) => this.snapshotAutomation(automation)),
      runs: [...this.runs.values()].flat().map((run) => ({ ...run }))
    });
  }
}

export function createAutomationTools(manager: AutomationManager): ToolSpec[] {
  return [
    {
      name: "automation_create",
      description: "Create a durable scheduled automation. Supported RRULE forms: FREQ=HOURLY;INTERVAL=N[;BYDAY=MO,TU] or FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=30.",
      capability: "workspace-write",
      approval: "required",
      inputSchema: AutomationCreateInputSchema,
      async execute(input) {
        return { callId: "automation_create", ok: true, output: await manager.create(AutomationCreateInputSchema.parse(input)) };
      }
    },
    {
      name: "automation_list",
      description: "List durable automations with status, next run, and last run timestamps.",
      capability: "readonly",
      approval: "never",
      inputSchema: AutomationListInputSchema,
      async execute(input) {
        const parsed = AutomationListInputSchema.parse(input);
        return { callId: "automation_list", ok: true, output: await manager.list(parsed.limit ?? DEFAULT_LIST_LIMIT) };
      }
    },
    {
      name: "automation_read",
      description: "Read one durable automation plus recent run records.",
      capability: "readonly",
      approval: "never",
      inputSchema: AutomationIdInputSchema,
      async execute(input) {
        return { callId: "automation_read", ok: true, output: await manager.read(AutomationIdInputSchema.parse(input).automation_id) };
      }
    },
    {
      name: "automation_update",
      description: "Update a durable automation. Recurrence remains constrained to supported HOURLY/WEEKLY RRULE forms.",
      capability: "workspace-write",
      approval: "required",
      inputSchema: AutomationUpdateInputSchema,
      async execute(input) {
        return { callId: "automation_update", ok: true, output: await manager.update(AutomationUpdateInputSchema.parse(input)) };
      }
    },
    {
      name: "automation_pause",
      description: "Pause a durable automation.",
      capability: "workspace-write",
      approval: "required",
      inputSchema: AutomationIdInputSchema,
      async execute(input) {
        return { callId: "automation_pause", ok: true, output: await manager.pause(AutomationIdInputSchema.parse(input).automation_id) };
      }
    },
    {
      name: "automation_resume",
      description: "Resume a paused durable automation.",
      capability: "workspace-write",
      approval: "required",
      inputSchema: AutomationIdInputSchema,
      async execute(input) {
        return { callId: "automation_resume", ok: true, output: await manager.resume(AutomationIdInputSchema.parse(input).automation_id) };
      }
    },
    {
      name: "automation_delete",
      description: "Delete a durable automation and its run history.",
      capability: "workspace-write",
      approval: "required",
      inputSchema: AutomationIdInputSchema,
      async execute(input) {
        return { callId: "automation_delete", ok: true, output: await manager.delete(AutomationIdInputSchema.parse(input).automation_id) };
      }
    },
    {
      name: "automation_run",
      description: "Run an automation now. The run enqueues a normal durable task and returns linked task/run ids.",
      capability: "workspace-write",
      approval: "required",
      inputSchema: AutomationIdInputSchema,
      async execute(input, context) {
        return {
          callId: "automation_run",
          ok: true,
          output: await manager.runNow(AutomationIdInputSchema.parse(input).automation_id, context.workspacePath)
        };
      }
    }
  ];
}

function normalizeAndValidateRrule(rrule: string) {
  const normalized = rrule.trim().toUpperCase();
  parseRrule(normalized);
  return normalized;
}

function parseRrule(rrule: string): ParsedRrule {
  const parts = new Map<string, string>();
  for (const raw of rrule.split(";")) {
    const segment = raw.trim();
    if (!segment) {
      continue;
    }
    const [key, value, extra] = segment.split("=");
    if (!key || !value || extra !== undefined) {
      throw new Error(`Invalid RRULE segment '${segment}'.`);
    }
    parts.set(key.trim().toUpperCase(), value.trim().toUpperCase());
  }

  const freq = parts.get("FREQ");
  if (freq === "HOURLY") {
    for (const key of parts.keys()) {
      if (!["FREQ", "INTERVAL", "BYDAY"].includes(key)) {
        throw new Error(`Unsupported RRULE field '${key}' for HOURLY.`);
      }
    }
    const intervalHours = Number(parts.get("INTERVAL") ?? "1");
    if (!Number.isInteger(intervalHours) || intervalHours < 1) {
      throw new Error("INTERVAL must be an integer >= 1 for HOURLY schedules.");
    }
    return {
      kind: "hourly",
      intervalHours,
      byday: parts.has("BYDAY") ? parseByday(parts.get("BYDAY")!) : undefined
    };
  }

  if (freq === "WEEKLY") {
    for (const key of parts.keys()) {
      if (!["FREQ", "BYDAY", "BYHOUR", "BYMINUTE"].includes(key)) {
        throw new Error(`Unsupported RRULE field '${key}' for WEEKLY.`);
      }
    }
    const byday = parseByday(parts.get("BYDAY") ?? "");
    const byhour = Number(parts.get("BYHOUR"));
    const byminute = Number(parts.get("BYMINUTE"));
    if (byday.length === 0) {
      throw new Error("WEEKLY schedules require BYDAY.");
    }
    if (!Number.isInteger(byhour) || byhour < 0 || byhour > 23) {
      throw new Error("WEEKLY schedules require BYHOUR between 0 and 23.");
    }
    if (!Number.isInteger(byminute) || byminute < 0 || byminute > 59) {
      throw new Error("WEEKLY schedules require BYMINUTE between 0 and 59.");
    }
    return { kind: "weekly", byday, byhour, byminute };
  }

  throw new Error("RRULE must include FREQ=HOURLY or FREQ=WEEKLY.");
}

function parseByday(value: string): WeekdayToken[] {
  const valid = new Set<WeekdayToken>(["MO", "TU", "WE", "TH", "FR", "SA", "SU"]);
  const days: WeekdayToken[] = [];
  for (const raw of value.split(",")) {
    const token = raw.trim().toUpperCase() as WeekdayToken;
    if (!token) {
      continue;
    }
    if (!valid.has(token)) {
      throw new Error(`Invalid BYDAY value '${raw}'.`);
    }
    if (!days.includes(token)) {
      days.push(token);
    }
  }
  return days;
}

function nextRunAfter(rrule: string, after: Date) {
  const schedule = parseRrule(rrule);
  if (schedule.kind === "hourly") {
    let candidate = new Date(after);
    candidate.setMinutes(0, 0, 0);
    candidate = new Date(candidate.getTime() + (schedule.intervalHours ?? 1) * 60 * 60 * 1000);
    if (!schedule.byday?.length) {
      return candidate;
    }
    for (let i = 0; i < 24 * 21; i += 1) {
      if (schedule.byday.includes(dayToken(candidate))) {
        return candidate;
      }
      candidate = new Date(candidate.getTime() + (schedule.intervalHours ?? 1) * 60 * 60 * 1000);
    }
    throw new Error("Unable to compute next HOURLY run for BYDAY filter.");
  }

  const byday = schedule.byday ?? [];
  for (let dayOffset = 0; dayOffset < 15; dayOffset += 1) {
    const candidate = new Date(after);
    candidate.setDate(candidate.getDate() + dayOffset);
    candidate.setHours(schedule.byhour ?? 0, schedule.byminute ?? 0, 0, 0);
    if (byday.includes(dayToken(candidate)) && candidate > after) {
      return candidate;
    }
  }
  throw new Error("Unable to compute next WEEKLY run.");
}

function dayToken(date: Date): WeekdayToken {
  return ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][date.getDay()] as WeekdayToken;
}
