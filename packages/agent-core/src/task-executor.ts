import type { RuntimeEvent } from "@ore-code/protocol";
import type { ToolContext, ToolRegistry } from "@ore-code/tools";
import { AgentEngine, type ArtifactSink } from "./engine";
import type { LlmClient } from "./llm";
import { createDurableTaskSystemPrompt } from "./prompts";
import type { DurableTaskManager, DurableTaskSnapshot } from "./task-tools";

export interface DurableTaskExecutorOptions {
  artifacts?: { store: ArtifactSink };
  createClient(): Promise<LlmClient>;
  createRegistry(): Promise<ToolRegistry> | ToolRegistry;
  maxModelIterations?: number;
  model?: string;
  mode?: ToolContext["mode"];
  projectContext?: string | ((task: DurableTaskSnapshot, context: ToolContext) => string | undefined);
  systemPrompt?: string | ((task: DurableTaskSnapshot, context: ToolContext, registry: ToolRegistry) => string | undefined);
  trustedWorkspace?: boolean;
  workspacePath: string;
}

export interface DurableTaskExecutionResult {
  ran: boolean;
  task?: DurableTaskSnapshot;
  eventCount?: number;
  output?: string;
  error?: string;
}

export class DurableTaskExecutor {
  private running = false;

  constructor(
    private readonly taskManager: DurableTaskManager,
    private readonly options: DurableTaskExecutorOptions
  ) {}

  async runNext(): Promise<DurableTaskExecutionResult> {
    if (this.running) {
      return { ran: false, error: "Durable task executor is already running." };
    }

    const task = await this.taskManager.claimNextQueued({ workspacePath: this.options.workspacePath });
    if (!task) {
      return { ran: false };
    }

    this.running = true;
    const workspacePath = task.workspacePath ?? this.options.workspacePath;
    const threadId = task.executionThreadId ?? task.threadId ?? `durable-task-${task.id}`;
    const turnId = crypto.randomUUID();
    const events: RuntimeEvent[] = [];

    try {
      const context: ToolContext = {
        workspacePath,
        mode: this.options.mode ?? "agent",
        trustedWorkspace: this.options.trustedWorkspace ?? false,
        threadId,
        turnId,
        onRuntimeEvent: (event) => {
          events.push({
            id: crypto.randomUUID(),
            seq: nextSeq(events),
            threadId,
            turnId,
            createdAt: new Date().toISOString(),
            ...event
          } as RuntimeEvent);
        }
      };
      const llm = await this.options.createClient();
      const registry = await this.options.createRegistry();
      const engine = new AgentEngine(llm, {
        artifacts: this.options.artifacts,
        maxModelIterations: this.options.maxModelIterations,
        model: this.options.model,
        projectContext: this.resolveProjectContext(task, context),
        systemPrompt: this.resolveSystemPrompt(task, context, registry),
        tools: {
          registry,
          context,
          requestApproval: async (call) => ({ callId: call.id, decision: "denied" })
        }
      });

      for await (const event of engine.startTurn({
        threadId,
        turnId,
        text: task.prompt,
        seqStart: 0
      })) {
        events.push(event);
      }

      const output = assistantOutput(events);
      const failed = events.find((event) => event.type === "turn_failed");
      const completedTask = failed
        ? await this.taskManager.failExecution({
          taskId: task.id,
          threadId,
          turnId,
          eventCount: events.length,
          workspacePath,
          output,
          error: failed.message
        })
        : await this.taskManager.completeExecution({
          taskId: task.id,
          threadId,
          turnId,
          eventCount: events.length,
          workspacePath,
          output
        });

      return {
        ran: true,
        task: completedTask,
        eventCount: events.length,
        output,
        error: failed?.message
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failedTask = await this.taskManager.failExecution({
        taskId: task.id,
        threadId,
        turnId,
        eventCount: events.length,
        workspacePath,
        output: assistantOutput(events),
        error: message
      });
      return {
        ran: true,
        task: failedTask,
        eventCount: events.length,
        output: failedTask.output,
        error: message
      };
    } finally {
      this.running = false;
    }
  }

  private resolveSystemPrompt(task: DurableTaskSnapshot, context: ToolContext, registry: ToolRegistry) {
    if (typeof this.options.systemPrompt === "function") {
      return this.options.systemPrompt(task, context, registry);
    }
    if (this.options.systemPrompt) {
      return this.options.systemPrompt;
    }
    return createDurableTaskSystemPrompt({
      workspacePath: context.workspacePath,
      mode: context.mode,
      tools: registry.list()
    });
  }

  private resolveProjectContext(task: DurableTaskSnapshot, context: ToolContext) {
    if (typeof this.options.projectContext === "function") {
      return this.options.projectContext(task, context);
    }
    return this.options.projectContext;
  }
}

function assistantOutput(events: RuntimeEvent[]) {
  return events
    .filter((event) => event.type === "assistant_delta" || event.type === "assistant_message")
    .map((event) => event.text)
    .join("")
    .trim();
}

function nextSeq(events: RuntimeEvent[]) {
  return events.reduce((max, event) => Math.max(max, event.seq), -1) + 1;
}
