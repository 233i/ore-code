import { z } from "zod";
import type { RuntimeEvent } from "@ore-code/protocol";
import type { ToolContext, ToolRegistry, ToolSpec } from "@ore-code/tools";
import { AgentEngine, type ArtifactSink } from "./engine";
import type { LlmClient } from "./llm";
import { createSubagentRoleSystemPrompt } from "./prompts";
import { buildRuntimeContext } from "./runtime-history";

type SubagentStatus = "running" | "completed" | "failed" | "canceled";
export const SUBAGENT_ROLES = ["general", "explorer", "worker", "reviewer"] as const;
export type SubagentRole = typeof SUBAGENT_ROLES[number];
export const SUBAGENT_MODEL_PREFERENCES = ["flash", "pro", "parent"] as const;
export type SubagentModelPreference = typeof SUBAGENT_MODEL_PREFERENCES[number];

const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const MAX_WAIT_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_CONCURRENT = 4;

const AgentIdInputSchema = z.object({
  agentId: z.string().min(1)
});

const AgentSpawnInputSchema = z.object({
  prompt: z.string().trim().min(1),
  name: z.string().trim().min(1).max(80).optional(),
  role: z.enum(SUBAGENT_ROLES).optional(),
  modelPreference: z.enum(SUBAGENT_MODEL_PREFERENCES).optional()
});

const AgentWaitInputSchema = AgentIdInputSchema.extend({
  timeoutMs: z.number().int().positive().max(MAX_WAIT_TIMEOUT_MS).optional()
});

const AgentSendInputSchema = AgentIdInputSchema.extend({
  prompt: z.string().trim().min(1)
});

const AgentResumeInputSchema = AgentIdInputSchema.extend({
  prompt: z.string().trim().min(1).optional()
});

export interface SubagentRuntimeOptions {
  artifacts?: { store: ArtifactSink };
  createClient(context: ToolContext, agent: SubagentRuntimeAgent): Promise<LlmClient>;
  createRegistry(): Promise<ToolRegistry> | ToolRegistry;
  maxConcurrent?: number;
  maxModelIterations?: number;
  model?: string | ((context: ToolContext, agent: SubagentRuntimeAgent) => string | undefined);
  projectContext?: string | ((context: ToolContext, agent: SubagentRuntimeAgent) => string | undefined);
  systemPrompt?: string | ((context: ToolContext, agent: SubagentRuntimeAgent) => string | undefined);
}

export interface SubagentRuntimeAgent {
  id: string;
  name: string;
  role: SubagentRole;
  prompt: string;
  model?: string;
  modelPreference?: SubagentModelPreference;
}

export interface SubagentSnapshot {
  id: string;
  name: string;
  role: SubagentRole;
  status: SubagentStatus;
  prompt: string;
  model?: string;
  modelPreference?: SubagentModelPreference;
  activeCount: number;
  maxConcurrent: number;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
  eventCount: number;
  output: string;
  totalCostUsd: number;
  totalCostCny: number;
  error?: string;
}

interface SubagentRecord extends SubagentRuntimeAgent {
  id: string;
  name: string;
  status: SubagentStatus;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  events: RuntimeEvent[];
  error?: string;
  controller?: AbortController;
  queue: string[];
  run?: Promise<void>;
}

export class SubagentManager {
  private readonly agents = new Map<string, SubagentRecord>();
  private activeCount = 0;

  constructor(private readonly options: SubagentRuntimeOptions) {}

  spawn(input: z.infer<typeof AgentSpawnInputSchema>, context: ToolContext): SubagentSnapshot {
    const now = new Date().toISOString();
    const agent: SubagentRecord = {
      id: `agent-${crypto.randomUUID()}`,
      name: input.name ?? summarizePrompt(input.prompt),
      role: input.role ?? "general",
      modelPreference: input.modelPreference,
      status: "running",
      prompt: input.prompt,
      createdAt: now,
      updatedAt: now,
      events: [],
      queue: []
    };
    this.agents.set(agent.id, agent);
    this.startRun(agent, input.prompt, context);
    return this.snapshot(agent);
  }

  list(): SubagentSnapshot[] {
    return [...this.agents.values()].map((agent) => this.snapshot(agent));
  }

  get(agentId: string): SubagentSnapshot {
    return this.snapshot(this.requireAgent(agentId));
  }

  async wait(input: z.infer<typeof AgentWaitInputSchema>): Promise<SubagentSnapshot> {
    const agent = this.requireAgent(input.agentId);
    const timeoutMs = input.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    const startedAt = performance.now();

    while (agent.status === "running" && performance.now() - startedAt < timeoutMs) {
      await agent.run?.catch(() => undefined);
      if (agent.status !== "running") {
        break;
      }
      await delay(50);
    }

    return this.snapshot(agent);
  }

  send(input: z.infer<typeof AgentSendInputSchema>, context: ToolContext): SubagentSnapshot {
    const agent = this.requireAgent(input.agentId);
    if (agent.status === "running") {
      agent.queue.push(input.prompt);
      touch(agent);
      return this.snapshot(agent);
    }

    this.startRun(agent, input.prompt, context);
    return this.snapshot(agent);
  }

  cancel(agentId: string, context?: ToolContext): SubagentSnapshot {
    const agent = this.requireAgent(agentId);
    agent.controller?.abort();
    agent.status = "canceled";
    agent.error = "Canceled by parent agent.";
    touch(agent);
    emitSubagentCompleted(agent, context);
    return this.snapshot(agent);
  }

  resume(input: z.infer<typeof AgentResumeInputSchema>, context: ToolContext): SubagentSnapshot {
    const agent = this.requireAgent(input.agentId);
    if (agent.status === "running") {
      return this.snapshot(agent);
    }

    this.startRun(agent, input.prompt ?? "Continue from the previous sub-agent state.", context);
    return this.snapshot(agent);
  }

  private startRun(agent: SubagentRecord, prompt: string, context: ToolContext) {
    if (this.activeCount >= (this.options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT)) {
      agent.status = "failed";
      agent.error = `Sub-agent concurrency limit reached (${this.options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT}).`;
      touch(agent);
      emitSubagentCompleted(agent, context);
      return;
    }

    agent.model = this.resolveModel(context, agent);
    const controller = new AbortController();
    agent.controller = controller;
    agent.status = "running";
    agent.error = undefined;
    touch(agent);
    this.activeCount += 1;
    agent.run = this.runAgentTurn(agent, prompt, context, controller, agent.model)
      .finally(() => {
        this.activeCount = Math.max(0, this.activeCount - 1);
      });
  }

  private async runAgentTurn(agent: SubagentRecord, prompt: string, context: ToolContext, controller: AbortController, model: string | undefined) {
    const threadId = agent.id;
    const turnId = crypto.randomUUID();
    const runtimeContext = buildRuntimeContext(agent.events, { model, checkpoint: "auto" });
    const nextEvents = [...agent.events];
    if (runtimeContext.checkpointEvent) {
      nextEvents.push({
        id: crypto.randomUUID(),
        seq: nextSeq(nextEvents),
        threadId,
        turnId,
        createdAt: new Date().toISOString(),
        ...runtimeContext.checkpointEvent
      } as RuntimeEvent);
      agent.events = nextEvents;
      touch(agent);
    }

    try {
      const llm = await this.options.createClient(context, agent);
      const registry = await this.options.createRegistry();
      const engine = new AgentEngine(llm, {
        artifacts: this.options.artifacts,
        maxModelIterations: this.options.maxModelIterations,
        model,
        projectContext: this.resolveProjectContext(context, agent),
        systemPrompt: [
          typeof this.options.systemPrompt === "function"
            ? this.options.systemPrompt(context, agent)
            : this.options.systemPrompt,
          createSubagentRoleSystemPrompt(agent)
        ].filter(Boolean).join("\n"),
        tools: {
          registry,
          context,
          requestApproval: async (call) => ({ callId: call.id, decision: "denied" })
        }
      });

      for await (const event of engine.startTurn({
        threadId,
        turnId,
        text: prompt,
        history: runtimeContext.messages,
        historyOmittedMessages: runtimeContext.omittedMessages,
        historyTruncated: runtimeContext.truncated,
        historyCompressed: runtimeContext.compressed,
        historySummaryChars: runtimeContext.summaryChars,
        historyReasoningReplayTokens: runtimeContext.reasoningReplayTokens,
        historyReasoningRetention: runtimeContext.reasoningRetention,
        historyCheckpoint: runtimeContext.checkpoint,
        seqStart: nextSeq(nextEvents),
        signal: controller.signal
      })) {
        nextEvents.push(event);
        agent.events = nextEvents;
        touch(agent);
      }

      if (agent.status !== "canceled") {
        const failed = latestTurnFailed(nextEvents);
        agent.status = failed ? "failed" : "completed";
        agent.error = failed?.message;
        touch(agent);
        emitSubagentCompleted(agent, context);
      }
    } catch (error) {
      if (agent.status !== "canceled") {
        agent.status = controller.signal.aborted ? "canceled" : "failed";
        agent.error = error instanceof Error ? error.message : String(error);
        touch(agent);
        emitSubagentCompleted(agent, context);
      }
    } finally {
      if (agent.status !== "canceled" && agent.queue.length > 0) {
        const nextPrompt = agent.queue.shift();
        if (nextPrompt) {
          this.startRun(agent, nextPrompt, context);
        }
      }
    }
  }

  private requireAgent(agentId: string) {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Unknown sub-agent: ${agentId}`);
    }
    return agent;
  }

  private resolveModel(context: ToolContext, agent: SubagentRecord) {
    return typeof this.options.model === "function"
      ? this.options.model(context, agent)
      : this.options.model;
  }

  private resolveProjectContext(context: ToolContext, agent: SubagentRecord) {
    return typeof this.options.projectContext === "function"
      ? this.options.projectContext(context, agent)
      : this.options.projectContext;
  }

  private snapshot(agent: SubagentRecord): SubagentSnapshot {
    return snapshot(agent, {
      activeCount: this.activeCount,
      maxConcurrent: this.options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT
    });
  }
}

export function createSubagentTools(manager: SubagentManager): ToolSpec[] {
  return [
    {
      name: "agent_spawn",
      description: "Start a background sub-agent for a concrete coding or research assignment. Returns immediately with an agent id.",
      capability: "readonly",
      approval: "never",
      inputSchema: AgentSpawnInputSchema,
      modelParameters: {
        type: "object",
        required: ["prompt"],
        properties: {
          prompt: { type: "string" },
          name: { type: "string" },
          role: {
            type: "string",
            enum: SUBAGENT_ROLES,
            description: "Sub-agent role. Use explorer for read-only discovery, worker for bounded implementation, reviewer for evidence-backed review, or general when none fits."
          },
          modelPreference: {
            type: "string",
            enum: SUBAGENT_MODEL_PREFERENCES,
            description: "DeepSeek sub-agent model preference. Omit or use flash by default; use pro only when the child truly needs Pro-level context or reasoning."
          }
        }
      },
      async execute(input, context) {
        return { callId: "agent_spawn", ok: true, output: manager.spawn(AgentSpawnInputSchema.parse(input), context) };
      }
    },
    {
      name: "agent_wait",
      description: "Wait for a sub-agent to finish or return its latest status after a timeout.",
      capability: "readonly",
      approval: "never",
      inputSchema: AgentWaitInputSchema,
      async execute(input) {
        return { callId: "agent_wait", ok: true, output: await manager.wait(AgentWaitInputSchema.parse(input)) };
      }
    },
    {
      name: "agent_send_input",
      description: "Send a follow-up prompt to a sub-agent. Running agents queue the prompt; completed agents start a new turn.",
      capability: "readonly",
      approval: "never",
      inputSchema: AgentSendInputSchema,
      async execute(input, context) {
        return { callId: "agent_send_input", ok: true, output: manager.send(AgentSendInputSchema.parse(input), context) };
      }
    },
    {
      name: "agent_cancel",
      description: "Cancel a running sub-agent.",
      capability: "readonly",
      approval: "never",
      inputSchema: AgentIdInputSchema,
      async execute(input, context) {
        return { callId: "agent_cancel", ok: true, output: manager.cancel(AgentIdInputSchema.parse(input).agentId, context) };
      }
    },
    {
      name: "agent_resume",
      description: "Resume a stopped sub-agent with an optional follow-up prompt.",
      capability: "readonly",
      approval: "never",
      inputSchema: AgentResumeInputSchema,
      async execute(input, context) {
        return { callId: "agent_resume", ok: true, output: manager.resume(AgentResumeInputSchema.parse(input), context) };
      }
    },
    {
      name: "agent_list",
      description: "List sub-agent status snapshots.",
      capability: "readonly",
      approval: "never",
      inputSchema: z.object({}).optional().default({}),
      async execute() {
        return { callId: "agent_list", ok: true, output: { agents: manager.list() } };
      }
    }
  ];
}

function snapshot(agent: SubagentRecord, runtime: { activeCount: number; maxConcurrent: number }): SubagentSnapshot {
  return {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    status: agent.status,
    prompt: agent.prompt,
    model: agent.model,
    modelPreference: agent.modelPreference,
    activeCount: runtime.activeCount,
    maxConcurrent: runtime.maxConcurrent,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    turnCount: new Set(agent.events.filter((event) => event.type === "user_message").map((event) => event.turnId)).size,
    eventCount: agent.events.length,
    output: assistantOutput(agent.events),
    totalCostUsd: sumUsageCost(agent.events, "costUsd"),
    totalCostCny: sumUsageCost(agent.events, "costCny"),
    error: agent.error
  };
}

function sumUsageCost(events: RuntimeEvent[], field: "costUsd" | "costCny") {
  return Math.round(events
    .filter((event) => event.type === "token_usage")
    .reduce((sum, event) => {
      const value = (event as unknown as Record<string, unknown>)[field];
      return sum + (typeof value === "number" ? value : 0);
    }, 0) * 1_000_000) / 1_000_000;
}

function assistantOutput(events: RuntimeEvent[]) {
  return events
    .filter((event) => event.type === "assistant_delta" || event.type === "assistant_message")
    .map((event) => event.text)
    .join("")
    .trim();
}

function emitSubagentCompleted(agent: SubagentRecord, context?: ToolContext) {
  if (!context?.onRuntimeEvent) {
    return;
  }
  if (agent.status === "running") {
    return;
  }
  context.onRuntimeEvent({
    type: "subagent_completed",
    agentId: agent.id,
    name: agent.name,
    role: agent.role,
    ...(agent.model ? { model: agent.model } : {}),
    status: agent.status,
    summary: subagentCompletionSummary(agent),
    ...(agent.error ? { error: agent.error } : {}),
    eventCount: agent.events.length
  });
}

function subagentCompletionSummary(agent: SubagentRecord) {
  const output = assistantOutput(agent.events);
  const summary = output || agent.error || `${agent.name} ${agent.status}`;
  return truncateSummary(summary);
}

function truncateSummary(summary: string) {
  const normalized = summary.trim();
  const maxChars = 1_200;
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars)}\n[summary truncated]`;
}

function summarizePrompt(prompt: string) {
  return prompt.replace(/\s+/g, " ").trim().slice(0, 80) || "sub-agent";
}

function touch(agent: SubagentRecord) {
  agent.updatedAt = new Date().toISOString();
}

function nextSeq(events: RuntimeEvent[]) {
  return events.reduce((max, event) => Math.max(max, event.seq), -1) + 1;
}

function latestTurnFailed(events: RuntimeEvent[]) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === "turn_failed") {
      return event;
    }
  }
  return undefined;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
