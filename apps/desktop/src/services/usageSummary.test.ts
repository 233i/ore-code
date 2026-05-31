import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "@seekforge/protocol";
import { deriveUsageSummary, formatCapacityStatus } from "./usageSummary";

describe("deriveUsageSummary", () => {
  it("keeps capacity, cache, reasoning, and cumulative token totals separate", () => {
    const events: RuntimeEvent[] = [
      event({
        type: "context_capacity",
        model: "deepseek-v4-pro",
        contextWindow: 1_000_000,
        estimatedInputTokens: 10_000,
        maxInputTokens: 930_368,
        maxOutputTokens: 65_536,
        safetyHeadroomTokens: 4_096,
        reasoningReplayTokens: 42,
        prefixHash: "abcdef12",
        cachePrefix: cachePrefix("abcdef12", {
          core_prefix: "core-1",
          tool_prefix: "tools-1",
          project_snapshot: "project-1",
          conversation_ledger: "ledger-1",
          dynamic_tail: "user-1"
        }),
        seamLevel: "l2",
        seamMessage: "自动压缩大型工具输出",
        shouldCompressToolOutputs: true,
        shouldCompressHistory: false,
        shouldGenerateBriefing: false,
        utilization: 0.0107,
        status: "warning",
        truncated: false,
        omittedMessages: 0,
        compressed: false,
        summaryTokens: 0
      }),
      event({
        type: "context_capacity",
        model: "deepseek-v4-pro",
        contextWindow: 1_000_000,
        estimatedInputTokens: 10_200,
        maxInputTokens: 930_368,
        maxOutputTokens: 65_536,
        safetyHeadroomTokens: 4_096,
        reasoningReplayTokens: 42,
        reasoningRetention: {
          enabled: true,
          model: "deepseek-v4-pro",
          recentWindowTurns: 2,
          keptMessages: 2,
          keptToolCallMessages: 1,
          keptRecentMessages: 1,
          strippedMessages: 3,
          strippedChars: 240,
          healedMessages: 1,
          healingApplied: true
        },
        checkpoint: {
          status: "applied",
          reason: "reasoning_retention",
          inputTokensBefore: 16_000,
          inputTokensAfter: 7_200,
          maxInputTokens: 930_368,
          thresholdTokens: 790_812,
          messagesBefore: 20,
          messagesAfter: 9,
          droppedMessages: 11,
          retainedMessages: 8,
          summaryChars: 1_200,
          cacheBreak: true,
          message: "已创建 Context Checkpoint，清理旧 reasoning 基线。"
        },
        prefixHash: "fedcba98",
        cachePrefix: cachePrefix("fedcba98", {
          core_prefix: "core-1",
          tool_prefix: "tools-1",
          project_snapshot: "project-2",
          conversation_ledger: "ledger-2",
          dynamic_tail: "user-2"
        }),
        seamLevel: "l2",
        seamMessage: "自动压缩大型工具输出",
        shouldCompressToolOutputs: true,
        shouldCompressHistory: false,
        shouldGenerateBriefing: false,
        utilization: 0.011,
        status: "warning",
        truncated: false,
        omittedMessages: 0,
        compressed: false,
        summaryTokens: 0
      }),
      event({
        type: "codebase_context",
        status: "hit",
        fileCount: 3,
        paths: ["src/App.tsx", "src/hooks/useAgentRunner.ts", "src/services/projectIndex.ts"],
        semanticIndexSource: "cache",
        semanticIndexDocumentCount: 31,
        message: "已参考 3 个相关文件。"
      }),
      event({
        type: "project_delta",
        summary: "1 changed file(s), 1 inspected path(s)",
        readPaths: ["src/App.tsx"],
        changedFiles: [{ path: "src/App.tsx", changeKind: "updated", additions: 1, deletions: 0 }],
        testResults: [],
        errors: [],
        artifacts: [],
        workingSetPaths: ["src/App.tsx"]
      }),
      event({
        type: "lazy_context_loaded",
        source: "skill",
        sourceId: "reviewer",
        title: "Skill /reviewer",
        summary: "Review current changes",
        content: "# Reviewer\nCheck bugs.",
        contentChars: 22,
        tokenEstimate: 12
      }),
      event({
        type: "lazy_context_loaded",
        source: "mcp_resource",
        sourceId: "demo:file://readme",
        title: "MCP resource file://readme",
        summary: "Readme loaded through tool result",
        contentChars: 0,
        tokenEstimate: 0
      }),
      event({
        type: "token_usage",
        model: "deepseek-v4-pro",
        promptTokens: 1_000,
        completionTokens: 200,
        totalTokens: 1_200,
        cachedTokens: 300,
        cacheHitTokens: 300,
        cacheMissTokens: 700,
        cacheHitRatio: 0.3,
        reasoningTokens: 120,
        costUsd: 0.001,
        costCny: 0.0072,
        cacheHitInputCostUsd: 0.00002,
        cacheMissInputCostUsd: 0.0002,
        outputCostUsd: 0.00078,
        cacheHitInputCostCny: 0.000144,
        cacheMissInputCostCny: 0.00144,
        outputCostCny: 0.005616
      }),
      event({
        type: "token_usage",
        model: "deepseek-v4-flash",
        promptTokens: 500,
        completionTokens: 100,
        totalTokens: 600,
        cachedTokens: 100,
        cacheHitTokens: 100,
        cacheMissTokens: 400,
        cacheHitRatio: 0.2,
        reasoningTokens: 20,
        estimated: true,
        costUsd: 0.0001,
        costCny: 0.00072,
        cacheHitInputCostUsd: 0.000005,
        cacheMissInputCostUsd: 0.00002,
        outputCostUsd: 0.000075,
        cacheHitInputCostCny: 0.000036,
        cacheMissInputCostCny: 0.000144,
        outputCostCny: 0.00054
      })
    ];

    const summary = deriveUsageSummary(events);

    expect(summary.totalTokens).toBe(1_800);
    expect(summary.cachedTokens).toBe(400);
    expect(summary.cacheMissTokens).toBe(1_100);
    expect(summary.cacheHitRatio).toBeCloseTo(400 / 1_500);
    expect(summary.reasoningTokens).toBe(140);
    expect(summary.costCny).toBe(0.00792);
    expect(summary.cacheHitInputCostCny).toBe(0.00018);
    expect(summary.cacheMissInputCostCny).toBe(0.001584);
    expect(summary.outputCostCny).toBe(0.006156);
    expect(summary.providerCostUsd).toBe(0.001);
    expect(summary.estimatedCostUsd).toBe(0.0001);
    expect(summary.byModel).toMatchObject([
      {
        model: "deepseek-v4-pro",
        promptTokens: 1_000,
        cachedTokens: 300,
        cacheMissTokens: 700,
        completionTokens: 200,
        reasoningTokens: 120,
        totalTokens: 1_200,
        costUsd: 0.001,
        costCny: 0.0072,
        providerCostUsd: 0.001,
        estimatedCostUsd: 0
      },
      {
        model: "deepseek-v4-flash",
        promptTokens: 500,
        cachedTokens: 100,
        cacheMissTokens: 400,
        completionTokens: 100,
        reasoningTokens: 20,
        totalTokens: 600,
        costUsd: 0.0001,
        costCny: 0.00072,
        providerCostUsd: 0,
        estimatedCostUsd: 0.0001
      }
    ]);
    expect(summary.turns).toMatchObject([
      {
        turnId: "turn-1",
        totalTokens: 1_800,
        costUsd: 0.0011,
        providerCostUsd: 0.001,
        estimatedCostUsd: 0.0001
      }
    ]);
    expect(summary.capacity).toMatchObject({
      model: "deepseek-v4-pro",
      contextWindow: 1_000_000,
      maxOutputTokens: 65_536,
      safetyHeadroomTokens: 4_096,
      reasoningReplayTokens: 42,
      reasoningRetention: expect.objectContaining({
        enabled: true,
        strippedMessages: 3,
        healedMessages: 1
      }),
      checkpoint: expect.objectContaining({
        status: "applied",
        reason: "reasoning_retention",
        inputTokensBefore: 16_000,
        inputTokensAfter: 7_200,
        cacheBreak: true
      }),
      prefixHash: "fedcba98",
      cachePrefix: expect.objectContaining({
        prefixHash: "fedcba98"
      }),
      seamLevel: "l2",
      shouldCompressToolOutputs: true
    });
    expect(summary.cacheInspect).toMatchObject({
      prefixHash: "fedcba98",
      cachedTokens: 100,
      cacheMissTokens: 400,
      breakReason: "project_changed",
      breaksPrefix: true,
      changedPrefixLayers: ["Project Snapshot"]
    });
    expect(summary.cacheInspect?.segmentDiffs.find((diff) => diff.name === "project_snapshot")).toMatchObject({
      changed: true,
      breaksPrefix: true,
      reason: "project_changed"
    });
    expect(summary.cacheInspect?.recentRequestMetadata).toHaveLength(2);
    expect(summary.cacheInspect?.layers.find((layer) => layer.name === "dynamic_tail")).toMatchObject({
      changedSincePrevious: true,
      breaksPrefix: false
    });
    expect(summary.projectIndex).toMatchObject({
      status: "hit",
      fileCount: 3,
      semanticIndexSource: "cache",
      semanticIndexDocumentCount: 31
    });
    expect(summary.projectDelta).toMatchObject({
      summary: "1 changed file(s), 1 inspected path(s)",
      workingSetPaths: ["src/App.tsx"],
      changedFiles: [{ path: "src/App.tsx", changeKind: "updated" }]
    });
    expect(summary.lazyContext).toMatchObject({
      totalLoads: 2,
      injectedLoads: 1,
      totalChars: 22,
      sources: [
        { source: "mcp_resource", sourceId: "demo:file://readme", injected: false },
        { source: "skill", sourceId: "reviewer", injected: true }
      ]
    });
  });

  it("uses input-budget wording for warning and critical capacity states", () => {
    expect(formatCapacityStatus("warning")).toBe("接近输入预算");
    expect(formatCapacityStatus("critical")).toBe("需要压缩或减少上下文");
  });
});

function event(body: Record<string, unknown> & { type: RuntimeEvent["type"] }): RuntimeEvent {
  return {
    id: crypto.randomUUID(),
    seq: 0,
    threadId: "thread-1",
    turnId: "turn-1",
    createdAt: "2026-05-19T00:00:00.000Z",
    ...body
  } as RuntimeEvent;
}

function cachePrefix(prefixHash: string, hashes: Record<string, string>) {
  const layers = [
    ["core_prefix", "Core Prefix", true, true],
    ["tool_prefix", "Tool Prefix", true, true],
    ["project_snapshot", "Project Snapshot", true, true],
    ["conversation_ledger", "Conversation Ledger", true, false],
    ["dynamic_tail", "Dynamic Tail", false, false]
  ] as const;

  return {
    prefixHash,
    promptHash: `prompt-${prefixHash}`,
    cacheablePrefixTokens: 100,
    dynamicTokens: 40,
    layers: layers.map(([name, label, includedInPrefix, cacheStable]) => ({
      name,
      label,
      hash: hashes[name],
      chars: 10,
      tokens: 20,
      includedInPrefix,
      cacheStable
    }))
  };
}
