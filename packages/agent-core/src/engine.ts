import type { ApprovalDecision, ArtifactMetadata, RuntimeEvent, ToolCall, ToolResult } from "@seekforge/protocol";
import { evaluateApproval, executeRegisteredTool, isApproved, type ToolContext, type ToolRegistry } from "@seekforge/tools";
import { buildCapacityReport, estimateInputTokens, estimateTokensFromChars, estimateUsageCostDetails, type CacheWarmupStatus, type CapacityOptions } from "./capacity";
import { coherenceFromCapacity } from "./coherence";
import { toolSpecsToLlmDefinitions, type ImmutablePrefixSnapshot } from "./immutable-prefix";
import { RequestUserInputSchema } from "./interaction-tool";
import type { LlmClient, LlmMessage, LlmToolDefinition, ModelUsage } from "./llm";
import { LoopGuard } from "./loop-guard";
import { parsePlanInteractionRequest } from "./plan-interaction";
import type { ReasoningRetentionReport } from "./reasoning-retention";
import type { ContextCheckpointReport } from "./checkpoint-controller";
import { assertStableRequestPrefixSegments, assembleRequest, type AssembledRequest } from "./request-assembler";
import { serializeToolResultForModel } from "./tool-result-message";

export interface StartTurnInput {
  threadId: string;
  turnId: string;
  text: string;
  modelText?: string;
  history?: LlmMessage[];
  historyOmittedMessages?: number;
  historyTruncated?: boolean;
  historyCompressed?: boolean;
  historySummaryChars?: number;
  historyReasoningReplayTokens?: number;
  historyReasoningRetention?: ReasoningRetentionReport;
  historyCheckpoint?: ContextCheckpointReport;
  seqStart?: number;
  signal?: AbortSignal;
}

export interface AgentEngineOptions {
  maxModelIterations?: number;
  systemPrompt?: string;
  projectContext?: string;
  capacity?: CapacityOptions;
  model?: string;
  provider?: string;
  artifacts?: {
    store: ArtifactSink;
    maxInlineChars?: number;
    inlineTailChars?: number;
    largeOutputThresholds?: Record<string, number>;
  };
  cacheWarmup?: {
    enabled?: boolean;
    store?: CacheWarmupStore;
  };
  immutablePrefix?: ImmutablePrefixSnapshot;
  requestMonitor?: {
    previous?: AssembledRequest;
    assertAppendOnlyPrefix?: boolean;
    onAssembled?: (request: AssembledRequest) => void;
  };
  tools?: {
    registry: ToolRegistry;
    context: ToolContext;
    approvals?: ApprovalDecision[];
    isToolCallAllowed?: (call: ToolCall) => boolean;
    requestApproval?: (call: ToolCall) => Promise<ApprovalDecision | undefined>;
    requestInteraction?: (request: Extract<RuntimeEvent, { type: "interaction_requested" }>) => Promise<Extract<RuntimeEvent, { type: "interaction_decided" }>["decision"] | undefined>;
  };
}

export class ToolProfileEscalationError extends Error {
  constructor(readonly call: ToolCall) {
    super(`Tool call requires a stronger model profile: ${call.name}`);
    this.name = "ToolProfileEscalationError";
  }
}

export interface CacheWarmupRecord {
  key: string;
  prefixHash: string;
  model?: string;
  warmedAt: string;
}

export interface CacheWarmupStore {
  get(key: string): CacheWarmupRecord | undefined;
  set(record: CacheWarmupRecord): void;
}

export interface ArtifactSink {
  write(input: {
    type: ArtifactMetadata["type"];
    content: string;
    summary: string;
    sourceCallId?: string;
  }): Promise<ArtifactMetadata>;
}

const DEFAULT_ARTIFACT_MAX_INLINE_CHARS = 8_000;
const DEFAULT_ARTIFACT_INLINE_TAIL_CHARS = 2_000;
const DEFAULT_SEARCH_ARTIFACT_THRESHOLD_CHARS = 12_000;
const DEFAULT_WEB_DIFF_ARTIFACT_THRESHOLD_CHARS = 24_000;

export class AgentEngine {
  private seq = 0;

  constructor(
    private readonly llm: LlmClient,
    private readonly options: AgentEngineOptions = {}
  ) {}

  async *startTurn(input: StartTurnInput): AsyncIterable<RuntimeEvent> {
    if (input.seqStart !== undefined) {
      this.seq = input.seqStart;
    }

    yield this.event(input, { type: "user_message", text: input.text });

    try {
      const assembledRequest = this.initialRequest(input.modelText ?? input.text, input.history ?? []);
      if (this.options.requestMonitor?.assertAppendOnlyPrefix && this.options.requestMonitor.previous) {
        assertStableRequestPrefixSegments(this.options.requestMonitor.previous, assembledRequest);
      }
      this.options.requestMonitor?.onAssembled?.(assembledRequest);
      const messages: LlmMessage[] = assembledRequest.messages;
      const modelTools = assembledRequest.tools;
      const maxModelIterations = this.options.maxModelIterations;
      const initialCapacity = buildCapacityReport({
        provider: this.options.provider,
        model: this.options.model,
        messages,
        tools: modelTools,
        omittedMessages: input.historyOmittedMessages,
        truncated: input.historyTruncated,
        compressed: input.historyCompressed,
        summaryChars: input.historySummaryChars,
        reasoningReplayTokens: input.historyReasoningReplayTokens,
        reasoningRetention: input.historyReasoningRetention,
        checkpoint: input.historyCheckpoint
      }, this.options.capacity);
      const cacheWarmup = await this.warmupCachePrefix(input, initialCapacity, messages, modelTools);
      yield this.event(input, { type: "context_capacity", ...initialCapacity, ...cacheWarmup });
      yield this.event(input, { type: "coherence_state", ...coherenceFromCapacity(initialCapacity) });

      if (initialCapacity.status === "critical") {
        yield this.event(input, {
          type: "turn_failed",
          message: `Context capacity critical: estimated ${initialCapacity.estimatedInputTokens}/${initialCapacity.maxInputTokens} input tokens.`
        });
        return;
      }

      const planMode = this.options.tools?.context.mode === "plan";
      const loopGuard = new LoopGuard();
      for (let iteration = 0; maxModelIterations === undefined || iteration < maxModelIterations; iteration += 1) {
        throwIfAborted(input.signal);
        let assistantText = "";
        let reasoningText = "";
        let finishReason: "stop" | "tool_calls" | "length" | "error" | undefined;
        let emittedProviderUsage = false;
        const toolCalls: ToolCall[] = [];
        const toolResults: ToolResult[] = [];

        for await (const chunk of this.llm.streamTurn({
          threadId: input.threadId,
          turnId: input.turnId,
          messages,
          signal: input.signal,
          tools: modelTools
        })) {
          throwIfAborted(input.signal);
          if (chunk.type === "assistant_delta") {
            assistantText += chunk.text;
            if (!planMode) {
              yield this.event(input, { type: "assistant_delta", text: chunk.text });
            }
          }

          if (chunk.type === "reasoning_delta") {
            reasoningText += chunk.text;
            yield this.event(input, { type: "reasoning_delta", text: chunk.text });
          }

          if (chunk.type === "usage") {
            emittedProviderUsage = true;
            yield this.event(input, { type: "token_usage", ...chunk.usage });
          }

          if (chunk.type === "tool_call") {
            if (this.options.tools?.isToolCallAllowed && !this.options.tools.isToolCallAllowed(chunk.call)) {
              throw new ToolProfileEscalationError(chunk.call);
            }
            toolCalls.push(chunk.call);
            yield this.toolEvent(input, "tool_call_requested", chunk.call);
            for await (const event of this.runToolCall(input, chunk.call, loopGuard)) {
              throwIfAborted(input.signal);
              if (event.type === "tool_completed" || event.type === "tool_failed") {
                toolResults.push(event.result);
              }
              yield event;
            }
          }

          if (chunk.type === "done") {
            finishReason = chunk.finishReason ?? "stop";
            if (chunk.finalText) {
              assistantText += chunk.finalText;
              if (!planMode) {
                yield this.event(input, { type: "assistant_message", text: chunk.finalText });
              }
            }
          }
        }

        if (finishReason === "tool_calls" && toolCalls.length > 0) {
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
          continue;
        }

        if (finishReason === "length" || finishReason === "error") {
          yield this.event(input, {
            type: "turn_failed",
            message:
              finishReason === "length"
                ? "Model response stopped because it reached the provider length limit."
                : "Model provider returned an error finish reason."
          });
          return;
        }

        if (planMode) {
          const interaction = parsePlanInteractionRequest(assistantText);
          if (interaction) {
            yield this.event(input, {
              type: "interaction_requested",
              requestId: interaction.requestId ?? crypto.randomUUID(),
              title: interaction.title,
              message: interaction.message,
              options: interaction.options,
              recommendedOptionId: interaction.recommendedOptionId
            });
          } else if (assistantText.trim()) {
            yield this.event(input, { type: "assistant_message", text: assistantText });
          }
        }

        yield this.event(input, { type: "turn_completed" });
        if (!emittedProviderUsage) {
          yield this.event(input, {
            type: "token_usage",
            ...estimateUsage(this.options.provider, this.options.model, messages, assistantText, modelTools)
          });
        }
        return;
      }

      yield this.event(input, { type: "turn_failed", message: "Model tool loop exceeded the maximum iteration limit." });
    } catch (error) {
      if (error instanceof ToolProfileEscalationError) {
        throw error;
      }
      yield this.event(input, { type: "turn_failed", message: messageFromError(error) });
    }
  }

  private event<T extends Omit<RuntimeEvent, "id" | "seq" | "threadId" | "turnId" | "createdAt">>(
    input: StartTurnInput,
    body: T
  ): RuntimeEvent {
    return {
      id: crypto.randomUUID(),
      seq: this.seq++,
      threadId: input.threadId,
      turnId: input.turnId,
      createdAt: new Date().toISOString(),
      ...body
    } as RuntimeEvent;
  }

  private toolEvent(
    input: StartTurnInput,
    type: "tool_call_requested" | "approval_requested" | "tool_started",
    call: ToolCall
  ): RuntimeEvent {
    return this.event(input, { type, call });
  }

  private async *runToolCall(input: StartTurnInput, call: ToolCall, loopGuard: LoopGuard): AsyncIterable<RuntimeEvent> {
    throwIfAborted(input.signal);
    const runtime = this.options.tools;
    if (!runtime) {
      return;
    }

    const tool = runtime.registry.get(call.name);
    if (!tool) {
      yield this.toolResultEvent(input, "tool_failed", {
        callId: call.id,
        ok: false,
        error: {
          code: "tool_not_found",
          message: `Tool is not registered: ${call.name}`
        }
      });
      return;
    }

    if (call.name === "request_user_input") {
      yield* this.runInteractionToolCall(input, call);
      return;
    }

    const approval = evaluateApproval(tool, runtime.context, call.input);
    let decision = runtime.approvals?.find((item) => item.callId === call.id || item.callId === call.name);

    if (approval.type === "deny") {
      yield this.toolResultEvent(input, "tool_failed", {
        callId: call.id,
        ok: false,
        error: {
          code: "tool_denied",
          message: approval.reason
        }
      });
      return;
    }

    if (approval.type === "request") {
      yield this.toolEvent(input, "approval_requested", call);
      decision ??= await runtime.requestApproval?.(call);

      if (!isApproved(decision)) {
        if (decision) {
          yield this.event(input, { type: "approval_decided", decision });
        }
        yield this.toolResultEvent(input, "tool_failed", {
          callId: call.id,
          ok: false,
          error: {
            code: decision?.decision === "denied" ? "approval_denied" : "approval_required",
            message:
              decision?.decision === "denied"
                ? `${call.name} was denied by the user.`
                : `${call.name} requires approval in ${runtime.context.mode} mode.`
          }
        });
        return;
      }

      yield this.event(input, { type: "approval_decided", decision });
    }

    throwIfAborted(input.signal);
    const attempt = loopGuard.recordAttempt(call);
    if (attempt?.type === "block") {
      yield this.event(input, {
        type: "loop_guard",
        level: "blocked",
        toolName: call.name,
        message: attempt.message,
        callHash: attempt.callHash,
        failureCount: attempt.failureCount
      });
      yield this.toolResultEvent(input, "tool_failed", {
        callId: call.id,
        ok: false,
        error: {
          code: "loop_guard_blocked",
          message: attempt.message
        }
      });
      return;
    }
    yield this.toolEvent(input, "tool_started", call);

    const outcome = await this.executeToolSafely(call, decision);
    if (outcome.type === "thrown") {
      yield* this.recordLoopGuardOutcome(input, loopGuard, call, false, attempt.callHash);
      yield this.toolResultEvent(input, "tool_failed", {
        callId: call.id,
        ok: false,
        error: {
          code: "tool_execution_error",
          message: outcome.message
        }
      });
      return;
    }

    if (outcome.type === "completed") {
      const result = await this.artifactizeToolResult(call, { ...outcome.result, callId: call.id });
      yield this.toolResultEvent(input, "tool_completed", result);
      yield* this.recordLoopGuardOutcome(input, loopGuard, call, result.ok, attempt.callHash);
      const usage = usageFromToolOutput(result.output);
      if (usage) {
        yield this.event(input, { type: "token_usage", ...usage });
      }
      return;
    }

    const message =
      outcome.type === "approval-required"
        ? outcome.reason
        : outcome.type === "denied"
          ? outcome.reason
          : `Tool is not registered: ${call.name}`;

    yield* this.recordLoopGuardOutcome(input, loopGuard, call, false, attempt.callHash);
    yield this.toolResultEvent(input, "tool_failed", {
      callId: call.id,
      ok: false,
      error: {
        code: outcome.type,
        message
      }
    });
  }

  private async *runInteractionToolCall(input: StartTurnInput, call: ToolCall): AsyncIterable<RuntimeEvent> {
    const runtime = this.options.tools;
    if (!runtime?.requestInteraction) {
      yield this.toolResultEvent(input, "tool_failed", {
        callId: call.id,
        ok: false,
        error: {
          code: "interaction_runtime_required",
          message: "request_user_input requires an interaction runtime."
        }
      });
      return;
    }

    const parsed = RequestUserInputSchema.safeParse(call.input);
    if (!parsed.success) {
      yield this.toolResultEvent(input, "tool_failed", {
        callId: call.id,
        ok: false,
        error: {
          code: "invalid_interaction_request",
          message: parsed.error.message
        }
      });
      return;
    }

    const request = this.event(input, {
      type: "interaction_requested",
      requestId: crypto.randomUUID(),
      title: parsed.data.title,
      message: parsed.data.message,
      options: parsed.data.options,
      recommendedOptionId: parsed.data.recommendedOptionId
    }) as Extract<RuntimeEvent, { type: "interaction_requested" }>;
    yield request;
    const decision = await runtime.requestInteraction(request);
    if (!decision) {
      yield this.toolResultEvent(input, "tool_failed", {
        callId: call.id,
        ok: false,
        error: {
          code: "interaction_cancelled",
          message: "User interaction was cancelled."
        }
      });
      return;
    }

    yield this.event(input, {
      type: "interaction_decided",
      requestId: request.requestId,
      decision
    });
    yield this.toolResultEvent(input, "tool_completed", {
      callId: call.id,
      ok: true,
      output: {
        requestId: request.requestId,
        decision
      }
    });
  }

  private async *recordLoopGuardOutcome(
    input: StartTurnInput,
    loopGuard: LoopGuard,
    call: ToolCall,
    ok: boolean,
    callHash: string | undefined
  ): AsyncIterable<RuntimeEvent> {
    const outcome = loopGuard.recordOutcome(call.name, ok);
    if (!outcome || outcome.type === "continue") {
      return;
    }
    yield this.event(input, {
      type: "loop_guard",
      level: outcome.type === "halt" ? "blocked" : "warning",
      toolName: call.name,
      message: outcome.message,
      callHash,
      failureCount: outcome.failureCount
    });
  }

  private toolResultEvent(input: StartTurnInput, type: "tool_completed" | "tool_failed", result: ToolResult): RuntimeEvent {
    return this.event(input, { type, result });
  }

  private async executeToolSafely(
    call: ToolCall,
    decision: ApprovalDecision | undefined
  ): Promise<
    | Awaited<ReturnType<typeof executeRegisteredTool>>
    | { type: "thrown"; message: string }
  > {
    const runtime = this.options.tools;
    if (!runtime) {
      return { type: "thrown", message: "Tool runtime is not configured." };
    }

    try {
      return await executeRegisteredTool(
        runtime.registry,
        call.name,
        call.input,
        runtime.context,
        decision,
        { callId: call.id }
      );
    } catch (error) {
      return { type: "thrown", message: messageFromError(error) };
    }
  }

  private async artifactizeToolResult(call: ToolCall, result: ToolResult): Promise<ToolResult> {
    const artifactOptions = this.options.artifacts;
    if (!artifactOptions || result.artifactId || !result.output) {
      return result;
    }

    const shellLog = shellLogFromOutput(result.output);
    const maxInlineChars = maxInlineCharsForTool(call.name, artifactOptions);
    if (shellLog) {
      if (shellLog.stdout.length + shellLog.stderr.length <= maxInlineChars) {
        return result;
      }

      const artifact = await artifactOptions.store.write({
        type: "shell-log",
        content: formatShellLogArtifact(shellLog),
        summary: `${call.name} output for ${result.callId}`,
        sourceCallId: result.callId
      });
      const tailChars = Math.max(0, artifactOptions.inlineTailChars ?? DEFAULT_ARTIFACT_INLINE_TAIL_CHARS);
      const output = result.output as Record<string, unknown>;

      return {
        ...result,
        artifactId: artifact.id,
        output: {
          ...output,
          stdout: tailText(shellLog.stdout, tailChars),
          stderr: tailText(shellLog.stderr, tailChars),
          stdoutTruncated: shellLog.stdout.length > tailChars,
          stderrTruncated: shellLog.stderr.length > tailChars,
          artifactSummary: artifact.summary
        }
      };
    }

    const largeOutput = largeOutputFromToolResult(call.name, result.output);
    if (largeOutput && largeOutput.content.length > maxInlineChars) {
      const artifact = await artifactOptions.store.write({
        type: largeOutput.artifactType,
        content: largeOutput.content,
        summary: `${call.name} large output for ${result.callId}`,
        sourceCallId: result.callId
      });
      const output = result.output as Record<string, unknown>;

      return {
        ...result,
        artifactId: artifact.id,
        output: {
          ...largeOutput.inlineOutput(output, artifact.summary),
          artifactSummary: artifact.summary,
          artifactType: artifact.type,
          artifactSize: artifact.size
        }
      };
    }

    const mcpContent = mcpContentFromOutput(result.output);
    if (!mcpContent || mcpContent.text.length <= maxInlineChars) {
      return result;
    }
    const artifact = await artifactOptions.store.write({
      type: "text",
      content: mcpContent.text,
      summary: `${call.name} MCP output for ${result.callId}`,
      sourceCallId: result.callId
    });
    const tailChars = Math.max(0, artifactOptions.inlineTailChars ?? DEFAULT_ARTIFACT_INLINE_TAIL_CHARS);
    const output = result.output as Record<string, unknown>;

    return {
      ...result,
      artifactId: artifact.id,
      output: {
        ...output,
        content: mcpContent.kind === "string" ? tailText(mcpContent.text, tailChars) : "[content moved to artifact]",
        contentPreview: tailText(mcpContent.text, tailChars),
        contentTruncated: true,
        artifactSummary: artifact.summary
      }
    };
  }

  private modelToolDefinitions(): LlmToolDefinition[] | undefined {
    if (this.options.immutablePrefix) {
      return this.options.immutablePrefix.toolDefinitions;
    }

    const tools = this.options.tools?.registry.list();
    return toolSpecsToLlmDefinitions(tools);
  }

  private initialRequest(userText: string, history: LlmMessage[]): AssembledRequest {
    return assembleRequest({
      systemPrompt: this.options.immutablePrefix?.corePrompt ?? this.options.systemPrompt,
      projectContext: this.options.immutablePrefix?.projectSnapshot ?? this.options.projectContext,
      history,
      userText,
      tools: this.modelToolDefinitions()
    });
  }

  private async warmupCachePrefix(
    input: StartTurnInput,
    capacity: ReturnType<typeof buildCapacityReport>,
    messages: LlmMessage[],
    tools?: LlmToolDefinition[]
  ): Promise<{
    cacheWarmupStatus: CacheWarmupStatus;
    cacheWarmupMessage?: string;
    cacheWarmupKey?: string;
    cacheWarmupUpdatedAt?: string;
  }> {
    const enabled = Boolean(this.options.cacheWarmup?.enabled);
    const key = cacheWarmupKey(this.options.model, capacity.prefixHash);
    if (!enabled) {
      return { cacheWarmupStatus: "disabled", cacheWarmupKey: key };
    }

    const existing = this.options.cacheWarmup?.store?.get(key);
    if (existing) {
      return {
        cacheWarmupStatus: "hit",
        cacheWarmupKey: key,
        cacheWarmupUpdatedAt: existing.warmedAt
      };
    }

    if (!this.llm.warmupPrefix) {
      return {
        cacheWarmupStatus: "unsupported",
        cacheWarmupKey: key,
        cacheWarmupMessage: "当前 provider 不支持 prefix warmup。"
      };
    }

    const prefixMessages = messages.slice(0, -1);
    if (prefixMessages.length === 0) {
      return {
        cacheWarmupStatus: "unsupported",
        cacheWarmupKey: key,
        cacheWarmupMessage: "没有稳定 prefix 可预热。"
      };
    }

    try {
      await this.llm.warmupPrefix({
        threadId: input.threadId,
        turnId: input.turnId,
        messages: prefixMessages,
        signal: input.signal,
        tools
      });
      const record = {
        key,
        prefixHash: capacity.prefixHash,
        model: this.options.model,
        warmedAt: new Date().toISOString()
      };
      this.options.cacheWarmup?.store?.set(record);
      return {
        cacheWarmupStatus: "warmed",
        cacheWarmupKey: key,
        cacheWarmupUpdatedAt: record.warmedAt
      };
    } catch (error) {
      return {
        cacheWarmupStatus: "failed",
        cacheWarmupKey: key,
        cacheWarmupMessage: messageFromError(error)
      };
    }
  }
}

function cacheWarmupKey(model: string | undefined, prefixHash: string) {
  return `${model ?? "unknown"}:${prefixHash}`;
}

function maxInlineCharsForTool(
  toolName: string,
  artifactOptions: NonNullable<AgentEngineOptions["artifacts"]>
) {
  const explicit = artifactOptions.largeOutputThresholds?.[toolName];
  if (explicit !== undefined) {
    return Math.max(0, explicit);
  }

  if (isSearchLikeTool(toolName)) {
    return Math.max(0, artifactOptions.maxInlineChars ?? DEFAULT_SEARCH_ARTIFACT_THRESHOLD_CHARS);
  }

  if (isWebOrDiffTool(toolName)) {
    return Math.max(0, artifactOptions.maxInlineChars ?? DEFAULT_WEB_DIFF_ARTIFACT_THRESHOLD_CHARS);
  }

  return Math.max(0, artifactOptions.maxInlineChars ?? DEFAULT_ARTIFACT_MAX_INLINE_CHARS);
}

function shellLogFromOutput(output: unknown): { stdout: string; stderr: string } | undefined {
  if (typeof output !== "object" || output === null) {
    return undefined;
  }

  const record = output as Record<string, unknown>;
  const stdout = typeof record.stdout === "string" ? record.stdout : "";
  const stderr = typeof record.stderr === "string" ? record.stderr : "";
  if (!stdout && !stderr) {
    return undefined;
  }

  return { stdout, stderr };
}

type LargeToolOutput = {
  artifactType: ArtifactMetadata["type"];
  content: string;
  inlineOutput(output: Record<string, unknown>, artifactSummary: string): Record<string, unknown>;
};

function largeOutputFromToolResult(toolName: string, output: unknown): LargeToolOutput | undefined {
  if (typeof output !== "object" || output === null) {
    return undefined;
  }

  const record = output as Record<string, unknown>;

  if (Array.isArray(record.matches)) {
    const content = JSON.stringify(record, null, 2);
    return {
      artifactType: "text",
      content,
      inlineOutput(raw) {
        const matches = Array.isArray(raw.matches) ? raw.matches : [];
        return {
          querySummary: {
            matchCount: matches.length,
            truncated: raw.truncated
          },
          matchesPreview: matches.slice(0, 3).map(previewRecord),
          contentMovedToArtifact: true
        };
      }
    };
  }

  if (Array.isArray(record.results) && Array.isArray(record.citations)) {
    const content = JSON.stringify(record, null, 2);
    return {
      artifactType: "text",
      content,
      inlineOutput(raw) {
        const results = Array.isArray(raw.results) ? raw.results : [];
        return {
          query: raw.query,
          source: raw.source,
          resultCount: results.length,
          resultsPreview: results.slice(0, 3).map(previewRecord),
          citations: raw.citations,
          contentMovedToArtifact: true
        };
      }
    };
  }

  if (typeof record.text === "string" && ("url" in record || "finalUrl" in record || "citation" in record)) {
    return {
      artifactType: "text",
      content: record.text,
      inlineOutput(raw, artifactSummary) {
        return {
          url: raw.url,
          finalUrl: raw.finalUrl,
          status: raw.status,
          ok: raw.ok,
          contentType: raw.contentType,
          title: raw.title,
          citation: raw.citation,
          text: "[text moved to artifact]",
          textPreview: tailText(String(raw.text ?? ""), DEFAULT_ARTIFACT_INLINE_TAIL_CHARS),
          textTruncated: true,
          artifactSummary
        };
      }
    };
  }

  if (typeof record.diff === "string") {
    return textFieldLargeOutput("diff", "diff", record.diff);
  }

  if (typeof record.output === "string" && (toolName.startsWith("git_") || "isRepo" in record)) {
    return textFieldLargeOutput("diff", "output", record.output);
  }

  return undefined;
}

function textFieldLargeOutput(
  artifactType: ArtifactMetadata["type"],
  field: "diff" | "output",
  content: string
): LargeToolOutput {
  return {
    artifactType,
    content,
    inlineOutput(raw, artifactSummary) {
      return {
        ...withoutKeys(raw, [field]),
        [field]: `[${field} moved to artifact]`,
        [`${field}Preview`]: tailText(String(raw[field] ?? ""), DEFAULT_ARTIFACT_INLINE_TAIL_CHARS),
        [`${field}Truncated`]: true,
        artifactSummary
      };
    }
  };
}

function previewRecord(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return value;
  }

  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [
    key,
    typeof item === "string" ? oneLine(item, 240) : item
  ]));
}

function withoutKeys(record: Record<string, unknown>, keys: string[]) {
  const next = { ...record };
  for (const key of keys) {
    delete next[key];
  }
  return next;
}

function oneLine(value: string, maxChars: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, Math.max(0, maxChars - 3))}...`;
}

function isSearchLikeTool(toolName: string) {
  return toolName === "grep_files" || toolName === "file_search" || toolName === "web_search";
}

function isWebOrDiffTool(toolName: string) {
  return toolName === "fetch_url" ||
    toolName === "git_diff" ||
    toolName === "git_show" ||
    toolName === "git_log" ||
    toolName === "git_blame";
}

function formatShellLogArtifact(shellLog: { stdout: string; stderr: string }) {
  return [`stdout\n${shellLog.stdout}`, `stderr\n${shellLog.stderr}`].join("\n\n");
}

function mcpContentFromOutput(output: unknown): { kind: "string" | "json"; text: string } | undefined {
  if (typeof output !== "object" || output === null) {
    return undefined;
  }

  const record = output as Record<string, unknown>;
  if (typeof record.server !== "string" || typeof record.tool !== "string" || !("content" in record)) {
    return undefined;
  }

  if (typeof record.content === "string") {
    return { kind: "string", text: record.content };
  }

  return { kind: "json", text: JSON.stringify(record.content, null, 2) };
}

function tailText(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }

  return value.slice(value.length - maxChars);
}

function estimateUsage(
  provider: string | undefined,
  model: string | undefined,
  messages: LlmMessage[],
  assistantText: string,
  tools?: LlmToolDefinition[]
) {
  const promptTokens = estimateInputTokens(messages, tools);
  const completionTokens = estimateTokensFromChars(assistantText.length);
  const usage = {
    provider,
    model,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    cachedTokens: 0,
    cacheHitTokens: 0,
    cacheMissTokens: promptTokens,
    cacheHitRatio: 0,
    estimated: true
  };
  const cost = estimateUsageCostDetails(model, usage);
  return {
    ...usage,
    costUsd: cost?.totalUsd,
    costCny: cost?.totalCny,
    cacheHitInputCostUsd: cost?.cacheHitInputUsd,
    cacheMissInputCostUsd: cost?.cacheMissInputUsd,
    outputCostUsd: cost?.outputUsd,
    cacheHitInputCostCny: cost?.cacheHitInputCny,
    cacheMissInputCostCny: cost?.cacheMissInputCny,
    outputCostCny: cost?.outputCny
  };
}

function usageFromToolOutput(output: unknown): ModelUsage | undefined {
  if (!output || typeof output !== "object") {
    return undefined;
  }

  const usage = (output as Record<string, unknown>).usage;
  if (!usage || typeof usage !== "object") {
    return undefined;
  }

  const record = usage as Record<string, unknown>;
  if (
    typeof record.promptTokens !== "number" ||
    typeof record.completionTokens !== "number" ||
    typeof record.totalTokens !== "number"
  ) {
    return undefined;
  }

  return {
    provider: typeof record.provider === "string" ? record.provider : undefined,
    model: typeof record.model === "string" ? record.model : undefined,
    promptTokens: record.promptTokens,
    completionTokens: record.completionTokens,
    totalTokens: record.totalTokens,
    cachedTokens: typeof record.cachedTokens === "number" ? record.cachedTokens : undefined,
    cacheHitTokens: typeof record.cacheHitTokens === "number" ? record.cacheHitTokens : undefined,
    cacheMissTokens: typeof record.cacheMissTokens === "number" ? record.cacheMissTokens : undefined,
    cacheHitRatio: typeof record.cacheHitRatio === "number" ? record.cacheHitRatio : undefined,
    reasoningTokens: typeof record.reasoningTokens === "number" ? record.reasoningTokens : undefined,
    estimated: typeof record.estimated === "boolean" ? record.estimated : undefined,
    costUsd: typeof record.costUsd === "number" ? record.costUsd : undefined,
    costCny: typeof record.costCny === "number" ? record.costCny : undefined,
    cacheHitInputCostUsd: typeof record.cacheHitInputCostUsd === "number" ? record.cacheHitInputCostUsd : undefined,
    cacheMissInputCostUsd: typeof record.cacheMissInputCostUsd === "number" ? record.cacheMissInputCostUsd : undefined,
    outputCostUsd: typeof record.outputCostUsd === "number" ? record.outputCostUsd : undefined,
    cacheHitInputCostCny: typeof record.cacheHitInputCostCny === "number" ? record.cacheHitInputCostCny : undefined,
    cacheMissInputCostCny: typeof record.cacheMissInputCostCny === "number" ? record.cacheMissInputCostCny : undefined,
    outputCostCny: typeof record.outputCostCny === "number" ? record.outputCostCny : undefined
  };
}

function messageFromError(error: unknown): string {
  if (isAbortError(error)) {
    return "已停止当前任务。";
  }

  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return;
  }

  throw new DOMException("已停止当前任务。", "AbortError");
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}
