import { describe, expect, it } from "vitest";
import { parseRuntimeEvent } from "./events";

describe("RuntimeEventSchema interaction events", () => {
  it("accepts interaction requests and decisions", () => {
    expect(parseRuntimeEvent(base({
      type: "interaction_requested",
      requestId: "request-1",
      title: "选择项目",
      message: "请选择要操作的项目。",
      recommendedOptionId: "ore-code",
      options: [
        { id: "ore-code", label: "Ore Code", description: "当前项目", value: "/repo/Ore Code" }
      ]
    }))).toMatchObject({
      type: "interaction_requested",
      requestId: "request-1"
    });

    expect(parseRuntimeEvent(base({
      type: "interaction_decided",
      requestId: "request-1",
      decision: { type: "custom", customText: "使用 /tmp/project" }
    }))).toMatchObject({
      type: "interaction_decided",
      decision: { type: "custom" }
    });
  });

  it("accepts loop guard and coherence telemetry events", () => {
    expect(parseRuntimeEvent(base({
      type: "prefix_invalidated",
      reason: "workspace_changed",
      previousFingerprint: "prev123",
      nextFingerprint: "next123",
      coreHash: "core123",
      projectHash: "project123",
      toolHash: "tool123",
      message: "Prefix snapshot rebuilt."
    }))).toMatchObject({
      type: "prefix_invalidated",
      reason: "workspace_changed"
    });

    expect(parseRuntimeEvent(base({
      type: "codebase_context",
      status: "hit",
      fileCount: 2,
      paths: ["src/App.tsx", "src/App.test.tsx"],
      semanticIndexSource: "cache",
      semanticIndexDocumentCount: 31,
      message: "已参考 2 个相关文件。"
    }))).toMatchObject({
      type: "codebase_context",
      status: "hit",
      fileCount: 2
    });

    expect(parseRuntimeEvent(base({
      type: "project_delta",
      summary: "1 changed file(s), 1 test/check result(s)",
      readPaths: ["src/App.tsx"],
      changedFiles: [{
        path: "src/App.tsx",
        changeKind: "updated",
        additions: 2,
        deletions: 1,
        snapshotId: "snapshot-1"
      }],
      testResults: [{
        toolName: "run_tests",
        command: "pnpm test",
        ok: true,
        exitCode: 0,
        timedOut: false,
        artifactId: "artifact-1",
        summary: "passed"
      }],
      errors: [],
      artifacts: [{
        artifactId: "artifact-1",
        sourceCallId: "call-1",
        summary: "test log",
        type: "text",
        size: 120
      }],
      workingSetPaths: ["src/App.tsx"]
    }))).toMatchObject({
      type: "project_delta",
      changedFiles: [{ path: "src/App.tsx" }]
    });

    expect(parseRuntimeEvent(base({
      type: "context_capacity",
      model: "deepseek-v4-pro",
      estimatedInputTokens: 100,
      maxInputTokens: 930368,
      utilization: 0.1,
      status: "ok",
      truncated: false,
      omittedMessages: 0,
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
        messagesBefore: 24,
        messagesAfter: 9,
        droppedMessages: 15,
        retainedMessages: 8,
        summaryChars: 1_100,
        cacheBreak: true,
        message: "已创建 Context Checkpoint。"
      }
    }))).toMatchObject({
      type: "context_capacity",
      reasoningRetention: {
        enabled: true,
        strippedMessages: 2,
        healingApplied: true
      },
      checkpoint: {
        status: "applied",
        reason: "reasoning_retention",
        cacheBreak: true
      }
    });

    expect(parseRuntimeEvent(base({
      type: "context_checkpoint",
      checkpointId: "checkpoint-1",
      reason: "capacity",
      inputTokensBefore: 100_000,
      inputTokensAfter: 20_000,
      maxInputTokens: 930_368,
      thresholdTokens: 790_812,
      messagesBefore: 48,
      messagesAfter: 9,
      droppedMessages: 39,
      retainedMessages: 8,
      summaryChars: 2_000,
      cacheBreak: true,
      message: "已创建 Context Checkpoint。",
      checkpointMessages: [
        { role: "assistant", content: "[context_checkpoint]\nReason: capacity" },
        { role: "user", content: "continue" }
      ]
    }))).toMatchObject({
      type: "context_checkpoint",
      reason: "capacity",
      checkpointMessages: expect.arrayContaining([
        { role: "assistant", content: expect.stringContaining("[context_checkpoint]") }
      ])
    });

    expect(parseRuntimeEvent(base({
      type: "lazy_context_loaded",
      source: "skill",
      sourceId: "reviewer",
      title: "Skill /reviewer",
      summary: "Review current changes",
      content: "# Reviewer\nCheck bugs.",
      contentChars: 22,
      tokenEstimate: 12
    }))).toMatchObject({
      type: "lazy_context_loaded",
      source: "skill",
      sourceId: "reviewer",
      contentChars: 22
    });

    expect(parseRuntimeEvent(base({
      type: "loop_guard",
      level: "warning",
      toolName: "exec_shell",
      message: "retry warning",
      callHash: "abc123",
      failureCount: 3
    }))).toMatchObject({
      type: "loop_guard",
      level: "warning"
    });

    expect(parseRuntimeEvent(base({
      type: "coherence_state",
      state: "getting_crowded",
      riskBand: "medium",
      recommendedAction: "targeted_context_refresh",
      message: "context pressure"
    }))).toMatchObject({
      type: "coherence_state",
      recommendedAction: "targeted_context_refresh"
    });

    expect(parseRuntimeEvent(base({
      type: "subagent_completed",
      agentId: "agent-1",
      name: "auth review",
      role: "reviewer",
      model: "deepseek-v4-flash",
      status: "completed",
      summary: "SUMMARY\nChecked auth flow.",
      eventCount: 12
    }))).toMatchObject({
      type: "subagent_completed",
      role: "reviewer",
      model: "deepseek-v4-flash",
      status: "completed"
    });
  });

  it("rejects empty options and empty custom decisions", () => {
    expect(() => parseRuntimeEvent(base({
      type: "interaction_requested",
      requestId: "request-1",
      title: "选择项目",
      message: "请选择要操作的项目。",
      options: []
    }))).toThrow();

    expect(() => parseRuntimeEvent(base({
      type: "interaction_decided",
      requestId: "request-1",
      decision: { type: "custom", customText: "" }
    }))).toThrow();
  });
});

function base(body: Record<string, unknown>) {
  return {
    id: "event-1",
    seq: 0,
    threadId: "thread-1",
    turnId: "turn-1",
    createdAt: "2026-05-19T00:00:00.000Z",
    ...body
  };
}
