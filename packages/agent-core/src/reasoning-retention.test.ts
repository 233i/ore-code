import { describe, expect, it } from "vitest";
import type { LlmMessage } from "./llm";
import { applyReasoningRetention, REASONING_RETENTION_PLACEHOLDER } from "./reasoning-retention";
import { buildRuntimeContextFromMessages } from "./runtime-history";

describe("reasoning retention", () => {
  it("only applies to DeepSeek thinking models", () => {
    const messages: LlmMessage[] = [
      { role: "user", content: "first" },
      { role: "assistant", content: "answer", reasoningContent: "private reasoning" }
    ];

    const result = applyReasoningRetention(messages, { model: "gpt-4.1" });

    expect(result.messages).toEqual(messages);
    expect(result.report).toMatchObject({ enabled: false, strippedMessages: 0, healedMessages: 0 });
  });

  it("keeps tool-call reasoning, heals missing tool-call reasoning, and strips stale non-tool reasoning", () => {
    const messages: LlmMessage[] = [
      { role: "user", content: "turn 1" },
      { role: "assistant", content: "old tool", reasoningContent: "old required", toolCalls: [{ id: "call-1", name: "read_file", input: { path: "a.ts" } }] },
      { role: "tool", toolCallId: "call-1", content: "{}" },
      { role: "user", content: "turn 2" },
      { role: "assistant", content: "old answer", reasoningContent: "old optional" },
      { role: "user", content: "turn 3" },
      { role: "assistant", content: "recent answer", reasoningContent: "recent optional" },
      { role: "user", content: "turn 4" },
      { role: "assistant", content: "recent tool", toolCalls: [{ id: "call-2", name: "list_dir", input: { path: "." } }] }
    ];

    const result = applyReasoningRetention(messages, {
      model: "deepseek-v4-pro",
      recentWindowTurns: 2
    });

    expect(result.messages[1]).toMatchObject({ reasoningContent: "old required" });
    expect(result.messages[4]).not.toHaveProperty("reasoningContent");
    expect(result.messages[6]).toMatchObject({ reasoningContent: "recent optional" });
    expect(result.messages[8]).toMatchObject({ reasoningContent: REASONING_RETENTION_PLACEHOLDER });
    expect(result.report).toMatchObject({
      enabled: true,
      keptToolCallMessages: 1,
      keptRecentMessages: 1,
      strippedMessages: 1,
      strippedChars: "old optional".length,
      healedMessages: 1,
      healingApplied: true
    });
  });

  it("does not mutate ledger-produced messages when stripping request history", () => {
    const messages: LlmMessage[] = [
      { role: "user", content: "turn 1" },
      { role: "assistant", content: "old answer", reasoningContent: "old optional" },
      { role: "user", content: "turn 2" },
      { role: "assistant", content: "recent answer", reasoningContent: "recent optional" }
    ];

    const result = applyReasoningRetention(messages, { model: "deepseek-reasoner", recentWindowTurns: 1 });

    expect(result.messages[1]).not.toHaveProperty("reasoningContent");
    expect(messages[1]).toMatchObject({ reasoningContent: "old optional" });
  });

  it("feeds retained messages and stats into runtime context", () => {
    const context = buildRuntimeContextFromMessages([
      { role: "user", content: "turn 1" },
      { role: "assistant", content: "old answer", reasoningContent: "old optional" },
      { role: "user", content: "turn 2" },
      { role: "assistant", content: "middle answer", reasoningContent: "middle optional" },
      { role: "user", content: "turn 3" },
      { role: "assistant", content: "recent answer", reasoningContent: "recent optional" }
    ], {
      model: "deepseek-v4-pro",
      maxMessages: 10,
      maxChars: 10_000
    });

    expect(context.messages[1]).not.toHaveProperty("reasoningContent");
    expect(context.messages[3]).toMatchObject({ reasoningContent: "middle optional" });
    expect(context.messages[5]).toMatchObject({ reasoningContent: "recent optional" });
    expect(context.reasoningRetention).toMatchObject({
      enabled: true,
      strippedMessages: 1,
      keptRecentMessages: 2
    });
  });

  it("applies reasoning retention before checkpoint so runtime checkpoint remains a fallback", () => {
    const context = buildRuntimeContextFromMessages([
      { role: "user", content: "turn 1" },
      { role: "assistant", content: "old answer", reasoningContent: "old optional" },
      { role: "user", content: "turn 2" },
      { role: "assistant", content: "middle answer", reasoningContent: "middle optional" },
      { role: "user", content: "turn 3" },
      { role: "assistant", content: "recent answer", reasoningContent: "recent optional" }
    ], {
      model: "deepseek-v4-pro",
      checkpoint: "auto",
      maxMessages: 10,
      maxChars: 10_000
    });

    expect(context.checkpoint).toMatchObject({
      status: "none",
      cacheBreak: false
    });
    expect(context.checkpointEvent).toBeUndefined();
    expect(context.reasoningRetention).toMatchObject({
      enabled: true,
      strippedMessages: 1,
      healedMessages: 0
    });
    expect(context.messages[1]).not.toHaveProperty("reasoningContent");
    expect(context.messages[3]).toMatchObject({ reasoningContent: "middle optional" });
    expect(context.messages[5]).toMatchObject({ reasoningContent: "recent optional" });
  });
});
