import { describe, expect, it } from "vitest";
import {
  buildCommitMessagePrefixCompletionInput,
  buildReviewPrefixCompletionInput,
  generateLightweightCommitMessage,
  generateLightweightReviewComment
} from "./lightweightCompletion";
import type { LlmClient, ModelStreamChunk } from "@ore-code/agent-core";

describe("lightweightCompletion", () => {
  it("builds a bounded review prefix completion request", () => {
    const input = buildReviewPrefixCompletionInput({
      path: "src/App.tsx",
      diff: "x".repeat(21_000),
      threadId: "thread-1",
      turnId: "turn-1"
    });

    expect(input).toMatchObject({
      threadId: "thread-1",
      turnId: "turn-1",
      maxTokens: 512
    });
    expect(input.prefix).toContain("File: src/App.tsx");
    expect(input.prefix).toContain("[diff truncated 1000 chars for lightweight review]");
  });

  it("uses provider prefix completion when available", async () => {
    const client: LlmClient = {
      async *streamTurn(): AsyncIterable<ModelStreamChunk> {
        throw new Error("stream fallback should not run");
      },
      async completePrefix(input) {
        expect(input.prefix).toContain("Review comment:");
        return {
          text: "  建议补充失败路径测试。 ",
          mode: "fim"
        };
      }
    };

    await expect(generateLightweightReviewComment(client, {
      path: "src/App.tsx",
      diff: "+value"
    })).resolves.toEqual({
      text: "建议补充失败路径测试。",
      mode: "fim",
      usage: undefined
    });
  });

  it("builds and runs a commit message prefix completion request", async () => {
    const input = buildCommitMessagePrefixCompletionInput({
      diff: "+new feature",
      threadId: "thread-1",
      turnId: "turn-1",
      language: "en"
    });
    expect(input).toMatchObject({
      threadId: "thread-1",
      turnId: "turn-1",
      maxTokens: 96
    });
    expect(input.prefix).toContain("Commit message:");
    expect(input.prefix).toContain("in English");

    const client: LlmClient = {
      async *streamTurn(): AsyncIterable<ModelStreamChunk> {
        throw new Error("stream fallback should not run");
      },
      async completePrefix(prefixInput) {
        expect(prefixInput.maxTokens).toBe(96);
        return {
          text: "feat: add lightweight review",
          mode: "fim"
        };
      }
    };

    await expect(generateLightweightCommitMessage(client, { diff: "+new feature" })).resolves.toEqual({
      text: "feat: add lightweight review",
      mode: "fim",
      usage: undefined
    });
  });

  it("builds a Chinese commit message prompt when requested", () => {
    const input = buildCommitMessagePrefixCompletionInput({
      diff: "+修复",
      language: "zh"
    });

    expect(input.prefix).toContain("简洁中文 conventional commit message");
    expect(input.prefix).toContain("保留 type/scope 为英文");
  });

  it("falls back to chat when prefix commit message output is empty", async () => {
    const client: LlmClient = {
      async *streamTurn(input): AsyncIterable<ModelStreamChunk> {
        expect(input.messages[0]?.content).toContain("Commit message:");
        yield { type: "assistant_delta", text: "fix: 修复提交信息生成" };
      },
      async completePrefix() {
        return {
          text: "   ",
          mode: "fim"
        };
      }
    };

    await expect(generateLightweightCommitMessage(client, {
      diff: "+修复",
      language: "zh"
    })).resolves.toEqual({
      text: "fix: 修复提交信息生成",
      mode: "chat-fallback",
      usage: undefined
    });
  });

  it("uses a commit-specific fallback only when prefix and chat are both empty", async () => {
    const client: LlmClient = {
      async *streamTurn(): AsyncIterable<ModelStreamChunk> {
        yield { type: "assistant_delta", text: " " };
      },
      async completePrefix() {
        return {
          text: "   ",
          mode: "fim"
        };
      }
    };

    await expect(generateLightweightCommitMessage(client, {
      diff: "+修复",
      language: "zh"
    })).resolves.toEqual({
      text: "chore: 更新代码变更",
      mode: "chat-fallback",
      usage: undefined
    });
  });

  it("falls back to a non-tool chat turn when prefix completion is missing", async () => {
    const client: LlmClient = {
      async *streamTurn(input) {
        expect(input.tools).toBeUndefined();
        yield { type: "assistant_delta", text: "LGTM" };
      }
    };

    await expect(generateLightweightReviewComment(client, {
      path: "src/App.tsx",
      diff: "+value"
    })).resolves.toEqual({
      text: "LGTM",
      mode: "chat-fallback",
      usage: undefined
    });
  });
});
