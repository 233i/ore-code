import { describe, expect, it } from "vitest";
import { buildCachePrefixReport, buildCapacityReport, estimateInputTokens, estimateUsageCostDetails } from "./capacity";
import type { LlmMessage, LlmToolDefinition } from "./llm";

const tools: LlmToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "grep_files",
      description: "Search files.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          path: { type: "string" }
        }
      }
    }
  }
];

describe("capacity", () => {
  it("uses DeepSeek V4 model metadata for input budgets", () => {
    const report = buildCapacityReport({
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "hi" }]
    });

    expect(report).toMatchObject({
      model: "deepseek-v4-pro",
      contextWindow: 1_000_000,
      maxOutputTokens: 65_536,
      safetyHeadroomTokens: 4_096,
      maxInputTokens: 930_368,
      status: "ok",
      seamLevel: "ok"
    });
    expect(report.prefixHash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("allows explicit maxInputTokens to override the model budget", () => {
    const report = buildCapacityReport(
      {
        model: "deepseek-v4-pro",
        messages: [{ role: "user", content: "x".repeat(5_000) }]
      },
      { maxInputTokens: 100 }
    );

    expect(report.maxInputTokens).toBe(100);
    expect(report.status).toBe("critical");
  });

  it("counts reasoning, tool calls, tool results, and tool schemas", () => {
    const baseMessages: LlmMessage[] = [{ role: "user", content: "inspect" }];
    const richMessages: LlmMessage[] = [
      ...baseMessages,
      {
        role: "assistant",
        content: "I will inspect.",
        reasoningContent: "Need the target files first.",
        toolCalls: [{ id: "call-1", name: "grep_files", input: { pattern: "DeepSeek", path: "." } }]
      },
      {
        role: "tool",
        toolCallId: "call-1",
        content: JSON.stringify({ callId: "call-1", ok: true, output: { matches: [{ path: "a.ts", line: "DeepSeek" }] } })
      }
    ];

    expect(estimateInputTokens(richMessages, tools)).toBeGreaterThan(estimateInputTokens(baseMessages));
    expect(estimateInputTokens(richMessages, tools)).toBeGreaterThan(estimateInputTokens(richMessages));
  });

  it("carries reasoning retention stats into capacity reports", () => {
    const report = buildCapacityReport({
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "hi" }],
      reasoningRetention: {
        enabled: true,
        model: "deepseek-v4-pro",
        recentWindowTurns: 2,
        keptMessages: 1,
        keptToolCallMessages: 1,
        keptRecentMessages: 0,
        strippedMessages: 2,
        strippedChars: 120,
        healedMessages: 1,
        healingApplied: true
      },
      checkpoint: {
        status: "applied",
        reason: "reasoning_retention",
        inputTokensBefore: 10_000,
        inputTokensAfter: 4_000,
        maxInputTokens: 930_368,
        thresholdTokens: 790_812,
        messagesBefore: 12,
        messagesAfter: 5,
        droppedMessages: 7,
        retainedMessages: 4,
        summaryChars: 800,
        cacheBreak: true,
        message: "checkpoint created"
      }
    });

    expect(report.reasoningRetention).toMatchObject({
      enabled: true,
      strippedMessages: 2,
      healingApplied: true
    });
    expect(report.checkpoint).toMatchObject({
      status: "applied",
      reason: "reasoning_retention",
      cacheBreak: true
    });
  });

  it("breaks prefix cache hashes into stable prompt layers", () => {
    const baseMessages: LlmMessage[] = [
      { role: "system", content: "static system" },
      { role: "system", content: "<project_context>/repo</project_context>" },
      { role: "user", content: "old question" },
      { role: "assistant", content: "old answer" },
      { role: "user", content: "current request" }
    ];
    const first = buildCachePrefixReport(baseMessages, tools);
    const samePrefix = buildCachePrefixReport([
      ...baseMessages.slice(0, -1),
      { role: "user", content: "different current request" }
    ], [...tools].reverse());
    const changedProject = buildCachePrefixReport([
      { role: "system", content: "static system" },
      { role: "system", content: "<project_context>/other</project_context>" },
      ...baseMessages.slice(2)
    ], tools);

    expect(first.prefixHash).toBe(samePrefix.prefixHash);
    expect(first.promptHash).not.toBe(samePrefix.promptHash);
    expect(first.prefixHash).not.toBe(changedProject.prefixHash);
    expect(first.layers.map((layer) => layer.name)).toEqual([
      "core_prefix",
      "tool_prefix",
      "project_snapshot",
      "conversation_ledger",
      "dynamic_tail"
    ]);
    expect(first.layers.find((layer) => layer.name === "tool_prefix")?.cacheStable).toBe(true);
    expect(first.layers.find((layer) => layer.name === "dynamic_tail")?.includedInPrefix).toBe(false);
  });

  it("assigns DeepSeek seam levels at fixed large-context thresholds", () => {
    expect(buildCapacityReport({
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "x".repeat(470_000) }]
    }).seamLevel).toBe("l1");
    expect(buildCapacityReport({
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "x".repeat(940_000) }]
    }).seamLevel).toBe("l2");
    expect(buildCapacityReport({
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "x".repeat(1_410_000) }]
    }).seamLevel).toBe("l3");
    expect(buildCapacityReport({
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "x".repeat(1_880_000) }]
    }).seamLevel).toBe("cycle");
  });

  it("breaks DeepSeek costs into cache hit, cache miss, output, USD, and CNY", () => {
    const cost = estimateUsageCostDetails("deepseek-v4-pro", {
      model: "deepseek-v4-pro",
      promptTokens: 1_000,
      completionTokens: 2_000,
      totalTokens: 3_000,
      cachedTokens: 400
    });

    expect(cost).toMatchObject({
      totalUsd: 0.00239,
      totalCny: 0.017208,
      cacheHitInputUsd: 0.000028,
      cacheMissInputUsd: 0.000162,
      outputUsd: 0.0022,
      cachedTokens: 400,
      uncachedPromptTokens: 600
    });
  });

  it("supports configurable official discount multipliers and CNY rates", () => {
    const cost = estimateUsageCostDetails("deepseek-v4-flash", {
      model: "deepseek-v4-flash",
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
      totalTokens: 2_000_000,
      cachedTokens: 500_000
    }, {
      cacheHitInputMultiplier: 0.5,
      cacheMissInputMultiplier: 0.5,
      outputMultiplier: 0.5,
      cnyPerUsd: 7
    });

    expect(cost).toMatchObject({
      cacheHitInputUsd: 0.0035,
      cacheMissInputUsd: 0.0175,
      outputUsd: 0.14,
      totalUsd: 0.161,
      totalCny: 1.127
    });
  });
});
