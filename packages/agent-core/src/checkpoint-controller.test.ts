import { describe, expect, it } from "vitest";
import type { LlmMessage } from "./llm";
import { createContextCheckpoint } from "./checkpoint-controller";

describe("context checkpoint controller", () => {
  it("leaves small histories unchanged below the checkpoint threshold", () => {
    const messages: LlmMessage[] = [
      { role: "user", content: "small request" },
      { role: "assistant", content: "small answer" }
    ];

    const result = createContextCheckpoint(messages, {
      model: "deepseek-v4-pro",
      maxInputTokens: 10_000
    });

    expect(result.report).toMatchObject({
      status: "none",
      cacheBreak: false,
      messagesBefore: 2
    });
    expect(result.eventBody).toBeUndefined();
    expect(result.messages).toEqual(messages);
    expect(result.messages).not.toBe(messages);
  });

  it("folds old history and retains the tail when the capacity threshold is reached", () => {
    const messages: LlmMessage[] = [
      { role: "user", content: `first ${"a".repeat(400)}` },
      { role: "assistant", content: `answer ${"b".repeat(400)}` },
      { role: "user", content: "latest request" },
      { role: "assistant", content: "latest answer" }
    ];

    const result = createContextCheckpoint(messages, {
      model: "deepseek-v4-pro",
      maxInputTokens: 10_000,
      requiredRatio: 0.01,
      retainedTailTurns: 1
    });

    expect(result.report).toMatchObject({
      status: "applied",
      reason: "capacity",
      cacheBreak: true,
      messagesBefore: 4,
      messagesAfter: 3,
      droppedMessages: 2,
      retainedMessages: 2
    });
    expect(result.messages[0]).toMatchObject({ role: "assistant" });
    expect(result.messages[0].content).toContain("[context_checkpoint]");
    expect(result.messages.slice(1)).toEqual(messages.slice(2));
    expect(result.eventBody).toMatchObject({
      type: "context_checkpoint",
      reason: "capacity",
      checkpointMessages: result.messages
    });
  });

  it("creates a checkpoint when reasoning retention would rewrite old thinking", () => {
    const messages: LlmMessage[] = [
      { role: "user", content: "turn 1" },
      { role: "assistant", content: "old answer", reasoningContent: "old optional reasoning" },
      { role: "user", content: "turn 2" },
      { role: "assistant", content: "middle answer", reasoningContent: "middle optional reasoning" },
      { role: "user", content: "turn 3" },
      { role: "assistant", content: "recent answer", reasoningContent: "recent optional reasoning" }
    ];

    const result = createContextCheckpoint(messages, {
      model: "deepseek-v4-pro",
      maxInputTokens: 10_000,
      retainedTailTurns: 2
    });

    expect(result.report).toMatchObject({
      status: "applied",
      reason: "reasoning_retention",
      cacheBreak: true,
      droppedMessages: 2,
      retainedMessages: 4
    });
    expect(result.messages[0].content).toContain("Reason: reasoning_retention");
    expect(result.eventBody?.reason).toBe("reasoning_retention");
  });

  it("produces deterministic checkpoint ids for the same input", () => {
    const messages: LlmMessage[] = [
      { role: "user", content: `goal ${"x".repeat(400)}` },
      { role: "assistant", content: "progress" },
      { role: "user", content: "continue" }
    ];

    const first = createContextCheckpoint(messages, {
      maxInputTokens: 40,
      retainedTailTurns: 1
    });
    const second = createContextCheckpoint(messages, {
      maxInputTokens: 40,
      retainedTailTurns: 1
    });

    expect(first.eventBody?.checkpointId).toBe(second.eventBody?.checkpointId);
    expect(first.messages).toEqual(second.messages);
  });
});
