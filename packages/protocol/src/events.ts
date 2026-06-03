import { z } from "zod";
import { ApprovalDecisionSchema, ToolCallSchema, ToolResultSchema } from "./tools";

const BaseEventSchema = z.object({
  id: z.string().min(1),
  seq: z.number().int().nonnegative(),
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  createdAt: z.string().datetime({ offset: true })
});

const ModelLedgerMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string(),
  reasoningContent: z.string().optional(),
  toolCallId: z.string().optional(),
  toolCalls: ToolCallSchema.array().optional()
});

export const InteractionOptionSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  value: z.string().optional()
});
export type InteractionOption = z.infer<typeof InteractionOptionSchema>;

export const InteractionDecisionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("option"),
    optionId: z.string().trim().min(1),
    value: z.string().optional()
  }),
  z.object({
    type: z.literal("custom"),
    customText: z.string().trim().min(1)
  })
]);
export type InteractionDecision = z.infer<typeof InteractionDecisionSchema>;

export const RuntimeEventSchema = z.discriminatedUnion("type", [
  BaseEventSchema.extend({
    type: z.literal("user_message"),
    text: z.string()
  }),
  BaseEventSchema.extend({
    type: z.literal("assistant_delta"),
    text: z.string()
  }),
  BaseEventSchema.extend({
    type: z.literal("assistant_message"),
    text: z.string()
  }),
  BaseEventSchema.extend({
    type: z.literal("reasoning_delta"),
    text: z.string()
  }),
  BaseEventSchema.extend({
    type: z.literal("tool_call_requested"),
    call: ToolCallSchema
  }),
  BaseEventSchema.extend({
    type: z.literal("approval_requested"),
    call: ToolCallSchema
  }),
  BaseEventSchema.extend({
    type: z.literal("approval_decided"),
    decision: ApprovalDecisionSchema
  }),
  BaseEventSchema.extend({
    type: z.literal("interaction_requested"),
    requestId: z.string().min(1),
    title: z.string().trim().min(1),
    message: z.string().trim().min(1),
    options: InteractionOptionSchema.array().min(1),
    recommendedOptionId: z.string().trim().min(1).optional()
  }),
  BaseEventSchema.extend({
    type: z.literal("interaction_decided"),
    requestId: z.string().min(1),
    decision: InteractionDecisionSchema
  }),
  BaseEventSchema.extend({
    type: z.literal("tool_started"),
    call: ToolCallSchema
  }),
  BaseEventSchema.extend({
    type: z.literal("tool_completed"),
    result: ToolResultSchema
  }),
  BaseEventSchema.extend({
    type: z.literal("tool_failed"),
    result: ToolResultSchema
  }),
  BaseEventSchema.extend({
    type: z.literal("file_changed"),
    path: z.string().min(1),
    changeKind: z.enum(["created", "updated", "deleted"]),
    snapshotId: z.string().min(1).optional(),
    existedBefore: z.boolean().optional(),
    beforeContent: z.string().optional(),
    afterContent: z.string().optional(),
    additions: z.number().int().nonnegative().optional(),
    deletions: z.number().int().nonnegative().optional(),
    diff: z.string().optional(),
    undoable: z.boolean().optional()
  }),
  BaseEventSchema.extend({
    type: z.literal("project_delta"),
    summary: z.string().min(1),
    readPaths: z.string().min(1).array(),
    changedFiles: z.object({
      path: z.string().min(1),
      changeKind: z.enum(["created", "updated", "deleted"]),
      additions: z.number().int().nonnegative().optional(),
      deletions: z.number().int().nonnegative().optional(),
      snapshotId: z.string().min(1).optional()
    }).array(),
    testResults: z.object({
      toolName: z.string().min(1),
      command: z.string().min(1).optional(),
      ok: z.boolean(),
      exitCode: z.number().int().optional(),
      timedOut: z.boolean().optional(),
      artifactId: z.string().min(1).optional(),
      summary: z.string().min(1).optional()
    }).array(),
    errors: z.object({
      source: z.enum(["tool", "turn"]),
      toolName: z.string().min(1).optional(),
      message: z.string().min(1),
      path: z.string().min(1).optional()
    }).array(),
    artifacts: z.object({
      artifactId: z.string().min(1),
      sourceCallId: z.string().min(1).optional(),
      summary: z.string().min(1).optional(),
      type: z.string().min(1).optional(),
      size: z.number().int().nonnegative().optional()
    }).array(),
    pinnedContexts: z.object({
      kind: z.enum(["path", "instruction"]),
      value: z.string().min(1),
      sourceTurnId: z.string().min(1),
      lastMentionedTurnId: z.string().min(1).optional(),
      reason: z.string().min(1).optional()
    }).array().default([]),
    workingSetPaths: z.string().min(1).array()
  }),
  BaseEventSchema.extend({
    type: z.literal("snapshot_restored"),
    snapshotId: z.string().min(1),
    paths: z.string().min(1).array(),
    scope: z.enum(["file", "turn"]),
    ok: z.boolean(),
    failures: z.string().array().optional()
  }),
  BaseEventSchema.extend({
    type: z.literal("turn_snapshot"),
    snapshotId: z.string().min(1),
    sideSnapshotId: z.string().min(1).optional(),
    sidePostSnapshotId: z.string().min(1).optional(),
    sideGitCommit: z.string().min(1).optional(),
    sidePostGitCommit: z.string().min(1).optional(),
    sideGitBranch: z.string().min(1).optional(),
    fileCount: z.number().int().nonnegative()
  }),
  BaseEventSchema.extend({
    type: z.literal("context_capacity"),
    provider: z.string().optional(),
    model: z.string().optional(),
    contextWindow: z.number().int().positive().optional(),
    estimatedInputTokens: z.number().int().nonnegative(),
    maxInputTokens: z.number().int().nonnegative(),
    maxOutputTokens: z.number().int().nonnegative().optional(),
    safetyHeadroomTokens: z.number().int().nonnegative().optional(),
    reasoningReplayTokens: z.number().int().nonnegative().optional(),
    reasoningRetention: z.object({
      enabled: z.boolean(),
      model: z.string().optional(),
      recentWindowTurns: z.number().int().nonnegative(),
      keptMessages: z.number().int().nonnegative(),
      keptToolCallMessages: z.number().int().nonnegative(),
      keptRecentMessages: z.number().int().nonnegative(),
      strippedMessages: z.number().int().nonnegative(),
      strippedChars: z.number().int().nonnegative(),
      healedMessages: z.number().int().nonnegative(),
      healingApplied: z.boolean()
    }).optional(),
    checkpoint: z.object({
      status: z.enum(["none", "candidate", "applied"]),
      reason: z.enum(["capacity", "reasoning_retention", "manual", "restore", "provider_limit"]).optional(),
      inputTokensBefore: z.number().int().nonnegative(),
      inputTokensAfter: z.number().int().nonnegative().optional(),
      maxInputTokens: z.number().int().nonnegative(),
      thresholdTokens: z.number().int().nonnegative(),
      messagesBefore: z.number().int().nonnegative(),
      messagesAfter: z.number().int().nonnegative().optional(),
      droppedMessages: z.number().int().nonnegative().optional(),
      retainedMessages: z.number().int().nonnegative().optional(),
      summaryChars: z.number().int().nonnegative().optional(),
      cacheBreak: z.boolean(),
      message: z.string().min(1)
    }).optional(),
    briefing: z.object({
      status: z.enum(["none", "applied"]),
      reason: z.enum(["cycle", "hard"]).optional(),
      inputTokensBefore: z.number().int().nonnegative(),
      inputTokensAfter: z.number().int().nonnegative().optional(),
      maxInputTokens: z.number().int().nonnegative(),
      thresholdTokens: z.number().int().nonnegative(),
      messagesBefore: z.number().int().nonnegative(),
      messagesAfter: z.number().int().nonnegative().optional(),
      foldedMessages: z.number().int().nonnegative().optional(),
      retainedMessages: z.number().int().nonnegative().optional(),
      briefingChars: z.number().int().nonnegative().optional(),
      cacheBreak: z.boolean(),
      message: z.string().min(1)
    }).optional(),
    prefixHash: z.string().min(1).optional(),
    cachePrefix: z.object({
      prefixHash: z.string().min(1),
      promptHash: z.string().min(1),
      cacheablePrefixTokens: z.number().int().nonnegative(),
      dynamicTokens: z.number().int().nonnegative(),
      layers: z.object({
        name: z.enum(["core_prefix", "tool_prefix", "project_snapshot", "conversation_ledger", "dynamic_tail"]),
        label: z.string().min(1),
        hash: z.string().min(1),
        chars: z.number().int().nonnegative(),
        tokens: z.number().int().nonnegative(),
        includedInPrefix: z.boolean(),
        cacheStable: z.boolean()
      }).array()
    }).optional(),
    cacheWarmupStatus: z.enum(["disabled", "unsupported", "hit", "warmed", "failed"]).optional(),
    cacheWarmupMessage: z.string().optional(),
    cacheWarmupKey: z.string().min(1).optional(),
    cacheWarmupUpdatedAt: z.string().datetime({ offset: true }).optional(),
    seamLevel: z.enum(["ok", "l1", "l2", "l3", "cycle", "hard"]).optional(),
    seamThresholdTokens: z.number().int().nonnegative().optional(),
    hardLimitTokens: z.number().int().nonnegative().optional(),
    seamMessage: z.string().optional(),
    shouldCompressToolOutputs: z.boolean().optional(),
    shouldCompressHistory: z.boolean().optional(),
    shouldGenerateBriefing: z.boolean().optional(),
    utilization: z.number().nonnegative(),
    status: z.enum(["ok", "warning", "critical"]),
    truncated: z.boolean(),
    omittedMessages: z.number().int().nonnegative(),
    compressed: z.boolean().optional(),
    summaryTokens: z.number().int().nonnegative().optional()
  }),
  BaseEventSchema.extend({
    type: z.literal("context_checkpoint"),
    checkpointId: z.string().min(1),
    reason: z.enum(["capacity", "reasoning_retention", "manual", "restore", "provider_limit"]),
    inputTokensBefore: z.number().int().nonnegative(),
    inputTokensAfter: z.number().int().nonnegative(),
    maxInputTokens: z.number().int().nonnegative(),
    thresholdTokens: z.number().int().nonnegative(),
    messagesBefore: z.number().int().nonnegative(),
    messagesAfter: z.number().int().nonnegative(),
    droppedMessages: z.number().int().nonnegative(),
    retainedMessages: z.number().int().nonnegative(),
    summaryChars: z.number().int().nonnegative(),
    cacheBreak: z.boolean(),
    message: z.string().min(1),
    checkpointMessages: ModelLedgerMessageSchema.array().min(1)
  }),
  BaseEventSchema.extend({
    type: z.literal("lazy_context_loaded"),
    source: z.enum(["skill", "memory", "mcp_resource", "mcp_prompt"]),
    sourceId: z.string().min(1),
    title: z.string().min(1),
    summary: z.string().min(1),
    content: z.string().optional(),
    contentChars: z.number().int().nonnegative(),
    tokenEstimate: z.number().int().nonnegative().optional()
  }),
  BaseEventSchema.extend({
    type: z.literal("prefix_invalidated"),
    reason: z.enum([
      "new_session",
      "workspace_changed",
      "provider_changed",
      "model_changed",
      "mode_changed",
      "system_prompt_changed",
      "project_snapshot_changed",
      "unknown"
    ]),
    previousFingerprint: z.string().min(1).optional(),
    nextFingerprint: z.string().min(1),
    coreHash: z.string().min(1),
    projectHash: z.string().min(1),
    toolHash: z.string().min(1),
    message: z.string().min(1)
  }),
  BaseEventSchema.extend({
    type: z.literal("codebase_context"),
    status: z.enum(["hit", "miss", "skipped"]),
    fileCount: z.number().int().nonnegative(),
    paths: z.string().array(),
    semanticIndexSource: z.enum(["cache", "fresh", "none"]).optional(),
    semanticIndexDocumentCount: z.number().int().nonnegative().optional(),
    message: z.string().min(1)
  }),
  BaseEventSchema.extend({
    type: z.literal("loop_guard"),
    level: z.enum(["warning", "blocked"]),
    toolName: z.string().min(1),
    message: z.string().min(1),
    callHash: z.string().min(1).optional(),
    failureCount: z.number().int().nonnegative().optional()
  }),
  BaseEventSchema.extend({
    type: z.literal("coherence_state"),
    state: z.enum(["healthy", "getting_crowded", "refreshing_context", "verifying_recent_work", "resetting_plan"]),
    riskBand: z.enum(["low", "medium", "high"]).optional(),
    recommendedAction: z.enum([
      "none",
      "targeted_context_refresh",
      "verify_with_tool_replay",
      "verify_and_replan"
    ]),
    message: z.string().min(1)
  }),
  BaseEventSchema.extend({
    type: z.literal("subagent_completed"),
    agentId: z.string().min(1),
    name: z.string().min(1),
    role: z.enum(["general", "explorer", "worker", "reviewer"]).optional(),
    model: z.string().min(1).optional(),
    status: z.enum(["completed", "failed", "canceled"]),
    summary: z.string(),
    error: z.string().min(1).optional(),
    eventCount: z.number().int().nonnegative()
  }),
  BaseEventSchema.extend({
    type: z.literal("token_usage"),
    provider: z.string().optional(),
    model: z.string().optional(),
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    cachedTokens: z.number().int().nonnegative().optional(),
    cacheHitTokens: z.number().int().nonnegative().optional(),
    cacheMissTokens: z.number().int().nonnegative().optional(),
    cacheHitRatio: z.number().nonnegative().optional(),
    reasoningTokens: z.number().int().nonnegative().optional(),
    estimated: z.boolean().optional(),
    costUsd: z.number().nonnegative().optional(),
    costCny: z.number().nonnegative().optional(),
    cacheHitInputCostUsd: z.number().nonnegative().optional(),
    cacheMissInputCostUsd: z.number().nonnegative().optional(),
    outputCostUsd: z.number().nonnegative().optional(),
    cacheHitInputCostCny: z.number().nonnegative().optional(),
    cacheMissInputCostCny: z.number().nonnegative().optional(),
    outputCostCny: z.number().nonnegative().optional()
  }),
  BaseEventSchema.extend({
    type: z.literal("command_output_delta"),
    callId: z.string().min(1),
    stream: z.enum(["stdout", "stderr"]),
    text: z.string()
  }),
  BaseEventSchema.extend({
    type: z.literal("turn_completed")
  }),
  BaseEventSchema.extend({
    type: z.literal("turn_failed"),
    message: z.string().min(1)
  })
]);

export type RuntimeEvent = z.infer<typeof RuntimeEventSchema>;

export function parseRuntimeEvent(value: unknown): RuntimeEvent {
  return RuntimeEventSchema.parse(value);
}
