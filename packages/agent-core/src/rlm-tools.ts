import { z } from "zod";
import { executeRegisteredTool, type ToolContext, type ToolRegistry, type ToolSpec } from "@seekforge/tools";
import { toJSONSchema } from "zod";
import type { ArtifactMetadata, ToolResult } from "@seekforge/protocol";
import type { LlmClient, LlmMessage, LlmToolDefinition, ModelUsage } from "./llm";
import { serializeToolResultForModel } from "./tool-result-message";

const MAX_RLM_BATCH = 16;
const DEFAULT_CHILD_TIMEOUT_MS = 120_000;
const PROMPT_PREVIEW_CHARS = 160;

const RlmQueryInputSchema = z
  .object({
    prompt: z.string().trim().min(1).optional(),
    prompts: z.array(z.string().trim().min(1)).min(1).max(MAX_RLM_BATCH).optional(),
    system: z.string().trim().min(1).optional()
  })
  .superRefine((input, context) => {
    if (!input.prompt && !input.prompts) {
      context.addIssue({
        code: "custom",
        message: "rlm_query requires either prompt or prompts."
      });
    }

    if (input.prompt && input.prompts) {
      context.addIssue({
        code: "custom",
        message: "Use prompt for one subtask or prompts for a batch, not both."
      });
    }
  });

export type RlmQueryInput = z.infer<typeof RlmQueryInputSchema>;

export interface RlmQueryHost {
  artifacts?: { store: RlmArtifactSink };
  childModel: string;
  createClient(): Promise<LlmClient>;
  readonlyTools?: ToolRegistry;
  timeoutMs?: number;
}

export interface RlmArtifactSink {
  write(input: {
    type: ArtifactMetadata["type"];
    content: string;
    summary: string;
    sourceCallId?: string;
  }): Promise<ArtifactMetadata>;
}

export interface RlmQueryResult {
  artifact?: ArtifactMetadata;
  childModel: string;
  promptCount: number;
  durationMs: number;
  okCount: number;
  failedCount: number;
  usage?: ModelUsage;
  totalCostUsd: number;
  totalCostCny: number;
  results: RlmQueryItemResult[];
}

export interface RlmQueryItemResult {
  index: number;
  ok: boolean;
  promptPreview: string;
  text: string;
  reasoningPreview?: string;
  usage?: ModelUsage;
  durationMs: number;
  error?: string;
}

export function createRlmQueryTool(host: RlmQueryHost): ToolSpec<RlmQueryInput, RlmQueryResult> {
  return {
    name: "rlm_query",
    description:
      "Run 1-16 independent low-cost DeepSeek Flash reasoning subtasks in parallel. Use for batch analysis, cross-checks, and decomposed read-only reasoning; each prompt should be self-contained.",
    capability: "readonly",
    approval: "never",
    inputSchema: RlmQueryInputSchema,
    modelParameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        prompt: {
          type: "string",
          description: "A single self-contained subtask prompt."
        },
        prompts: {
          type: "array",
          minItems: 1,
          maxItems: MAX_RLM_BATCH,
          items: { type: "string" },
          description: "Independent self-contained subtask prompts to run in parallel."
        },
        system: {
          type: "string",
          description: "Optional shared system instruction for all subtasks."
        }
      }
    },
    async execute(input, context) {
      const startedAt = performance.now();
      const prompts = input.prompts ?? [input.prompt ?? ""];
      const timeoutMs = host.timeoutMs ?? DEFAULT_CHILD_TIMEOUT_MS;

      const results = await Promise.all(
        prompts.map((prompt, index) => runChildQuery(host, {
          context,
          prompt,
          system: input.system,
          index,
          total: prompts.length,
          timeoutMs
        }))
      );
      const usage = results.reduce<ModelUsage | undefined>((current, result) => result.usage ? mergeUsage(current, result.usage) : current, undefined);
      const output: RlmQueryResult = {
        childModel: host.childModel,
        promptCount: prompts.length,
        durationMs: Math.round(performance.now() - startedAt),
        okCount: results.filter((result) => result.ok).length,
        failedCount: results.filter((result) => !result.ok).length,
        usage,
        totalCostUsd: roundCost(results.reduce((sum, result) => sum + (result.usage?.costUsd ?? 0), 0)),
        totalCostCny: roundCost(results.reduce((sum, result) => sum + (result.usage?.costCny ?? 0), 0)),
        results
      };
      const artifact = await writeRlmArtifact(host, output);
      if (artifact) {
        output.artifact = artifact;
      }

      return {
        callId: "rlm_query",
        ok: true,
        artifactId: artifact?.id,
        output
      };
    }
  };
}

async function runChildQuery(
  host: RlmQueryHost,
  input: { context: ToolContext; prompt: string; system?: string; index: number; total: number; timeoutMs: number }
): Promise<RlmQueryItemResult> {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  emitRlmProgress(input.context, {
    status: "running",
    index: input.index,
    total: input.total,
    promptPreview: preview(input.prompt)
  });

  try {
    const client = await host.createClient();
    const { text, reasoning, usage } = await collectChildCompletion(
      client,
      input.prompt,
      input.system,
      controller.signal,
      host.readonlyTools,
      input.context
    );
    const durationMs = Math.round(performance.now() - startedAt);
    emitRlmProgress(input.context, {
      status: "completed",
      index: input.index,
      total: input.total,
      promptPreview: preview(input.prompt),
      durationMs
    });

    return {
      index: input.index,
      ok: true,
      promptPreview: preview(input.prompt),
      text,
      reasoningPreview: reasoning ? preview(reasoning) : undefined,
      usage,
      durationMs
    };
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);
    const message = error instanceof Error ? error.message : String(error);
    emitRlmProgress(input.context, {
      status: "failed",
      index: input.index,
      total: input.total,
      promptPreview: preview(input.prompt),
      durationMs,
      error: message
    });

    return {
      index: input.index,
      ok: false,
      promptPreview: preview(input.prompt),
      text: "",
      durationMs,
      error: message
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function collectChildCompletion(
  client: LlmClient,
  prompt: string,
  system: string | undefined,
  signal: AbortSignal,
  readonlyTools: ToolRegistry | undefined,
  context: ToolContext
) {
  let text = "";
  let reasoning = "";
  let usage: ModelUsage | undefined;
  const messages: LlmMessage[] = system
    ? [
        { role: "system", content: system },
        { role: "user", content: prompt }
      ]
    : [{ role: "user", content: prompt }];
  const tools = readonlyToolDefinitions(readonlyTools);

  for (let iteration = 0; iteration < 4; iteration += 1) {
    let assistantText = "";
    let reasoningText = "";
    let finishReason: string | undefined;
    const toolCalls: Array<{ id: string; name: string; input: unknown }> = [];
    const toolResults: ToolResult[] = [];

    for await (const chunk of client.streamTurn({
      threadId: `rlm-${crypto.randomUUID()}`,
      turnId: crypto.randomUUID(),
      messages,
      signal,
      tools
    })) {
      if (chunk.type === "assistant_delta") {
        assistantText += chunk.text;
      }
      if (chunk.type === "reasoning_delta") {
        reasoningText += chunk.text;
      }
      if (chunk.type === "usage") {
        usage = mergeUsage(usage, chunk.usage);
      }
      if (chunk.type === "tool_call") {
        toolCalls.push(chunk.call);
        toolResults.push(await executeReadonlyChildTool(readonlyTools, context, chunk.call));
      }
      if (chunk.type === "done") {
        finishReason = chunk.finishReason;
        if (chunk.finalText) {
          assistantText += chunk.finalText;
        }
      }
    }

    text += assistantText;
    reasoning += reasoningText;

    if (finishReason !== "tool_calls" || toolCalls.length === 0) {
      break;
    }

    messages.push({
      role: "assistant",
      content: assistantText,
      reasoningContent: reasoningText || undefined,
      toolCalls
    });
    for (const result of toolResults) {
      messages.push({
        role: "tool",
        toolCallId: result.callId,
        content: serializeToolResultForModel(result)
      });
    }
  }

  return { text: text.trim(), reasoning: reasoning.trim(), usage };
}

async function executeReadonlyChildTool(
  readonlyTools: ToolRegistry | undefined,
  context: ToolContext,
  call: { id: string; name: string; input: unknown }
): Promise<ToolResult> {
  if (!readonlyTools) {
    return {
      callId: call.id,
      ok: false,
      error: {
        code: "rlm_tool_not_allowed",
        message: `RLM child tool is not readonly or not registered: ${call.name}`
      }
    };
  }

  const tool = readonlyTools.get(call.name);
  if (!tool || tool.capability !== "readonly" || tool.approval !== "never") {
    return {
      callId: call.id,
      ok: false,
      error: {
        code: "rlm_tool_not_allowed",
        message: `RLM child tool is not readonly or not registered: ${call.name}`
      }
    };
  }

  const outcome = await executeRegisteredTool(readonlyTools, call.name, call.input, context, undefined, { callId: call.id });
  if (outcome.type === "completed") {
    return { ...outcome.result, callId: call.id };
  }

  return {
    callId: call.id,
    ok: false,
    error: {
      code: outcome.type,
      message: outcome.type === "not-found" ? `Tool not found: ${call.name}` : outcome.reason
    }
  };
}

function readonlyToolDefinitions(registry: ToolRegistry | undefined): LlmToolDefinition[] | undefined {
  const tools = registry?.list().filter((tool) => tool.capability === "readonly" && tool.approval === "never") ?? [];
  if (tools.length === 0) {
    return undefined;
  }

  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.modelParameters ?? toJSONSchema(tool.inputSchema)
    }
  }));
}

async function writeRlmArtifact(host: RlmQueryHost, output: RlmQueryResult) {
  return host.artifacts?.store.write({
    type: "text",
    content: JSON.stringify(output, null, 2),
    summary: `rlm_query ${output.promptCount} ${host.childModel} subtasks`,
    sourceCallId: "rlm_query"
  });
}

function emitRlmProgress(
  context: ToolContext,
  event: {
    status: "running" | "completed" | "failed";
    index: number;
    total: number;
    promptPreview: string;
    durationMs?: number;
    error?: string;
  }
) {
  if (!context.onCommandOutput || !context.toolCallId) {
    return;
  }

  context.onCommandOutput({
    callId: context.toolCallId,
    stream: "stdout",
    text: `${JSON.stringify({ type: "rlm_progress", ...event })}\n`
  });
}

function preview(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= PROMPT_PREVIEW_CHARS
    ? normalized
    : `${normalized.slice(0, PROMPT_PREVIEW_CHARS - 1)}…`;
}

function mergeUsage(current: ModelUsage | undefined, next: ModelUsage): ModelUsage {
  if (!current) {
    return next;
  }

  return {
    provider: next.provider ?? current.provider,
    model: next.model ?? current.model,
    promptTokens: current.promptTokens + next.promptTokens,
    completionTokens: current.completionTokens + next.completionTokens,
    totalTokens: current.totalTokens + next.totalTokens,
    cachedTokens: (current.cachedTokens ?? 0) + (next.cachedTokens ?? 0),
    cacheHitTokens: (current.cacheHitTokens ?? 0) + (next.cacheHitTokens ?? 0),
    cacheMissTokens: (current.cacheMissTokens ?? 0) + (next.cacheMissTokens ?? 0),
    cacheHitRatio: current.promptTokens + next.promptTokens > 0
      ? ((current.cacheHitTokens ?? current.cachedTokens ?? 0) + (next.cacheHitTokens ?? next.cachedTokens ?? 0)) /
        (current.promptTokens + next.promptTokens)
      : 0,
    reasoningTokens: (current.reasoningTokens ?? 0) + (next.reasoningTokens ?? 0),
    costUsd: roundCost((current.costUsd ?? 0) + (next.costUsd ?? 0)),
    costCny: roundCost((current.costCny ?? 0) + (next.costCny ?? 0)),
    cacheHitInputCostUsd: roundCost((current.cacheHitInputCostUsd ?? 0) + (next.cacheHitInputCostUsd ?? 0)),
    cacheMissInputCostUsd: roundCost((current.cacheMissInputCostUsd ?? 0) + (next.cacheMissInputCostUsd ?? 0)),
    outputCostUsd: roundCost((current.outputCostUsd ?? 0) + (next.outputCostUsd ?? 0)),
    cacheHitInputCostCny: roundCost((current.cacheHitInputCostCny ?? 0) + (next.cacheHitInputCostCny ?? 0)),
    cacheMissInputCostCny: roundCost((current.cacheMissInputCostCny ?? 0) + (next.cacheMissInputCostCny ?? 0)),
    outputCostCny: roundCost((current.outputCostCny ?? 0) + (next.outputCostCny ?? 0))
  };
}

function roundCost(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
