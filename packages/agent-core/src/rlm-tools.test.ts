import { describe, expect, it } from "vitest";
import { createRlmQueryTool, type RlmQueryHost } from "./rlm-tools";
import type { LlmClient, LlmTurnInput, ModelStreamChunk } from "./llm";
import { ToolRegistry } from "@ore-code/tools";
import { z } from "zod";

describe("createRlmQueryTool", () => {
  it("runs batched prompts through independent child clients", async () => {
    const inputs: LlmTurnInput[] = [];
    const host: RlmQueryHost = {
      childModel: "deepseek-v4-flash",
      async createClient() {
        return new StaticChildClient(inputs);
      }
    };
    const tool = createRlmQueryTool(host);

    const result = await tool.execute({
      prompts: ["inspect auth flow", "inspect shell flow"],
      system: "Answer briefly."
    }, { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false });

    expect(result.output).toMatchObject({
      childModel: "deepseek-v4-flash",
      promptCount: 2,
      okCount: 2,
      failedCount: 0,
      usage: {
        model: "deepseek-v4-flash",
        promptTokens: 20,
        completionTokens: 10,
        totalTokens: 30,
        costUsd: 0.000002
      },
      results: [
        {
          index: 0,
          ok: true,
          promptPreview: "inspect auth flow",
          text: "child answer: inspect auth flow",
          reasoningPreview: "child reasoning"
        },
        {
          index: 1,
          ok: true,
          promptPreview: "inspect shell flow",
          text: "child answer: inspect shell flow",
          reasoningPreview: "child reasoning"
        }
      ]
    });
    expect(inputs).toHaveLength(2);
    expect(inputs[0].messages).toEqual([
      { role: "system", content: "Answer briefly." },
      { role: "user", content: "inspect auth flow" }
    ]);
  });

  it("writes structured batch results to an artifact", async () => {
    const artifactStore = new CapturingRlmArtifactSink();
    const tool = createRlmQueryTool({
      artifacts: { store: artifactStore },
      childModel: "deepseek-v4-flash",
      async createClient() {
        return new StaticChildClient([]);
      }
    });

    const result = await tool.execute({
      prompts: ["first", "second"]
    }, { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false });

    expect(result.artifactId).toBe("artifact-1");
    expect(result.output).toMatchObject({
      artifact: {
        id: "artifact-1",
        type: "text"
      },
      promptCount: 2,
      okCount: 2
    });
    expect(artifactStore.records[0].content).toContain("\"results\"");
    expect(artifactStore.records[0].summary).toBe("rlm_query 2 deepseek-v4-flash subtasks");
  });

  it("shares readonly tools with child Flash tasks", async () => {
    const readonlyTools = new ToolRegistry();
    readonlyTools.register({
      name: "read_context",
      description: "Read context.",
      capability: "readonly",
      approval: "never",
      inputSchema: z.object({ key: z.string() }),
      async execute(input: { key: string }) {
        return { callId: "read_context", ok: true, output: { value: `value:${input.key}` } };
      }
    });
    const inputs: LlmTurnInput[] = [];
    const tool = createRlmQueryTool({
      childModel: "deepseek-v4-flash",
      readonlyTools,
      async createClient() {
        return new ToolUsingChildClient(inputs);
      }
    });

    const result = await tool.execute({
      prompt: "use a tool"
    }, { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false });

    expect(result.output?.results[0]).toMatchObject({
      ok: true,
      text: "tool said {\"callId\":\"child-tool-1\",\"ok\":true,\"output\":{\"value\":\"value:alpha\"}}"
    });
    expect(inputs[0].tools?.map((item) => item.function.name)).toEqual(["read_context"]);
    expect(inputs[1].messages[inputs[1].messages.length - 1]).toMatchObject({
      role: "tool",
      toolCallId: "child-tool-1"
    });
  });

  it("keeps a failed child result scoped to that prompt", async () => {
    let calls = 0;
    const host: RlmQueryHost = {
      childModel: "deepseek-v4-flash",
      async createClient() {
        calls += 1;
        return calls === 2 ? new FailingChildClient() : new StaticChildClient([]);
      }
    };
    const tool = createRlmQueryTool(host);

    const result = await tool.execute({
      prompts: ["first", "second"]
    }, { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false });

    expect(result.ok).toBe(true);
    expect(result.output?.results).toMatchObject([
      { index: 0, ok: true, text: "child answer: first" },
      { index: 1, ok: false, text: "", error: "child failed" }
    ]);
  });

  it("emits structured progress for each child subtask", async () => {
    const progress: string[] = [];
    const tool = createRlmQueryTool({
      childModel: "deepseek-v4-flash",
      async createClient() {
        return new StaticChildClient([]);
      }
    });

    await tool.execute({
      prompts: ["first", "second"]
    }, {
      workspacePath: "/workspace",
      mode: "agent",
      trustedWorkspace: false,
      toolCallId: "rlm-call-1",
      onCommandOutput(delta) {
        progress.push(delta.text);
      }
    });

    const events = progress.join("").trim().split("\n").map((line) => JSON.parse(line));
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "rlm_progress", status: "running", index: 0, total: 2 }),
      expect.objectContaining({ type: "rlm_progress", status: "running", index: 1, total: 2 }),
      expect.objectContaining({ type: "rlm_progress", status: "completed", index: 0, total: 2 }),
      expect.objectContaining({ type: "rlm_progress", status: "completed", index: 1, total: 2 })
    ]));
  });

  it("caps batched prompts at 16", () => {
    const tool = createRlmQueryTool({
      childModel: "deepseek-v4-flash",
      async createClient() {
        return new StaticChildClient([]);
      }
    });

    expect(() => tool.inputSchema.parse({ prompts: Array.from({ length: 17 }, () => "task") })).toThrow();
  });
});

class StaticChildClient implements LlmClient {
  constructor(private readonly inputs: LlmTurnInput[]) {}

  async *streamTurn(input: LlmTurnInput): AsyncIterable<ModelStreamChunk> {
    this.inputs.push(input);
    const userMessages = input.messages.filter((message) => message.role === "user");
    const prompt = userMessages[userMessages.length - 1]?.content ?? "";
    yield { type: "reasoning_delta", text: "child reasoning" };
    yield { type: "assistant_delta", text: `child answer: ${prompt}` };
    yield {
      type: "usage",
      usage: {
        model: "deepseek-v4-flash",
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        cachedTokens: 2,
        cacheHitTokens: 2,
        cacheMissTokens: 8,
        cacheHitRatio: 0.2,
        costUsd: 0.000001,
        costCny: 0.000007
      }
    };
    yield { type: "done" };
  }
}

class ToolUsingChildClient implements LlmClient {
  constructor(private readonly inputs: LlmTurnInput[]) {}

  async *streamTurn(input: LlmTurnInput): AsyncIterable<ModelStreamChunk> {
    this.inputs.push(input);
    if (this.inputs.length === 1) {
      yield {
        type: "tool_call",
        call: {
          id: "child-tool-1",
          name: "read_context",
          input: { key: "alpha" }
        }
      };
      yield { type: "done", finishReason: "tool_calls" };
      return;
    }

    const last = input.messages[input.messages.length - 1];
    yield { type: "assistant_delta", text: `tool said ${last.content}` };
    yield { type: "done" };
  }
}

class FailingChildClient implements LlmClient {
  async *streamTurn(): AsyncIterable<ModelStreamChunk> {
    throw new Error("child failed");
  }
}

class CapturingRlmArtifactSink {
  readonly records: Array<{ type: "text"; content: string; summary: string; sourceCallId?: string }> = [];

  async write(input: { type: "text"; content: string; summary: string; sourceCallId?: string }) {
    this.records.push(input);
    return {
      id: `artifact-${this.records.length}`,
      type: input.type,
      size: input.content.length,
      createdAt: "2026-05-19T00:00:00.000Z",
      summary: input.summary,
      sourceCallId: input.sourceCallId
    };
  }
}
