import { describe, expect, it } from "vitest";
import { createArtifactTools, EchoTool, ShellProbeTool, ToolRegistry } from "@ore-code/tools";
import { AgentEngine, ToolProfileEscalationError, type ArtifactSink } from "./engine";
import { createInteractionRequestTool } from "./interaction-tool";
import { MockLlmClient, type LlmClient, type LlmWarmupInput, type ModelStreamChunk } from "./llm";
import { buildRuntimeContext, runtimeEventsToLlmMessages } from "./runtime-history";
import type { ArtifactMetadata, ArtifactRecord, RuntimeEvent, ToolCall } from "@ore-code/protocol";
import { z } from "zod";

function makeToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: "call-1",
    name: "echo",
    input: { text: "hello" },
    ...overrides
  };
}

function makeRegistry() {
  const registry = new ToolRegistry();
  registry.register(EchoTool);
  registry.register(ShellProbeTool);
  return registry;
}

async function collect(events: AsyncIterable<RuntimeEvent>): Promise<RuntimeEvent[]> {
  const result: RuntimeEvent[] = [];
  for await (const event of events) {
    result.push(event);
  }
  return result;
}

describe("AgentEngine tool execution", () => {
  it("keeps user-visible text separate from model-only context", async () => {
    const client = new CapturingLlmClient();
    const engine = new AgentEngine(client);
    const modelText = "<context>retrieved codebase hints</context>\n\n你是谁";

    const events = await collect(engine.startTurn({
      threadId: "thread-1",
      turnId: "turn-1",
      text: "你是谁",
      modelText
    }));

    expect(events.find((event) => event.type === "user_message")).toMatchObject({
      type: "user_message",
      text: "你是谁"
    });
    const messages = client.input?.messages ?? [];
    expect(messages[messages.length - 1]).toMatchObject({ role: "user", content: modelText });
  });

  it("executes readonly tool calls and emits tool lifecycle events", async () => {
    const engine = new AgentEngine(new MockLlmClient([{ type: "tool_call", call: makeToolCall() }, { type: "done" }]), {
      tools: {
        registry: makeRegistry(),
        context: { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false }
      }
    });

    const events = await collect(engine.startTurn({ threadId: "thread-1", turnId: "turn-1", text: "run echo" }));
    const types = events.map((event) => event.type);

    expect(types).toContain("tool_call_requested");
    expect(types).toContain("tool_started");
    expect(types).toContain("tool_completed");
    expect(types).not.toContain("approval_requested");

    const completed = events.find((event) => event.type === "tool_completed");
    expect(completed?.result.callId).toBe("call-1");
  });

  it("emits token usage reported by internal tools such as rlm_query", async () => {
    const registry = makeRegistry();
    registry.register(UsageOutputTool);
    const engine = new AgentEngine(new MockLlmClient([
      { type: "tool_call", call: { id: "usage-tool-1", name: "usage_output", input: {} } },
      { type: "done" }
    ]), {
      maxModelIterations: 3,
      tools: {
        registry,
        context: { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false }
      }
    });

    const events = await collect(engine.startTurn({ threadId: "thread-1", turnId: "turn-1", text: "run usage tool" }));

    expect(events.find((event) => event.type === "token_usage")).toMatchObject({
      type: "token_usage",
      model: "deepseek-v4-flash",
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      costUsd: 0.000001
    });
  });

  it("passes registered tool definitions to the model provider", async () => {
    const llm = new CapturingLlmClient();
    const engine = new AgentEngine(llm, {
      tools: {
        registry: makeRegistry(),
        context: { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false }
      }
    });

    await collect(engine.startTurn({ threadId: "thread-1", turnId: "turn-1", text: "run echo" }));

    expect(llm.input?.tools?.map((tool) => tool.function.name)).toEqual(["echo", "shell_probe"]);
    expect(llm.input?.tools?.[0].function.parameters).toMatchObject({
      type: "object",
      properties: {
        text: { type: "string" }
      }
    });
  });

  it("sorts tool definitions by name for cache-stable schemas", async () => {
    const registry = new ToolRegistry();
    registry.register(ShellProbeTool);
    registry.register(EchoTool);
    const llm = new CapturingLlmClient();
    const engine = new AgentEngine(llm, {
      tools: {
        registry,
        context: { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false }
      }
    });

    await collect(engine.startTurn({ threadId: "thread-1", turnId: "turn-1", text: "run echo" }));

    expect(llm.input?.tools?.map((tool) => tool.function.name)).toEqual(["echo", "shell_probe"]);
  });

  it("handles request_user_input as a same-turn tool interaction", async () => {
    const registry = makeRegistry();
    registry.register(createInteractionRequestTool());
    const engine = new AgentEngine(new MockLlmClient([
      {
        type: "tool_call",
        call: {
          id: "ask-1",
          name: "request_user_input",
          input: {
            title: "选择方案",
            message: "请选择实现范围。",
            recommendedOptionId: "p0",
            options: [
              { id: "p0", label: "只做 P0", value: "p0" },
              { id: "p1", label: "做到 P1", value: "p1" }
            ]
          }
        }
      },
      { type: "done", finishReason: "tool_calls" },
      { type: "assistant_delta", text: "已根据选择继续。" },
      { type: "done" }
    ]), {
      tools: {
        registry,
        context: { workspacePath: "/workspace", mode: "plan", trustedWorkspace: false },
        requestInteraction: async () => ({ type: "option", optionId: "p0", value: "p0" })
      }
    });

    const events = await collect(engine.startTurn({ threadId: "thread-1", turnId: "turn-1", text: "plan" }));

    expect(events.map((event) => event.type)).toContain("interaction_requested");
    expect(events.map((event) => event.type)).toContain("interaction_decided");
    expect(events.find((event) => event.type === "tool_completed")).toMatchObject({
      result: { callId: "ask-1", ok: true }
    });
  });

  it("blocks the third identical tool call in one turn", async () => {
    const engine = new AgentEngine(new MockLlmClient([
      { type: "tool_call", call: makeToolCall() },
      { type: "done", finishReason: "tool_calls" }
    ]), {
      maxModelIterations: 3,
      tools: {
        registry: makeRegistry(),
        context: { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false }
      }
    });

    const events = await collect(engine.startTurn({ threadId: "thread-1", turnId: "turn-1", text: "repeat" }));

    expect(events.find((event) => event.type === "loop_guard")).toMatchObject({
      type: "loop_guard",
      level: "blocked",
      toolName: "echo"
    });
    expect(events.find((event) => event.type === "tool_failed")).toMatchObject({
      result: { error: { code: "loop_guard_blocked" } }
    });
  });

  it("turns plan-mode interaction requests into runtime events without leaking raw JSON", async () => {
    const engine = new AgentEngine(
      new MockLlmClient([
        {
          type: "assistant_delta",
          text: [
            "<interaction_request>",
            JSON.stringify({
              title: "选择项目",
              message: "检测到多个项目。",
              recommendedOptionId: "ore-code",
              options: [
                { id: "ore-code", label: "Ore Code", value: "/repo/Ore Code" }
              ]
            }),
            "</interaction_request>"
          ].join("\n")
        },
        { type: "done" }
      ]),
      {
        tools: {
          registry: makeRegistry(),
          context: { workspacePath: "/workspace", mode: "plan", trustedWorkspace: false }
        }
      }
    );

    const events = await collect(engine.startTurn({ threadId: "thread-1", turnId: "turn-1", text: "plan" }));

    expect(events.map((event) => event.type)).toContain("interaction_requested");
    expect(events.map((event) => event.type)).not.toContain("assistant_delta");
    expect(events.map((event) => event.type)).not.toContain("assistant_message");
    expect(events.find((event) => event.type === "interaction_requested")).toMatchObject({
      type: "interaction_requested",
      title: "选择项目",
      message: "检测到多个项目。",
      recommendedOptionId: "ore-code",
      options: [{ id: "ore-code", label: "Ore Code", value: "/repo/Ore Code" }]
    });
  });

  it("turns plain plan-mode clarification text into an interaction request", async () => {
    const rawText = [
      "在我开始之前，想确认几个选择：",
      "",
      "技术栈偏好：你希望用哪种方式？",
      "",
      "纯 HTML/CSS/JS（无需构建工具，开箱即用）",
      "React + TypeScript",
      "Vue + TypeScript"
    ].join("\n");
    const engine = new AgentEngine(
      new MockLlmClient([
        { type: "assistant_delta", text: rawText },
        { type: "done" }
      ]),
      {
        tools: {
          registry: makeRegistry(),
          context: { workspacePath: "/workspace", mode: "plan", trustedWorkspace: false }
        }
      }
    );

    const events = await collect(engine.startTurn({ threadId: "thread-1", turnId: "turn-1", text: "plan" }));

    expect(events.map((event) => event.type)).toContain("interaction_requested");
    expect(events.map((event) => event.type)).not.toContain("assistant_message");
    expect(events.find((event) => event.type === "interaction_requested")).toMatchObject({
      type: "interaction_requested",
      title: "技术栈偏好",
      message: "技术栈偏好：你希望用哪种方式？",
      options: [
        { id: "option-1", label: "纯 HTML/CSS/JS（无需构建工具，开箱即用）" },
        { id: "option-2", label: "React + TypeScript" },
        { id: "option-3", label: "Vue + TypeScript" }
      ]
    });
  });

  it("does not parse interaction request blocks outside plan mode", async () => {
    const rawText = "<interaction_request>{\"title\":\"选择\",\"message\":\"请选择\",\"options\":[{\"id\":\"a\",\"label\":\"A\"}]}</interaction_request>";
    const engine = new AgentEngine(
      new MockLlmClient([
        { type: "assistant_delta", text: rawText },
        { type: "done" }
      ]),
      {
        tools: {
          registry: makeRegistry(),
          context: { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false }
        }
      }
    );

    const events = await collect(engine.startTurn({ threadId: "thread-1", turnId: "turn-1", text: "agent" }));

    expect(events.map((event) => event.type)).not.toContain("interaction_requested");
    expect(events.find((event) => event.type === "assistant_delta")).toMatchObject({ text: rawText });
  });

  it("uses explicit model parameters for tool definitions when provided", async () => {
    const registry = makeRegistry();
    registry.register({
      name: "mcp_demo_ping",
      description: "MCP demo tool.",
      capability: "readonly",
      approval: "never",
      inputSchema: z.object({}),
      modelParameters: {
        type: "object",
        properties: {
          message: { type: "string" }
        },
        required: ["message"]
      },
      async execute() {
        return { callId: "mcp_demo_ping", ok: true, output: { ok: true } };
      }
    });
    const llm = new CapturingLlmClient();
    const engine = new AgentEngine(llm, {
      tools: {
        registry,
        context: { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false }
      }
    });

    await collect(engine.startTurn({ threadId: "thread-1", turnId: "turn-1", text: "run mcp" }));

    expect(llm.input?.tools?.find((tool) => tool.function.name === "mcp_demo_ping")?.function.parameters).toEqual({
      type: "object",
      properties: {
        message: { type: "string" }
      },
      required: ["message"]
    });
  });

  it("passes an optional system prompt to the model provider", async () => {
    const llm = new CapturingLlmClient();
    const engine = new AgentEngine(llm, {
      systemPrompt: "You are Ore Code.",
      tools: {
        registry: makeRegistry(),
        context: { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false }
      }
    });

    await collect(engine.startTurn({ threadId: "thread-1", turnId: "turn-1", text: "run echo" }));

    expect(llm.input?.messages).toEqual([
      { role: "system", content: "You are Ore Code." },
      { role: "user", content: "run echo" }
    ]);
  });

  it("keeps project context before history and the dynamic user prompt last", async () => {
    const llm = new CapturingLlmClient();
    const engine = new AgentEngine(llm, {
      systemPrompt: "Static system prompt.",
      projectContext: "<project_context>workspace=/repo</project_context>"
    });

    await collect(engine.startTurn({
      threadId: "thread-1",
      turnId: "turn-1",
      text: "current request",
      history: [
        { role: "user", content: "old question" },
        { role: "assistant", content: "old answer" }
      ]
    }));

    expect(llm.input?.messages).toEqual([
      { role: "system", content: "Static system prompt." },
      { role: "system", content: "<project_context>workspace=/repo</project_context>" },
      { role: "user", content: "old question" },
      { role: "assistant", content: "old answer" },
      { role: "user", content: "current request" }
    ]);
  });

  it("emits model-aware capacity reports", async () => {
    const engine = new AgentEngine(new CapturingLlmClient(), { model: "deepseek-v4-pro" });

    const events = await collect(engine.startTurn({ threadId: "thread-1", turnId: "turn-1", text: "hello" }));
    const capacity = events.find((event) => event.type === "context_capacity");

    expect(capacity).toMatchObject({
      type: "context_capacity",
      model: "deepseek-v4-pro",
      contextWindow: 1_000_000,
      maxInputTokens: 930_368,
      maxOutputTokens: 65_536,
      safetyHeadroomTokens: 4_096
    });
  });

  it("warms a stable prefix once and reuses it when only the user prompt changes", async () => {
    const llm = new WarmupCapturingLlmClient();
    const store = new Map<string, { key: string; prefixHash: string; model?: string; warmedAt: string }>();
    const engine = new AgentEngine(llm, {
      model: "deepseek-v4-pro",
      systemPrompt: "Static system prompt.",
      projectContext: "<project_context>workspace=/repo</project_context>",
      cacheWarmup: {
        enabled: true,
        store: {
          get: (key) => store.get(key),
          set: (record) => {
            store.set(record.key, record);
          }
        }
      }
    });

    const first = await collect(engine.startTurn({ threadId: "thread-1", turnId: "turn-1", text: "first request" }));
    const second = await collect(engine.startTurn({ threadId: "thread-1", turnId: "turn-2", text: "second request" }));

    expect(llm.warmups).toHaveLength(1);
    expect(llm.warmups[0].messages).toEqual([
      { role: "system", content: "Static system prompt." },
      { role: "system", content: "<project_context>workspace=/repo</project_context>" }
    ]);
    expect(first.find((event) => event.type === "context_capacity")).toMatchObject({
      cacheWarmupStatus: "warmed"
    });
    expect(second.find((event) => event.type === "context_capacity")).toMatchObject({
      cacheWarmupStatus: "hit"
    });
  });

  it("rewarms when a stable prefix layer changes", async () => {
    const llm = new WarmupCapturingLlmClient();
    const store = new Map<string, { key: string; prefixHash: string; model?: string; warmedAt: string }>();
    const cacheWarmup = {
      enabled: true,
      store: {
        get: (key: string) => store.get(key),
        set: (record: { key: string; prefixHash: string; model?: string; warmedAt: string }) => {
          store.set(record.key, record);
        }
      }
    };

    await collect(new AgentEngine(llm, {
      model: "deepseek-v4-pro",
      systemPrompt: "Static system prompt.",
      projectContext: "<project_context>workspace=/repo</project_context>",
      cacheWarmup
    }).startTurn({ threadId: "thread-1", turnId: "turn-1", text: "first request" }));
    await collect(new AgentEngine(llm, {
      model: "deepseek-v4-pro",
      systemPrompt: "Static system prompt.",
      projectContext: "<project_context>workspace=/other</project_context>",
      cacheWarmup
    }).startTurn({ threadId: "thread-1", turnId: "turn-2", text: "second request" }));

    expect(llm.warmups).toHaveLength(2);
  });

  it("passes prior runtime history and continues sequence numbers", async () => {
    const llm = new CapturingLlmClient();
    const engine = new AgentEngine(llm);

    const events = await collect(
      engine.startTurn({
        threadId: "thread-1",
        turnId: "turn-2",
        text: "continue",
        seqStart: 10,
        history: [
          { role: "user", content: "first question" },
          { role: "assistant", content: "first answer" }
        ]
      })
    );

    expect(llm.input?.messages).toEqual([
      { role: "user", content: "first question" },
      { role: "assistant", content: "first answer" },
      { role: "user", content: "continue" }
    ]);
    expect(events[0].seq).toBe(10);
  });

  it("continues the model loop with tool results after tool_calls finish", async () => {
    const llm = new MultiTurnLlmClient([
      [
        { type: "assistant_delta", text: "我先调用工具。" },
        { type: "tool_call", call: makeToolCall() },
        { type: "done", finishReason: "tool_calls" }
      ],
      [
        { type: "assistant_delta", text: "工具完成。" },
        { type: "done", finalText: "最终答复。" }
      ]
    ]);
    const engine = new AgentEngine(llm, {
      tools: {
        registry: makeRegistry(),
        context: { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false }
      }
    });

    const events = await collect(engine.startTurn({ threadId: "thread-1", turnId: "turn-1", text: "run echo" }));

    expect(llm.inputs).toHaveLength(2);
    expect(llm.inputs[1].messages).toEqual([
      { role: "user", content: "run echo" },
      {
        role: "assistant",
        content: "我先调用工具。",
        toolCalls: [{ id: "call-1", name: "echo", input: { text: "hello" } }]
      },
      {
        role: "tool",
        toolCallId: "call-1",
        content: JSON.stringify({
          callId: "call-1",
          ok: true,
          output: { text: "hello" }
        })
      }
    ]);
    expect(events.map((event) => event.type)).toContain("turn_completed");
  });

  it("replays reasoning content with assistant tool calls for thinking-mode providers", async () => {
    const llm = new MultiTurnLlmClient([
      [
        { type: "reasoning_delta", text: "需要先确认目录。" },
        { type: "assistant_delta", text: "我先调用工具。" },
        { type: "tool_call", call: makeToolCall() },
        { type: "done", finishReason: "tool_calls" }
      ],
      [
        { type: "assistant_delta", text: "工具完成。" },
        { type: "done" }
      ]
    ]);
    const engine = new AgentEngine(llm, {
      tools: {
        registry: makeRegistry(),
        context: { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false }
      }
    });

    await collect(engine.startTurn({ threadId: "thread-1", turnId: "turn-1", text: "run echo" }));

    expect(llm.inputs[1].messages).toContainEqual({
      role: "assistant",
      content: "我先调用工具。",
      reasoningContent: "需要先确认目录。",
      toolCalls: [{ id: "call-1", name: "echo", input: { text: "hello" } }]
    });
  });

  it("tells the model to treat non-zero shell exits as failed tool results", async () => {
    const registry = makeRegistry();
    registry.register(FailingShellOutputTool);
    const llm = new MultiTurnLlmClient([
      [
        { type: "tool_call", call: { id: "failing-shell-1", name: "failing_shell_output", input: {} } },
        { type: "done", finishReason: "tool_calls" }
      ],
      [
        { type: "assistant_delta", text: "命令失败，需要处理。" },
        { type: "done" }
      ]
    ]);
    const engine = new AgentEngine(llm, {
      tools: {
        registry,
        context: { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false }
      }
    });

    await collect(engine.startTurn({ threadId: "thread-1", turnId: "turn-1", text: "run failing shell" }));
    const toolMessage = llm.inputs[1].messages.find((message) => message.role === "tool");

    expect(toolMessage?.content).toContain('"modelStatus":"failed"');
    expect(toolMessage?.content).toContain("Shell command exited with non-zero status 127");
    expect(toolMessage?.content).toContain("Do not summarize it as a successful run.");
  });

  it("writes large shell outputs to artifacts and keeps only an inline tail", async () => {
    const registry = makeRegistry();
    registry.register(LongShellOutputTool);
    const artifactStore = new CapturingArtifactSink();
    const engine = new AgentEngine(
      new MockLlmClient([
        {
          type: "tool_call",
          call: { id: "long-shell-1", name: "long_shell_output", input: {} }
        },
        { type: "done" }
      ]),
      {
        artifacts: {
          store: artifactStore,
          maxInlineChars: 20,
          inlineTailChars: 8
        },
        tools: {
          registry,
          context: { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false }
        }
      }
    );

    const events = await collect(engine.startTurn({ threadId: "thread-1", turnId: "turn-1", text: "run long shell" }));
    const completed = events.find((event) => event.type === "tool_completed");

    expect(completed?.result.artifactId).toBe("artifact-1");
    expect(completed?.result.output).toMatchObject({
      stdout: "xxxxxxxx",
      stderr: "err",
      stdoutTruncated: true,
      stderrTruncated: false,
      artifactSummary: "long_shell_output output for long-shell-1"
    });
    expect(artifactStore.records).toEqual([
      {
        type: "shell-log",
        content: `stdout\n${"x".repeat(40)}\n\nstderr\nerr`,
        summary: "long_shell_output output for long-shell-1",
        sourceCallId: "long-shell-1"
      }
    ]);
  });

  it("writes large MCP outputs to text artifacts and keeps an inline preview", async () => {
    const registry = makeRegistry();
    registry.register(LongMcpOutputTool);
    const artifactStore = new CapturingArtifactSink();
    const engine = new AgentEngine(
      new MockLlmClient([
        {
          type: "tool_call",
          call: { id: "long-mcp-1", name: "long_mcp_output", input: {} }
        },
        { type: "done" }
      ]),
      {
        artifacts: {
          store: artifactStore,
          maxInlineChars: 20,
          inlineTailChars: 8
        },
        tools: {
          registry,
          context: { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false }
        }
      }
    );

    const events = await collect(engine.startTurn({ threadId: "thread-1", turnId: "turn-1", text: "call mcp" }));
    const completed = events.find((event) => event.type === "tool_completed");

    expect(completed?.result.artifactId).toBe("artifact-1");
    expect(completed?.result.output).toMatchObject({
      contentPreview: "xxxxxxxx",
      contentTruncated: true,
      artifactSummary: "long_mcp_output MCP output for long-mcp-1"
    });
    expect(artifactStore.records).toEqual([
      {
        type: "text",
        content: "x".repeat(40),
        summary: "long_mcp_output MCP output for long-mcp-1",
        sourceCallId: "long-mcp-1"
      }
    ]);
  });

  it("writes large grep outputs to artifacts and keeps only a match summary", async () => {
    const registry = makeRegistry();
    registry.register(LongGrepOutputTool);
    const artifactStore = new CapturingArtifactSink();
    const engine = new AgentEngine(
      new MockLlmClient([
        { type: "tool_call", call: { id: "long-grep-1", name: "long_grep_output", input: {} } },
        { type: "done" }
      ]),
      {
        artifacts: {
          store: artifactStore,
          largeOutputThresholds: { long_grep_output: 20 }
        },
        tools: {
          registry,
          context: { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false }
        }
      }
    );

    const events = await collect(engine.startTurn({ threadId: "thread-1", turnId: "turn-1", text: "grep" }));
    const completed = events.find((event) => event.type === "tool_completed");

    expect(completed?.result.artifactId).toBe("artifact-1");
    expect(completed?.result.output).toMatchObject({
      querySummary: { matchCount: 2, truncated: false },
      contentMovedToArtifact: true,
      artifactSummary: "long_grep_output large output for long-grep-1"
    });
    expect(JSON.stringify(completed?.result.output)).not.toContain("very long matched line ".repeat(20));
    expect(artifactStore.records[0]).toMatchObject({
      type: "text",
      summary: "long_grep_output large output for long-grep-1",
      sourceCallId: "long-grep-1"
    });
    expect(artifactStore.records[0].content).toContain("very long matched line");
  });

  it("writes large web fetch outputs to artifacts and keeps citation metadata", async () => {
    const registry = makeRegistry();
    registry.register(LongFetchOutputTool);
    const artifactStore = new CapturingArtifactSink();
    const engine = new AgentEngine(
      new MockLlmClient([
        { type: "tool_call", call: { id: "long-fetch-1", name: "long_fetch_output", input: {} } },
        { type: "done" }
      ]),
      {
        artifacts: {
          store: artifactStore,
          largeOutputThresholds: { long_fetch_output: 20 }
        },
        tools: {
          registry,
          context: { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false }
        }
      }
    );

    const events = await collect(engine.startTurn({ threadId: "thread-1", turnId: "turn-1", text: "fetch" }));
    const completed = events.find((event) => event.type === "tool_completed");

    expect(completed?.result.artifactId).toBe("artifact-1");
    expect(completed?.result.output).toMatchObject({
      url: "https://example.com",
      text: "[text moved to artifact]",
      textTruncated: true,
      citation: { id: "web:1", url: "https://example.com", source: "fetch_url" }
    });
    expect(artifactStore.records[0]).toMatchObject({ type: "text", sourceCallId: "long-fetch-1" });
    expect(artifactStore.records[0].content).toBe("web body ".repeat(20));
  });

  it("writes large git diffs to diff artifacts and keeps only a preview", async () => {
    const registry = makeRegistry();
    registry.register(LongGitDiffOutputTool);
    const artifactStore = new CapturingArtifactSink();
    const engine = new AgentEngine(
      new MockLlmClient([
        { type: "tool_call", call: { id: "long-diff-1", name: "long_git_diff_output", input: {} } },
        { type: "done" }
      ]),
      {
        artifacts: {
          store: artifactStore,
          largeOutputThresholds: { long_git_diff_output: 20 }
        },
        tools: {
          registry,
          context: { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false }
        }
      }
    );

    const events = await collect(engine.startTurn({ threadId: "thread-1", turnId: "turn-1", text: "diff" }));
    const completed = events.find((event) => event.type === "tool_completed");

    expect(completed?.result.artifactId).toBe("artifact-1");
    expect(completed?.result.output).toMatchObject({
      diff: "[diff moved to artifact]",
      diffTruncated: true,
      artifactSummary: "long_git_diff_output large output for long-diff-1"
    });
    expect(artifactStore.records[0]).toMatchObject({ type: "diff", sourceCallId: "long-diff-1" });
    expect(artifactStore.records[0].content).toContain("+large diff line");
  });

  it("lets the model retrieve a range from a large output artifact", async () => {
    const registry = makeRegistry();
    registry.register(LongShellOutputTool);
    const artifactStore = new CapturingArtifactSink();
    for (const tool of createArtifactTools(artifactStore)) {
      registry.register(tool);
    }
    const llm = new MultiTurnLlmClient([
      [
        { type: "tool_call", call: { id: "long-shell-1", name: "long_shell_output", input: {} } },
        { type: "done", finishReason: "tool_calls" }
      ],
      [
        {
          type: "tool_call",
          call: {
            id: "retrieve-1",
            name: "retrieve_tool_result",
            input: { artifactId: "artifact-1", stream: "stdout", mode: "tail", maxChars: 5 }
          }
        },
        { type: "done", finishReason: "tool_calls" }
      ],
      [
        { type: "assistant_delta", text: "已读取 artifact tail。" },
        { type: "done" }
      ]
    ]);
    const engine = new AgentEngine(llm, {
      artifacts: {
        store: artifactStore,
        maxInlineChars: 20,
        inlineTailChars: 8
      },
      tools: {
        registry,
        context: { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false }
      }
    });

    const events = await collect(engine.startTurn({ threadId: "thread-1", turnId: "turn-1", text: "inspect long output" }));
    const retrieved = events
      .filter((event) => event.type === "tool_completed")
      .find((event) => event.result.callId === "retrieve-1");

    expect(retrieved?.result.output).toMatchObject({
      artifact: { id: "artifact-1", type: "shell-log" },
      stream: "stdout",
      content: "xxxxx",
      charTruncated: true
    });
  });


  it("emits approval request and failure when mutating shell approval is missing", async () => {
    const engine = new AgentEngine(
      new MockLlmClient([
        { type: "tool_call", call: makeToolCall({ id: "shell-1", name: "shell_probe", input: { command: "pnpm install" } }) },
        { type: "done" }
      ]),
      {
        tools: {
          registry: makeRegistry(),
          context: { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false }
        }
      }
    );

    const events = await collect(engine.startTurn({ threadId: "thread-1", turnId: "turn-1", text: "run shell" }));
    const types = events.map((event) => event.type);

    expect(types).toContain("approval_requested");
    expect(types).toContain("tool_failed");
    expect(types).not.toContain("tool_started");
  });

  it("runs approved mutating shell calls with explicit approval events", async () => {
    const engine = new AgentEngine(
      new MockLlmClient([
        { type: "tool_call", call: makeToolCall({ id: "shell-1", name: "shell_probe", input: { command: "pnpm install" } }) },
        { type: "done" }
      ]),
      {
        tools: {
          registry: makeRegistry(),
          context: { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false },
          approvals: [{ callId: "shell-1", decision: "approved-once" }]
        }
      }
    );

    const events = await collect(engine.startTurn({ threadId: "thread-1", turnId: "turn-1", text: "run shell" }));
    const types = events.map((event) => event.type);

    expect(types).toContain("approval_requested");
    expect(types).toContain("approval_decided");
    expect(types).toContain("tool_started");
    expect(types).toContain("tool_completed");
  });

  it("runs approval-edited tool input and records the edited decision", async () => {
    const engine = new AgentEngine(
      new MockLlmClient([
        { type: "tool_call", call: makeToolCall({ id: "shell-1", name: "shell_probe", input: { command: "pnpm install" } }) },
        { type: "done" }
      ]),
      {
        tools: {
          registry: makeRegistry(),
          context: { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false },
          requestApproval: async (call) => ({
            callId: call.id,
            decision: "edited",
            editedInput: { command: "pnpm test" }
          })
        }
      }
    );

    const events = await collect(engine.startTurn({ threadId: "thread-1", turnId: "turn-1", text: "run shell" }));
    const decided = events.find((event) => event.type === "approval_decided");
    const completed = events.find((event) => event.type === "tool_completed");

    expect(decided).toMatchObject({
      type: "approval_decided",
      decision: { callId: "shell-1", decision: "edited", editedInput: { command: "pnpm test" } }
    });
    expect(completed?.result.output).toMatchObject({ command: "pnpm test" });
  });

  it("auto-runs read-only shell calls without approval noise", async () => {
    const engine = new AgentEngine(
      new MockLlmClient([
        { type: "tool_call", call: makeToolCall({ id: "shell-1", name: "shell_probe", input: { command: "pnpm test" } }) },
        { type: "done" }
      ]),
      {
        tools: {
          registry: makeRegistry(),
          context: { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false }
        }
      }
    );

    const events = await collect(engine.startTurn({ threadId: "thread-1", turnId: "turn-1", text: "run tests" }));
    const types = events.map((event) => event.type);

    expect(types).not.toContain("approval_requested");
    expect(types).toContain("tool_started");
    expect(types).toContain("tool_completed");
  });

  it("awaits an async approval provider before running shell calls", async () => {
    const engine = new AgentEngine(
      new MockLlmClient([
        { type: "tool_call", call: makeToolCall({ id: "shell-1", name: "shell_probe", input: { command: "pnpm install" } }) },
        { type: "done" }
      ]),
      {
        tools: {
          registry: makeRegistry(),
          context: { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false },
          requestApproval: async (call) => ({ callId: call.id, decision: "approved-once" })
        }
      }
    );

    const events = await collect(engine.startTurn({ threadId: "thread-1", turnId: "turn-1", text: "run shell" }));
    const types = events.map((event) => event.type);

    expect(types).toContain("approval_requested");
    expect(types).toContain("approval_decided");
    expect(types).toContain("tool_completed");
  });

  it("returns a structured failure for unknown tools", async () => {
    const engine = new AgentEngine(
      new MockLlmClient([{ type: "tool_call", call: makeToolCall({ name: "missing_tool" }) }, { type: "done" }]),
      {
        tools: {
          registry: makeRegistry(),
          context: { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false }
        }
      }
    );

    const events = await collect(engine.startTurn({ threadId: "thread-1", turnId: "turn-1", text: "run missing" }));
    const failed = events.find((event) => event.type === "tool_failed");

    expect(failed?.result.error?.code).toBe("tool_not_found");
  });

  it("throws a tool profile escalation before executing disallowed calls", async () => {
    const engine = new AgentEngine(
      new MockLlmClient([
        { type: "tool_call", call: makeToolCall({ id: "shell-1", name: "shell_probe", input: { command: "pnpm test" } }) },
        { type: "done" }
      ]),
      {
        tools: {
          registry: makeRegistry(),
          context: { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false },
          isToolCallAllowed: (call) => call.name !== "shell_probe"
        }
      }
    );

    await expect(collect(engine.startTurn({ threadId: "thread-1", turnId: "turn-1", text: "run shell" })))
      .rejects.toBeInstanceOf(ToolProfileEscalationError);
  });

  it("returns bad tool input as tool_failed and lets the model repair", async () => {
    const llm = new MultiTurnLlmClient([
      [
        { type: "tool_call", call: makeToolCall({ id: "bad-echo", name: "echo", input: {} }) },
        { type: "done", finishReason: "tool_calls" }
      ],
      [
        { type: "assistant_delta", text: "参数错误，已停止。" },
        { type: "done" }
      ]
    ]);
    const engine = new AgentEngine(llm, {
      tools: {
        registry: makeRegistry(),
        context: { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false }
      }
    });

    const events = await collect(engine.startTurn({ threadId: "thread-1", turnId: "turn-1", text: "run bad echo" }));
    const failed = events.find((event) => event.type === "tool_failed");

    expect(failed?.result).toMatchObject({
      callId: "bad-echo",
      ok: false,
      error: { code: "tool_execution_error" }
    });
    expect(events.map((event) => event.type)).not.toContain("turn_failed");
    expect(llm.inputs).toHaveLength(2);
    expect(llm.inputs[1].messages[llm.inputs[1].messages.length - 1]).toMatchObject({
      role: "tool",
      toolCallId: "bad-echo"
    });
  });

  it("does not cap the model tool loop unless maxModelIterations is explicit", async () => {
    const llm = new MultiTurnLlmClient([
      ...Array.from({ length: 5 }, (_, index) => [
        {
          type: "tool_call" as const,
          call: makeToolCall({
            id: `echo-${index + 1}`,
            input: { text: `step ${index + 1}` }
          })
        },
        { type: "done" as const, finishReason: "tool_calls" as const }
      ]),
      [
        { type: "assistant_delta", text: "工具循环已完成。" },
        { type: "done" }
      ]
    ]);
    const engine = new AgentEngine(llm, {
      tools: {
        registry: makeRegistry(),
        context: { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false }
      }
    });

    const events = await collect(engine.startTurn({ threadId: "thread-1", turnId: "turn-1", text: "run many tools" }));

    expect(events.map((event) => event.type)).not.toContain("turn_failed");
    expect(events.filter((event) => event.type === "tool_completed")).toHaveLength(5);
    expect(events.find((event) => event.type === "assistant_delta")).toMatchObject({ text: "工具循环已完成。" });
    expect(llm.inputs).toHaveLength(6);
  });

  it("emits turn_failed when the model provider throws", async () => {
    const engine = new AgentEngine(new FailingLlmClient("provider unavailable"));

    const events = await collect(engine.startTurn({ threadId: "thread-1", turnId: "turn-1", text: "hello" }));

    expect(events.map((event) => event.type)).toEqual(["user_message", "context_capacity", "coherence_state", "turn_failed"]);
    expect(events[3]).toMatchObject({ type: "turn_failed", message: "provider unavailable" });
  });

  it("emits turn_failed when the turn is stopped before the provider runs", async () => {
    const controller = new AbortController();
    controller.abort();
    const engine = new AgentEngine(new CapturingLlmClient());

    const events = await collect(engine.startTurn({
      threadId: "thread-1",
      turnId: "turn-1",
      text: "hello",
      signal: controller.signal
    }));

    expect(events.map((event) => event.type)).toEqual(["user_message", "context_capacity", "coherence_state", "turn_failed"]);
    expect(events[3]).toMatchObject({ type: "turn_failed", message: "已停止当前任务。" });
  });

  it("marks provider length finish reasons as turn failures", async () => {
    const engine = new AgentEngine(new MockLlmClient([{ type: "done", finishReason: "length" }]));

    const events = await collect(engine.startTurn({ threadId: "thread-1", turnId: "turn-1", text: "hello" }));

    expect(events.map((event) => event.type)).toEqual(["user_message", "context_capacity", "coherence_state", "turn_failed"]);
    expect(events[3]).toMatchObject({
      type: "turn_failed",
      message: "Model response stopped because it reached the provider length limit."
    });
  });
});

describe("runtimeEventsToLlmMessages", () => {
  it("builds compact model history from prior runtime events", () => {
    const events: RuntimeEvent[] = [
      runtimeEvent({ seq: 0, type: "user_message", text: "run tests" }),
      runtimeEvent({ seq: 1, type: "assistant_delta", text: "I will run them." }),
      runtimeEvent({
        seq: 2,
        type: "tool_completed",
        result: { callId: "shell-1", ok: true, output: { exitCode: 0 } }
      }),
      runtimeEvent({ seq: 3, type: "turn_completed" })
    ];

    expect(runtimeEventsToLlmMessages(events)).toEqual([
      { role: "user", content: "run tests" },
      {
        role: "assistant",
        content: 'I will run them.\n\n[tool:shell-1] {"callId":"shell-1","ok":true,"output":{"exitCode":0}}'
      }
    ]);
  });

  it("reconstructs reasoning_content with assistant tool calls and tool results from prior events", () => {
    const events: RuntimeEvent[] = [
      runtimeEvent({ seq: 0, type: "user_message", text: "inspect files" }),
      runtimeEvent({ seq: 1, type: "reasoning_delta", text: "Need to search first." }),
      runtimeEvent({ seq: 2, type: "assistant_delta", text: "I will search." }),
      runtimeEvent({
        seq: 3,
        type: "tool_call_requested",
        call: { id: "call-1", name: "grep_files", input: { pattern: "DeepSeek", path: "." } }
      }),
      runtimeEvent({
        seq: 4,
        type: "tool_completed",
        result: { callId: "call-1", ok: true, output: { matches: [{ path: "a.ts", line: "DeepSeek" }] } }
      }),
      runtimeEvent({ seq: 5, type: "assistant_delta", text: "Found one match." })
    ];

    expect(runtimeEventsToLlmMessages(events)).toEqual([
      { role: "user", content: "inspect files" },
      {
        role: "assistant",
        content: "I will search.",
        reasoningContent: "Need to search first.",
        toolCalls: [{ id: "call-1", name: "grep_files", input: { pattern: "DeepSeek", path: "." } }]
      },
      {
        role: "tool",
        toolCallId: "call-1",
        content: JSON.stringify({
          callId: "call-1",
          ok: true,
          output: { matches: [{ path: "a.ts", line: "DeepSeek" }] }
        })
      },
      { role: "assistant", content: "Found one match." }
    ]);
  });

  it("keeps restored tool-call history valid when reasoning_content is missing", () => {
    const events: RuntimeEvent[] = [
      runtimeEvent({ seq: 0, type: "user_message", text: "list files" }),
      runtimeEvent({
        seq: 1,
        type: "tool_call_requested",
        call: { id: "call-1", name: "list_dir", input: { path: "." } }
      }),
      runtimeEvent({
        seq: 2,
        type: "tool_completed",
        result: { callId: "call-1", ok: true, output: { entries: [] } }
      })
    ];

    expect(runtimeEventsToLlmMessages(events)).toEqual([
      { role: "user", content: "list files" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call-1", name: "list_dir", input: { path: "." } }]
      },
      {
        role: "tool",
        toolCallId: "call-1",
        content: JSON.stringify({ callId: "call-1", ok: true, output: { entries: [] } })
      }
    ]);
  });

  it("replays interaction requests and decisions into runtime history", () => {
    const events: RuntimeEvent[] = [
      runtimeEvent({ seq: 0, type: "user_message", text: "帮我规划" }),
      runtimeEvent({
        seq: 1,
        type: "interaction_requested",
        requestId: "request-1",
        title: "选择项目",
        message: "检测到多个项目。",
        recommendedOptionId: "ore-code",
        options: [
          { id: "ore-code", label: "Ore Code", value: "/repo/Ore Code" },
          { id: "custom", label: "其他" }
        ]
      }),
      runtimeEvent({
        seq: 2,
        type: "interaction_decided",
        requestId: "request-1",
        decision: { type: "option", optionId: "ore-code" }
      })
    ];

    expect(runtimeEventsToLlmMessages(events)).toEqual([
      { role: "user", content: "帮我规划" },
      {
        role: "assistant",
        content: [
          "[interaction_requested:request-1] 选择项目",
          "检测到多个项目。",
          "- ore-code: Ore Code (recommended) = /repo/Ore Code",
          "- custom: 其他"
        ].join("\n")
      },
      {
        role: "user",
        content: "[interaction_decided:request-1] User selected ore-code: /repo/Ore Code"
      }
    ]);
  });

  it("replays custom interaction decisions into runtime history", () => {
    const events: RuntimeEvent[] = [
      runtimeEvent({
        seq: 0,
        type: "interaction_decided",
        requestId: "request-1",
        decision: { type: "custom", customText: "使用 /tmp/custom" }
      })
    ];

    expect(runtimeEventsToLlmMessages(events)).toEqual([
      {
        role: "user",
        content: "[interaction_decided:request-1] User provided custom input: 使用 /tmp/custom"
      }
    ]);
  });

  it("replays subagent completion summaries into runtime history", () => {
    const events: RuntimeEvent[] = [
      runtimeEvent({ seq: 0, type: "user_message", text: "并行检查 auth" }),
      runtimeEvent({
        seq: 1,
        type: "subagent_completed",
        agentId: "agent-1",
        name: "auth",
        status: "completed",
        summary: "SUMMARY\nAuth flow checked.\nEVIDENCE\n- src/auth.ts:10",
        eventCount: 8
      })
    ];

    expect(runtimeEventsToLlmMessages(events)).toEqual([
      { role: "user", content: "并行检查 auth" },
      {
        role: "assistant",
        content: [
          "[subagent_completed:agent-1] auth completed",
          "Summary: SUMMARY\nAuth flow checked.\nEVIDENCE\n- src/auth.ts:10",
          "Events: 8"
        ].join("\n")
      }
    ]);
  });

  it("marks failed shell results in prior runtime history", () => {
    const events: RuntimeEvent[] = [
      runtimeEvent({ seq: 0, type: "user_message", text: "run command" }),
      runtimeEvent({
        seq: 1,
        type: "tool_completed",
        result: { callId: "shell-1", ok: true, output: { exitCode: 127, timedOut: false } }
      })
    ];

    expect(runtimeEventsToLlmMessages(events)[1].content).toContain('"modelStatus":"failed"');
    expect(runtimeEventsToLlmMessages(events)[1].content).toContain("Shell command exited with non-zero status 127");
  });

  it("keeps the most recent messages inside message and character budgets", () => {
    const events: RuntimeEvent[] = [
      runtimeEvent({ seq: 0, type: "user_message", text: "first" }),
      runtimeEvent({ seq: 1, type: "assistant_delta", text: "first answer" }),
      runtimeEvent({ seq: 2, type: "user_message", text: "second" }),
      runtimeEvent({ seq: 3, type: "assistant_delta", text: "second answer" }),
      runtimeEvent({ seq: 4, type: "user_message", text: "third" })
    ];

    const context = buildRuntimeContext(events, { maxMessages: 2, maxChars: 200 });

    expect(context.messages).toEqual([
      { role: "assistant", content: "second answer" },
      { role: "user", content: "third" }
    ]);
    expect(context.omittedMessages).toBe(3);
    expect(context.truncated).toBe(true);
  });

  it("drops orphaned tool messages when history truncation omits their assistant tool-call message", () => {
    const events: RuntimeEvent[] = [
      runtimeEvent({ seq: 0, type: "user_message", text: "search" }),
      runtimeEvent({
        seq: 1,
        type: "tool_call_requested",
        call: { id: "call-1", name: "grep_files", input: { pattern: "x", path: "." } }
      }),
      runtimeEvent({
        seq: 2,
        type: "tool_completed",
        result: { callId: "call-1", ok: true, output: { matches: [{ path: "a.ts", line: "x" }] } }
      }),
      runtimeEvent({ seq: 3, type: "assistant_delta", text: "done" })
    ];

    const context = buildRuntimeContext(events, { maxMessages: 2, maxChars: 500 });

    expect(context.messages[0].role).not.toBe("tool");
    expect(context.messages).toEqual([{ role: "assistant", content: "done" }]);
  });

  it("does not apply the old 24 message or 32K character defaults for DeepSeek V4", () => {
    const events: RuntimeEvent[] = [];
    for (let index = 0; index < 30; index += 1) {
      events.push(runtimeEvent({ seq: index * 2, type: "user_message", text: `question ${index} ${"x".repeat(1_200)}` }));
      events.push(runtimeEvent({ seq: index * 2 + 1, type: "assistant_delta", text: `answer ${index} ${"y".repeat(1_200)}` }));
    }

    const context = buildRuntimeContext(events, { model: "deepseek-v4-pro" });

    expect(context.truncated).toBe(false);
    expect(context.omittedMessages).toBe(0);
    expect(context.messages).toHaveLength(60);
  });

	  it("compresses omitted history into a semantic summary message when enabled", () => {
    const events: RuntimeEvent[] = [
      runtimeEvent({ seq: 0, type: "user_message", text: "first goal: preserve architecture notes" }),
      runtimeEvent({ seq: 1, type: "assistant_delta", text: "first answer: use the existing runtime store" }),
      runtimeEvent({ seq: 2, type: "user_message", text: "second goal: keep restore reversible" }),
      runtimeEvent({ seq: 3, type: "assistant_delta", text: "second answer" }),
      runtimeEvent({ seq: 4, type: "user_message", text: "third" })
    ];

    const context = buildRuntimeContext(events, {
      compression: "semantic",
      maxMessages: 4,
      maxChars: 500,
      verbatimWindowTurns: 1
    });

    expect(context.compressed).toBe(true);
    expect(context.summaryChars).toBeGreaterThan(0);
    expect(context.omittedMessages).toBeGreaterThan(0);
    expect(context.messages[0]).toMatchObject({ role: "system" });
	    expect(context.messages[0].content).toContain("Earlier conversation compressed");
	    expect(context.messages[0].content).toContain("Progress");
	    expect(context.messages[0].content).toContain("Next step");
	    expect(context.messages[0].content).toContain("preserve architecture notes");
	    expect(context.messages[context.messages.length - 1]).toEqual({ role: "user", content: "third" });
	  });

	  it("derives a working set from recent paths and tool calls", () => {
	    const context = buildRuntimeContext([
	      runtimeEvent({ seq: 0, type: "user_message", text: "Update packages/agent-core/src/prompts.ts" }),
	      runtimeEvent({
	        seq: 1,
	        type: "tool_call_requested",
	        call: { id: "call-1", name: "read_file", input: { path: "packages/agent-core/src/prompts.ts" } }
	      }),
	      runtimeEvent({ seq: 2, type: "assistant_delta", text: "Read packages/agent-core/src/prompts.ts." })
	    ], { compression: "semantic" });

	    expect(context.workingSetPaths).toContain("packages/agent-core/src/prompts.ts");
	    expect(context.workingSetSummary).toContain("read_file");
	  });

  it("truncates large tool results before sending history to the model", () => {
    const events: RuntimeEvent[] = [
      runtimeEvent({ seq: 0, type: "user_message", text: "run command" }),
      runtimeEvent({
        seq: 1,
        type: "tool_completed",
        result: { callId: "shell-1", ok: true, output: { stdout: "x".repeat(200) } }
      })
    ];

    const context = buildRuntimeContext(events, { toolResultMaxChars: 80 });

    expect(context.messages[1].content).toContain("[tool:shell-1]");
    expect(context.messages[1].content).toContain("[truncated");
  });

  it("uses lower default history limits for shell output than search-like output", () => {
    const shellContext = buildRuntimeContext([
      runtimeEvent({ seq: 0, type: "user_message", text: "run command" }),
      runtimeEvent({
        seq: 1,
        type: "tool_completed",
        result: { callId: "exec_shell", ok: true, output: { stdout: "x".repeat(3_000), stderr: "" } }
      })
    ]);
    const grepContext = buildRuntimeContext([
      runtimeEvent({ seq: 0, type: "user_message", text: "search" }),
      runtimeEvent({
        seq: 1,
        type: "tool_completed",
        result: {
          callId: "grep_files",
          ok: true,
          output: { matches: [{ path: "a.ts", lineNumber: 1, line: "x".repeat(3_000), matchStart: 0, matchEnd: 1 }] }
        }
      })
    ]);

    expect(shellContext.messages[1].content).toContain("[truncated");
    expect(grepContext.messages[1].content).not.toContain("[truncated");
  });

  it("keeps artifact history to summaries and ids instead of restored raw output", () => {
    const context = buildRuntimeContext([
      runtimeEvent({ seq: 0, type: "user_message", text: "read artifact output" }),
      runtimeEvent({
        seq: 1,
        type: "tool_completed",
        result: {
          callId: "long-output",
          ok: true,
          artifactId: "artifact-1",
          output: {
            stdout: "raw-output-should-not-return".repeat(200),
            artifactSummary: "large shell output"
          }
        }
      })
    ]);

    expect(context.messages[1].content).toContain("artifact-1");
    expect(context.messages[1].content).toContain("large shell output");
    expect(context.messages[1].content).not.toContain("raw-output-should-not-return");
  });

  it("can omit tool results from model history", () => {
    const events: RuntimeEvent[] = [
      runtimeEvent({ seq: 0, type: "user_message", text: "run command" }),
      runtimeEvent({
        seq: 1,
        type: "tool_completed",
        result: { callId: "shell-1", ok: true, output: { stdout: "ok" } }
      })
    ];

    expect(buildRuntimeContext(events, { includeToolResults: false }).messages).toEqual([
      { role: "user", content: "run command" }
    ]);
  });
});

const LongShellOutputTool = {
  name: "long_shell_output",
  description: "Harness-only long shell output probe.",
  capability: "readonly",
  approval: "never",
  inputSchema: z.object({}),
  async execute() {
    return {
      callId: "long_shell_output",
      ok: true,
      output: {
        stdout: "x".repeat(40),
        stderr: "err",
        stdoutTruncated: false,
        stderrTruncated: false
      }
    };
  }
} as const;

const FailingShellOutputTool = {
  name: "failing_shell_output",
  description: "Harness-only failing shell output probe.",
  capability: "readonly",
  approval: "never",
  inputSchema: z.object({}),
  async execute() {
    return {
      callId: "failing_shell_output",
      ok: true,
      output: {
        command: "missing-command",
        exitCode: 127,
        stdout: "",
        stderr: "not found",
        timedOut: false
      }
    };
  }
} as const;

const LongMcpOutputTool = {
  name: "long_mcp_output",
  description: "Harness-only long MCP output probe.",
  capability: "readonly",
  approval: "never",
  inputSchema: z.object({}),
  async execute() {
    return {
      callId: "long_mcp_output",
      ok: true,
      output: {
        server: "fake",
        tool: "read_context",
        content: "x".repeat(40),
        isError: false
      }
    };
  }
} as const;

const UsageOutputTool = {
  name: "usage_output",
  description: "Harness-only usage output probe.",
  capability: "readonly",
  approval: "never",
  inputSchema: z.object({}),
  async execute() {
    return {
      callId: "usage_output",
      ok: true,
      output: {
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
      }
    };
  }
} as const;

const LongGrepOutputTool = {
  name: "long_grep_output",
  description: "Harness-only long grep output probe.",
  capability: "readonly",
  approval: "never",
  inputSchema: z.object({}),
  async execute() {
    return {
      callId: "long_grep_output",
      ok: true,
      output: {
        matches: [
          { path: "a.ts", lineNumber: 1, line: "very long matched line ".repeat(20), matchStart: 0, matchEnd: 4 },
          { path: "b.ts", lineNumber: 2, line: "another very long matched line ".repeat(20), matchStart: 0, matchEnd: 7 }
        ],
        truncated: false
      }
    };
  }
} as const;

const LongFetchOutputTool = {
  name: "long_fetch_output",
  description: "Harness-only long web fetch output probe.",
  capability: "readonly",
  approval: "never",
  inputSchema: z.object({}),
  async execute() {
    return {
      callId: "long_fetch_output",
      ok: true,
      output: {
        url: "https://example.com",
        finalUrl: "https://example.com",
        status: 200,
        ok: true,
        contentType: "text/plain",
        title: "Example",
        text: "web body ".repeat(20),
        truncated: false,
        citation: { id: "web:1", url: "https://example.com", source: "fetch_url", title: "Example" }
      }
    };
  }
} as const;

const LongGitDiffOutputTool = {
  name: "long_git_diff_output",
  description: "Harness-only long git diff output probe.",
  capability: "readonly",
  approval: "never",
  inputSchema: z.object({}),
  async execute() {
    return {
      callId: "long_git_diff_output",
      ok: true,
      output: {
        isRepo: true,
        diff: "+large diff line\n".repeat(20),
        staged: false,
        truncated: false
      }
    };
  }
} as const;

class CapturingArtifactSink implements ArtifactSink {
  readonly records: Array<{
    type: ArtifactMetadata["type"];
    content: string;
    summary: string;
    sourceCallId?: string;
  }> = [];

  async write(input: {
    type: ArtifactMetadata["type"];
    content: string;
    summary: string;
    sourceCallId?: string;
  }): Promise<ArtifactMetadata> {
    this.records.push(input);
    return {
      id: `artifact-${this.records.length}`,
      type: input.type,
      size: input.content.length,
      createdAt: "2026-05-09T00:00:00.000Z",
      summary: input.summary,
      sourceCallId: input.sourceCallId
    };
  }

  async read(id: string): Promise<ArtifactRecord> {
    const index = Number(id.replace(/^artifact-/, "")) - 1;
    const record = this.records[index];
    if (!record) {
      throw new Error(`Artifact not found: ${id}`);
    }

    return {
      id,
      type: record.type,
      size: record.content.length,
      createdAt: "2026-05-09T00:00:00.000Z",
      summary: record.summary,
      sourceCallId: record.sourceCallId,
      content: record.content
    };
  }
}

class FailingLlmClient implements LlmClient {
  constructor(private readonly message: string) {}

  async *streamTurn(): AsyncIterable<ModelStreamChunk> {
    throw new Error(this.message);
  }
}

class CapturingLlmClient implements LlmClient {
  input?: Parameters<LlmClient["streamTurn"]>[0];

  async *streamTurn(input: Parameters<LlmClient["streamTurn"]>[0]): AsyncIterable<ModelStreamChunk> {
    this.input = input;
    yield { type: "done" };
  }
}

class WarmupCapturingLlmClient extends CapturingLlmClient {
  readonly warmups: LlmWarmupInput[] = [];

  async warmupPrefix(input: LlmWarmupInput) {
    this.warmups.push(input);
    return {
      model: "deepseek-v4-pro",
      promptTokens: 100,
      completionTokens: 1,
      totalTokens: 101,
      cachedTokens: 0
    };
  }
}

class MultiTurnLlmClient implements LlmClient {
  readonly inputs: Array<Parameters<LlmClient["streamTurn"]>[0]> = [];

  constructor(private readonly turns: ModelStreamChunk[][]) {}

  async *streamTurn(input: Parameters<LlmClient["streamTurn"]>[0]): AsyncIterable<ModelStreamChunk> {
    this.inputs.push(input);
    const chunks = this.turns[this.inputs.length - 1] ?? [{ type: "done" }];
    for (const chunk of chunks) {
      yield chunk;
    }
  }
}

function runtimeEvent(body: Record<string, unknown> & { seq: number; type: RuntimeEvent["type"] }): RuntimeEvent {
  return {
    id: `event-${body.seq}`,
    threadId: "thread-1",
    turnId: "turn-1",
    createdAt: "2026-05-09T00:00:00.000Z",
    ...body
  } as RuntimeEvent;
}
