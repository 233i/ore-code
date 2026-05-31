import { describe, expect, it } from "vitest";
import { buildRuntimeContext } from "@seekforge/agent-core";
import {
  createFileTools,
  createGitTools,
  createRunTestsTool,
  createShellJobTools,
  createShellTool,
  EchoTool,
  ToolRegistry,
  type FileToolHost,
  type FileSearchOutput,
  type GrepFilesOutput,
  type GitBranchHostOutput,
  type GitDiffHostOutput,
  type GitStatusHostOutput,
  type GitTextHostOutput,
  type GitToolHost,
  type ListDirOutput,
  type ReadFileOutput,
  type ShellJobStartOutput,
  type ShellJobToolHost,
  type ShellRunOutput,
  type ShellToolHost,
  type WriteFileOutput
} from "@seekforge/tools";
import { eventsFromJsonl, eventsToJsonl } from "@seekforge/state";
import type { RuntimeEvent } from "@seekforge/protocol";
import { OpenAiCompatibleLlmClient, type FetchInit, type StreamResponse } from "@seekforge/agent-core";
import { replayEvents } from "./replay";
import { runScenario, ScriptedLlmClient } from "./scenario";

const encoder = new TextEncoder();

describe("scenario harness", () => {
  it("runs and replays a simple streaming turn", async () => {
    const events = await runScenario({
      name: "hello",
      input: "hello",
      chunks: [
        { type: "assistant_delta", text: "Hi" },
        { type: "assistant_delta", text: " there" },
        { type: "done", finalText: "." }
      ]
    });

    const snapshot = replayEvents(events);

    expect(snapshot.completed).toBe(true);
    expect(snapshot.assistantText).toBe("Hi there.");
  });

  it("can replay a scenario with a completed tool call", async () => {
    const registry = new ToolRegistry();
    registry.register(EchoTool);

    const events = await runScenario({
      name: "tool-call",
      input: "run echo",
      chunks: [
        {
          type: "tool_call",
          call: { id: "echo-1", name: "echo", input: { text: "ok" } }
        },
        { type: "done", finalText: "done" }
      ],
      engineOptions: {
        tools: {
          registry,
          context: { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false }
        }
      }
    });

    const types = events.map((event) => event.type);

    expect(types).toContain("tool_call_requested");
    expect(types).toContain("tool_completed");
  });

  it("runs a coding-loop scenario across read, edit, shell, and final answer turns", async () => {
    const files = new Map([
      [
        "src/math.ts",
        "export function add(a: number, b: number) {\n  return a - b;\n}\n"
      ]
    ]);
    const fileHost = new MemoryFileHost(files);
    const shellHost = new ScenarioShellHost(files);
    const registry = new ToolRegistry();
    for (const tool of createFileTools(fileHost)) {
      registry.register(tool);
    }
    for (const tool of createGitTools(new ScenarioGitHost(files))) {
      registry.register(tool);
    }
    registry.register(createShellTool(shellHost));
    registry.register(createRunTestsTool(shellHost));

    const llm = new ScriptedLlmClient([
      [
        {
          type: "tool_call",
          call: { id: "read-1", name: "read_file", input: { path: "src/math.ts" } }
        },
        { type: "done", finishReason: "tool_calls" }
      ],
      [
        {
          type: "tool_call",
          call: {
            id: "edit-1",
            name: "edit_file",
            input: {
              path: "src/math.ts",
              oldText: "return a - b;",
              newText: "return a + b;"
            }
          }
        },
        { type: "done", finishReason: "tool_calls" }
      ],
      [
        {
          type: "tool_call",
          call: { id: "test-1", name: "run_tests", input: { command: "pnpm test", timeoutMs: 30_000 } }
        },
        { type: "done", finishReason: "tool_calls" }
      ],
      [
        {
          type: "tool_call",
          call: { id: "diff-1", name: "git_diff", input: {} }
        },
        { type: "done", finishReason: "tool_calls" }
      ],
      [
        { type: "assistant_delta", text: "已修复 add 实现，通过测试，并读取了 diff。" },
        { type: "done" }
      ]
    ]);

    const events = await runScenario({
      name: "coding-loop",
      input: "修复 src/math.ts 并运行测试",
      llm,
      engineOptions: {
        maxModelIterations: 5,
        tools: {
          registry,
          context: { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false },
          approvals: [
            { callId: "edit-1", decision: "approved-once" },
            { callId: "test-1", decision: "approved-once" }
          ]
        }
      }
    });

    const snapshot = replayEvents(events);
    const completedTools = events.filter((event) => event.type === "tool_completed");

    expect(snapshot.completed).toBe(true);
    expect(snapshot.assistantText).toBe("已修复 add 实现，通过测试，并读取了 diff。");
    expect(files.get("src/math.ts")).toContain("return a + b;");
    expect(completedTools.map((event) => event.result.callId)).toEqual(["read-1", "edit-1", "test-1", "diff-1"]);
    expect(llm.inputs).toHaveLength(5);
    const finalFollowUpMessages = llm.inputs[4].messages;
    expect(finalFollowUpMessages[finalFollowUpMessages.length - 1]).toMatchObject({
      role: "tool",
      toolCallId: "diff-1"
    });
  });

  it("runs a background shell job scenario across start, status, output, and final answer turns", async () => {
    const jobHost = new ScenarioShellJobHost();
    const registry = new ToolRegistry();
    for (const tool of createShellJobTools(jobHost)) {
      registry.register(tool);
    }

    const llm = new ScriptedLlmClient([
      [
        {
          type: "tool_call",
          call: {
            id: "job-start-1",
            name: "start_shell_job",
            input: { command: "pnpm test", timeoutMs: 300_000 }
          }
        },
        { type: "done", finishReason: "tool_calls" }
      ],
      [
        {
          type: "tool_call",
          call: {
            id: "job-status-1",
            name: "shell_job_status",
            input: { jobId: "job-1" }
          }
        },
        { type: "done", finishReason: "tool_calls" }
      ],
      [
        {
          type: "tool_call",
          call: {
            id: "job-output-1",
            name: "shell_job_output",
            input: { jobId: "job-1" }
          }
        },
        { type: "done", finishReason: "tool_calls" }
      ],
      [
        { type: "assistant_delta", text: "后台测试任务已完成，输出显示 tests passed。" },
        { type: "done" }
      ]
    ]);

    const events = await runScenario({
      name: "background-shell-job-loop",
      input: "后台运行 pnpm test 并读取结果",
      llm,
      engineOptions: {
        maxModelIterations: 4,
        tools: {
          registry,
          context: { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false },
          approvals: [{ callId: "job-start-1", decision: "approved-once" }]
        }
      }
    });

    const snapshot = replayEvents(events);
    const completedTools = events.filter((event) => event.type === "tool_completed");
    const statusResult = completedTools.find((event) => event.result.callId === "job-status-1")?.result.output;
    const outputResult = completedTools.find((event) => event.result.callId === "job-output-1")?.result.output;

    expect(snapshot.completed).toBe(true);
    expect(snapshot.assistantText).toBe("后台测试任务已完成，输出显示 tests passed。");
    expect(jobHost.startedCommands).toEqual(["pnpm test"]);
    expect(completedTools.map((event) => event.result.callId)).toEqual([
      "job-start-1",
      "job-status-1",
      "job-output-1"
    ]);
    expect(statusResult).toMatchObject({
      id: "job-1",
      status: "completed",
      exitCode: 0
    });
    expect(statusResult).not.toHaveProperty("stdout");
    expect(outputResult).toMatchObject({
      id: "job-1",
      stdout: "tests passed\n",
      stderr: ""
    });
    expect(llm.inputs).toHaveLength(4);
  });

  it("runs an OpenAI-compatible provider coding loop across streamed tool calls", async () => {
    const files = new Map([
      [
        "src/math.ts",
        "export function add(a: number, b: number) {\n  return a - b;\n}\n"
      ]
    ]);
    const registry = new ToolRegistry();
    for (const tool of createFileTools(new MemoryFileHost(files))) {
      registry.register(tool);
    }
    const shellHost = new ScenarioShellHost(files);
    registry.register(createShellTool(shellHost));
    registry.register(createRunTestsTool(shellHost));

    const requests: Array<{ url: string; init: FetchInit }> = [];
    const client = new OpenAiCompatibleLlmClient({
      apiKey: "test-key",
      baseUrl: "https://provider.example/v1",
      model: "deepseek-chat",
      fetch: async (url, init) => {
        requests.push({ url, init });
        return streamResponse(providerTurn(requests.length));
      }
    });

    const events = await runScenario({
      name: "provider-coding-loop",
      input: "修复 src/math.ts 并运行测试",
      llm: client,
      engineOptions: {
        maxModelIterations: 4,
        tools: {
          registry,
          context: { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false },
          approvals: [{ callId: "edit-1", decision: "approved-once" }]
        }
      }
    });

    const snapshot = replayEvents(events);
    const completedTools = events.filter((event) => event.type === "tool_completed");
    const requestBodies = requests.map((request) => JSON.parse(request.init.body));

    expect(snapshot.completed).toBe(true);
    expect(snapshot.assistantText).toBe("已修复 add 实现，并通过测试。");
    expect(files.get("src/math.ts")).toContain("return a + b;");
    expect(completedTools.map((event) => event.result.callId)).toEqual(["read-1", "edit-1", "test-1"]);
    expect(requests).toHaveLength(4);
    expect(requests[0].url).toBe("https://provider.example/v1/chat/completions");
    expect(requestBodies[0].tools.map((tool: { function: { name: string } }) => tool.function.name)).toContain(
      "read_file"
    );
    expect(lastMessage(requestBodies[1].messages)).toMatchObject({
      role: "tool",
      tool_call_id: "read-1"
    });
    expect(lastMessage(requestBodies[2].messages)).toMatchObject({
      role: "tool",
      tool_call_id: "edit-1"
    });
    expect(lastMessage(requestBodies[3].messages)).toMatchObject({
      role: "tool",
      tool_call_id: "test-1"
    });
  });
});

describe("MVP scenarios from docs/04-harness-engineering.md", () => {
  it("1. analyzes a project read-only and returns a plan", async () => {
    const files = new Map([
      ["package.json", "{\"scripts\":{\"test\":\"vitest\"}}\n"],
      ["src/app.ts", "export const app = true;\n"]
    ]);
    const registry = fileRegistry(files);
    const llm = new ScriptedLlmClient([
      [
        { type: "reasoning_delta", text: "先只读查看项目结构。" },
        { type: "tool_call", call: { id: "list-1", name: "list_dir", input: { path: "." } } },
        { type: "done", finishReason: "tool_calls" }
      ],
      [
        { type: "assistant_delta", text: "计划：先阅读入口，再检查测试脚本，最后提出修改建议。" },
        { type: "done" }
      ]
    ]);

    const events = await runScenario({
      name: "mvp-readonly-plan",
      input: "分析项目并给出计划",
      llm,
      engineOptions: {
        tools: {
          registry,
          context: { workspacePath: "/workspace", mode: "plan", trustedWorkspace: false }
        }
      }
    });

    expect(replayEvents(events)).toMatchObject({
      completed: true,
      assistantText: "计划：先阅读入口，再检查测试脚本，最后提出修改建议。"
    });
    expect(toolResults(events, "tool_completed").map((event) => event.result.callId)).toEqual(["list-1"]);
    expect(events.map((event) => event.type)).not.toContain("approval_requested");
    expect(files.get("src/app.ts")).toBe("export const app = true;\n");
  });

  it("2. reads a file and answers from the tool result", async () => {
    const files = new Map([["src/config.ts", "export const port = 5173;\n"]]);
    const registry = fileRegistry(files);
    const llm = new ScriptedLlmClient([
      [
        { type: "tool_call", call: { id: "read-1", name: "read_file", input: { path: "src/config.ts" } } },
        { type: "done", finishReason: "tool_calls" }
      ],
      [
        { type: "assistant_delta", text: "src/config.ts 中配置的端口是 5173。" },
        { type: "done" }
      ]
    ]);

    const events = await runScenario({
      name: "mvp-read-file-answer",
      input: "src/config.ts 里端口是多少？",
      llm,
      engineOptions: {
        tools: {
          registry,
          context: { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false }
        }
      }
    });

    expect(replayEvents(events).assistantText).toBe("src/config.ts 中配置的端口是 5173。");
    expect(lastToolResult(events, "read-1")?.output).toMatchObject({
      path: "src/config.ts",
      content: "export const port = 5173;\n"
    });
    expect(llm.inputs[1].messages[llm.inputs[1].messages.length - 1]).toMatchObject({ role: "tool", toolCallId: "read-1" });
  });

  it("3. edits one file and shows the resulting diff", async () => {
    const files = new Map([["src/math.ts", "export const add = (a: number, b: number) => a - b;\n"]]);
    const registry = fileGitRegistry(files);
    const llm = new ScriptedLlmClient([
      [
        {
          type: "tool_call",
          call: {
            id: "edit-1",
            name: "edit_file",
            input: {
              path: "src/math.ts",
              oldText: "a - b",
              newText: "a + b"
            }
          }
        },
        { type: "done", finishReason: "tool_calls" }
      ],
      [
        { type: "tool_call", call: { id: "diff-1", name: "git_diff", input: { path: "src/math.ts" } } },
        { type: "done", finishReason: "tool_calls" }
      ],
      [
        { type: "assistant_delta", text: "已修复加法实现，并展示了 src/math.ts 的 diff。" },
        { type: "done" }
      ]
    ]);

    const events = await runScenario({
      name: "mvp-edit-and-diff",
      input: "修复 src/math.ts 并展示 diff",
      llm,
      engineOptions: {
        maxModelIterations: 3,
        tools: {
          registry,
          context: { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false },
          approvals: [{ callId: "edit-1", decision: "approved-once" }]
        }
      }
    });

    expect(files.get("src/math.ts")).toContain("a + b");
    expect(lastToolResult(events, "diff-1")?.output).toMatchObject({
      diff: expect.stringContaining("+  return a + b;")
    });
    expect(replayEvents(events).completed).toBe(true);
  });

  it("4. requests approval for shell and runs it after approval", async () => {
    const registry = new ToolRegistry();
    registry.register(createShellTool(new StaticShellHost({ stdout: "installed\n" })));

    const events = await runScenario({
      name: "mvp-shell-approved",
      input: "安装依赖",
      chunks: [
        {
          type: "tool_call",
          call: { id: "shell-1", name: "exec_shell", input: { command: "pnpm install" } }
        },
        { type: "done", finalText: "依赖安装完成。" }
      ],
      engineOptions: {
        tools: {
          registry,
          context: { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false },
          approvals: [{ callId: "shell-1", decision: "approved-once" }]
        }
      }
    });

    expect(events.map((event) => event.type)).toEqual([
      "user_message",
      "context_capacity",
      "coherence_state",
      "tool_call_requested",
      "approval_requested",
      "approval_decided",
      "tool_started",
      "tool_completed",
      "assistant_message",
      "turn_completed",
      "token_usage"
    ]);
    expect(lastToolResult(events, "shell-1")?.output).toMatchObject({ exitCode: 0, stdout: "installed\n" });
  });

  it("5. lets the model continue explaining after shell approval is denied", async () => {
    const registry = new ToolRegistry();
    registry.register(createShellTool(new StaticShellHost({ stdout: "should not run\n" })));
    const llm = new ScriptedLlmClient([
      [
        {
          type: "tool_call",
          call: { id: "shell-1", name: "exec_shell", input: { command: "pnpm install" } }
        },
        { type: "done", finishReason: "tool_calls" }
      ],
      [
        { type: "assistant_delta", text: "你拒绝了 shell 执行，我不会修改环境；可以改为只读检查 package.json。" },
        { type: "done" }
      ]
    ]);

    const events = await runScenario({
      name: "mvp-shell-denied-continues",
      input: "安装依赖",
      llm,
      engineOptions: {
        tools: {
          registry,
          context: { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false },
          requestApproval: async (call) => ({ callId: call.id, decision: "denied" })
        }
      }
    });

    expect(toolResults(events, "tool_failed")[0]?.result.error?.code).toBe("approval_denied");
    expect(events.map((event) => event.type)).not.toContain("tool_started");
    expect(replayEvents(events).assistantText).toBe("你拒绝了 shell 执行，我不会修改环境；可以改为只读检查 package.json。");
    expect(llm.inputs).toHaveLength(2);
  });

  it("6. reports command timeouts as visible structured shell output", async () => {
    const registry = new ToolRegistry();
    registry.register(createShellTool(new TimeoutShellHost()));
    const llm = new ScriptedLlmClient([
      [
        {
          type: "tool_call",
          call: { id: "shell-timeout-1", name: "exec_shell", input: { command: "pnpm test", timeoutMs: 1 } }
        },
        { type: "done", finishReason: "tool_calls" }
      ],
      [
        { type: "assistant_delta", text: "命令超时，已停止等待；请缩小测试范围或提高 timeout。" },
        { type: "done" }
      ]
    ]);

    const events = await runScenario({
      name: "mvp-shell-timeout",
      input: "运行测试，超时时说明原因",
      llm,
      engineOptions: {
        tools: {
          registry,
          context: { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false }
        }
      }
    });

    expect(lastToolResult(events, "shell-timeout-1")?.output).toMatchObject({
      command: "pnpm test",
      exitCode: null,
      timedOut: true,
      stderr: "command timed out after 1ms\n"
    });
    expect(replayEvents(events).assistantText).toBe("命令超时，已停止等待；请缩小测试范围或提高 timeout。");
  });

  it("7. recovers from malformed tool input and lets the model respond", async () => {
    const registry = new ToolRegistry();
    registry.register(EchoTool);
    const llm = new ScriptedLlmClient([
      [
        { type: "tool_call", call: { id: "bad-echo-1", name: "echo", input: {} } },
        { type: "done", finishReason: "tool_calls" }
      ],
      [
        { type: "assistant_delta", text: "工具参数不合法，我已停止该调用并说明需要 text 字段。" },
        { type: "done" }
      ]
    ]);

    const events = await runScenario({
      name: "mvp-malformed-tool-call",
      input: "调用一个参数不完整的工具",
      llm,
      engineOptions: {
        tools: {
          registry,
          context: { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false }
        }
      }
    });

    expect(toolResults(events, "tool_failed")[0]?.result).toMatchObject({
      callId: "bad-echo-1",
      ok: false,
      error: { code: "tool_execution_error" }
    });
    expect(replayEvents(events)).toMatchObject({
      completed: true,
      assistantText: "工具参数不合法，我已停止该调用并说明需要 text 字段。"
    });
  });

  it("8. saves a session as JSONL and restores it through replay/history", async () => {
    const events = await runScenario({
      name: "mvp-session-save-restore",
      input: "保存并恢复会话",
      chunks: [
        { type: "assistant_delta", text: "会话事件可以保存为 JSONL。" },
        { type: "done" }
      ]
    });

    const restoredEvents = eventsFromJsonl(eventsToJsonl(events));
    const snapshot = replayEvents(restoredEvents);
    const context = buildRuntimeContext(restoredEvents);

    expect(restoredEvents).toEqual(events);
    expect(snapshot).toMatchObject({
      completed: true,
      assistantText: "会话事件可以保存为 JSONL。"
    });
    expect(context.messages).toEqual([
      { role: "user", content: "保存并恢复会话" },
      { role: "assistant", content: "会话事件可以保存为 JSONL。" }
    ]);
  });

  it("9. requires approval for writes in plan mode", async () => {
    const files = new Map([["notes.md", "original\n"]]);
    const registry = fileRegistry(files);
    const llm = new ScriptedLlmClient([
      [
        {
          type: "tool_call",
          call: { id: "write-1", name: "write_file", input: { path: "notes.md", content: "changed\n" } }
        },
        { type: "done", finishReason: "tool_calls" }
      ],
      [
        { type: "assistant_delta", text: "Plan 模式需要审批写文件；未审批时不会修改。" },
        { type: "done" }
      ]
    ]);

    const events = await runScenario({
      name: "mvp-plan-requires-approval-for-write",
      input: "改 notes.md",
      llm,
      engineOptions: {
        tools: {
          registry,
          context: { workspacePath: "/workspace", mode: "plan", trustedWorkspace: false }
        }
      }
    });

    expect(files.get("notes.md")).toBe("original\n");
    expect(toolResults(events, "tool_failed")[0]?.result.error?.code).toBe("approval_required");
    expect(events.map((event) => event.type)).toContain("approval_requested");
    expect(replayEvents(events).assistantText).toBe("Plan 模式需要审批写文件；未审批时不会修改。");
  });

  it("10. allows YOLO writes without approval", async () => {
    const untrustedFiles = new Map([["notes.md", "original\n"]]);
    const trustedFiles = new Map([["notes.md", "original\n"]]);
    const writeCall = {
      id: "write-1",
      name: "write_file",
      input: { path: "notes.md", content: "changed\n" }
    };

    const untrustedEvents = await runScenario({
      name: "mvp-yolo-untrusted",
      input: "YOLO 写 notes.md",
      chunks: [{ type: "tool_call", call: writeCall }, { type: "done" }],
      engineOptions: {
        tools: {
          registry: fileRegistry(untrustedFiles),
          context: { workspacePath: "/workspace", mode: "yolo", trustedWorkspace: false }
        }
      }
    });

    const trustedEvents = await runScenario({
      name: "mvp-yolo-trusted",
      input: "YOLO 写 notes.md",
      chunks: [{ type: "tool_call", call: writeCall }, { type: "done" }],
      engineOptions: {
        tools: {
          registry: fileRegistry(trustedFiles),
          context: { workspacePath: "/workspace", mode: "yolo", trustedWorkspace: true }
        }
      }
    });

    expect(untrustedFiles.get("notes.md")).toBe("changed\n");
    expect(toolResults(untrustedEvents, "tool_completed")[0]?.result.callId).toBe("write-1");
    expect(trustedFiles.get("notes.md")).toBe("changed\n");
    expect(toolResults(trustedEvents, "tool_completed")[0]?.result.callId).toBe("write-1");
    expect(untrustedEvents.map((event) => event.type)).not.toContain("approval_requested");
    expect(trustedEvents.map((event) => event.type)).not.toContain("approval_requested");
  });
});

function fileRegistry(files: Map<string, string>): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of createFileTools(new MemoryFileHost(files))) {
    registry.register(tool);
  }
  return registry;
}

function fileGitRegistry(files: Map<string, string>): ToolRegistry {
  const registry = fileRegistry(files);
  for (const tool of createGitTools(new ScenarioGitHost(files))) {
    registry.register(tool);
  }
  return registry;
}

function toolResults<T extends "tool_completed" | "tool_failed">(events: RuntimeEvent[], type: T) {
  return events.filter((event): event is Extract<RuntimeEvent, { type: T }> => event.type === type);
}

function lastToolResult(events: RuntimeEvent[], callId: string) {
  return toolResults(events, "tool_completed").find((event) => event.result.callId === callId)?.result;
}

class MemoryFileHost implements FileToolHost {
  constructor(private readonly files: Map<string, string>) {}

  async readText(input: { path: string }): Promise<ReadFileOutput> {
    const content = this.files.get(input.path);
    if (content === undefined) {
      throw new Error(`Missing file: ${input.path}`);
    }
    return { path: input.path, content };
  }

  async listDir(input: { path: string }): Promise<ListDirOutput> {
    const prefix = input.path === "." ? "" : `${input.path.replace(/\/$/, "")}/`;
    return {
      entries: [...this.files.keys()]
        .filter((path) => path.startsWith(prefix))
        .map((path) => ({ name: path.slice(prefix.length), path, isDir: false }))
    };
  }

  async searchFiles(input: { path: string; query: string }): Promise<FileSearchOutput> {
    const prefix = input.path === "." ? "" : `${input.path.replace(/\/$/, "")}/`;
    return {
      matches: [...this.files.keys()]
        .filter((path) => path.startsWith(prefix) && path.includes(input.query))
        .map((path) => ({ name: path.split("/").pop() ?? path, path, isDir: false })),
      truncated: false
    };
  }

  async grepFiles(input: { path: string; pattern: string }): Promise<GrepFilesOutput> {
    const prefix = input.path === "." ? "" : `${input.path.replace(/\/$/, "")}/`;
    const matches = [];
    for (const [path, content] of this.files.entries()) {
      if (!path.startsWith(prefix)) {
        continue;
      }
      const lines = content.split("\n");
      for (const [index, line] of lines.entries()) {
        const matchStart = line.indexOf(input.pattern);
        if (matchStart >= 0) {
          matches.push({
            path,
            lineNumber: index + 1,
            line,
            matchStart,
            matchEnd: matchStart + input.pattern.length
          });
        }
      }
    }
    return { matches, truncated: false };
  }

  async writeText(input: { path: string; content: string }): Promise<WriteFileOutput> {
    this.files.set(input.path, input.content);
    return { path: input.path, bytesWritten: new TextEncoder().encode(input.content).byteLength };
  }
}

class ScenarioShellHost implements ShellToolHost {
  constructor(private readonly files: Map<string, string>) {}

  async run(input: { command: string; timeoutMs: number }): Promise<ShellRunOutput> {
    const fixed = this.files.get("src/math.ts")?.includes("return a + b;") ?? false;
    return {
      command: input.command,
      exitCode: fixed ? 0 : 1,
      stdout: fixed ? "tests passed\n" : "",
      stderr: fixed ? "" : "tests failed\n",
      durationMs: 12,
      timedOut: input.timeoutMs < 12
    };
  }
}

class StaticShellHost implements ShellToolHost {
  constructor(private readonly output: Partial<ShellRunOutput> = {}) {}

  async run(input: { command: string; timeoutMs: number }): Promise<ShellRunOutput> {
    return {
      command: input.command,
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 10,
      timedOut: false,
      ...this.output
    };
  }
}

class TimeoutShellHost implements ShellToolHost {
  async run(input: { command: string; timeoutMs: number }): Promise<ShellRunOutput> {
    return {
      command: input.command,
      exitCode: null,
      stdout: "",
      stderr: `command timed out after ${input.timeoutMs}ms\n`,
      durationMs: input.timeoutMs,
      timedOut: true
    };
  }
}

class ScenarioShellJobHost implements ShellJobToolHost {
  readonly startedCommands: string[] = [];
  private readonly jobs = new Map<string, ShellJobStartOutput>();

  async start(input: { workspacePath: string; command: string; timeoutMs: number }): Promise<ShellJobStartOutput> {
    this.startedCommands.push(input.command);
    const job: ShellJobStartOutput = {
      id: "job-1",
      workspacePath: input.workspacePath,
      command: input.command,
      status: "completed",
      exitCode: 0,
      stdout: "tests passed\n",
      stderr: "",
      durationMs: 20,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
      createdAt: "1",
      updatedAt: "2"
    };
    this.jobs.set(job.id, job);
    return job;
  }

  async get(input: { workspacePath: string; jobId: string }): Promise<ShellJobStartOutput> {
    const job = this.jobs.get(input.jobId);
    if (!job) {
      throw new Error(`Missing job: ${input.jobId}`);
    }
    if (job.workspacePath !== input.workspacePath) {
      throw new Error("shell job belongs to a different workspace");
    }
    return job;
  }
}

class ScenarioGitHost implements GitToolHost {
  constructor(private readonly files: Map<string, string>) {}

  async status(): Promise<GitStatusHostOutput> {
    return {
      isRepo: true,
      branch: "main",
      entries: [{ status: "M", path: "src/math.ts" }],
      raw: "## main\n M src/math.ts"
    };
  }

  async diff(): Promise<GitDiffHostOutput> {
    const fixed = this.files.get("src/math.ts")?.includes("a + b") ?? false;
    return {
      isRepo: true,
      diff: fixed
        ? "diff --git a/src/math.ts b/src/math.ts\n-  return a - b;\n+  return a + b;\n"
        : ""
    };
  }

  async branch(): Promise<GitBranchHostOutput> {
    return { isRepo: true, current: "main", branches: ["main"], raw: "main\n" };
  }

  async log(): Promise<GitTextHostOutput> {
    return { isRepo: true, output: "abc123 initial" };
  }

  async show(): Promise<GitTextHostOutput> {
    return { isRepo: true, output: "commit abc123" };
  }

  async blame(): Promise<GitTextHostOutput> {
    return { isRepo: true, output: "abc123 src/math.ts" };
  }
}

function providerTurn(index: number): string[] {
  if (index === 1) {
    return streamedToolCall("read-1", "read_file", { path: "src/math.ts" });
  }

  if (index === 2) {
    return streamedToolCall("edit-1", "edit_file", {
      path: "src/math.ts",
      oldText: "return a - b;",
      newText: "return a + b;"
    });
  }

  if (index === 3) {
    // Deliberately omit finish_reason here; some OpenAI-compatible providers stream
    // tool calls without a stable terminal finish reason.
    return [
      sse({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "test-1",
                  type: "function",
                  function: { name: "run_tests", arguments: JSON.stringify({ command: "pnpm test" }) }
                }
              ]
            }
          }
        ]
      }),
      "data: [DONE]\n\n"
    ];
  }

  return [
    sse({ choices: [{ delta: { content: "已修复 add 实现，并通过测试。" }, finish_reason: "stop" }] }),
    "data: [DONE]\n\n"
  ];
}

function streamedToolCall(id: string, name: string, input: unknown): string[] {
  const serializedInput = JSON.stringify(input);
  const splitAt = Math.max(1, Math.floor(serializedInput.length / 2));

  return [
    sse({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id,
                type: "function",
                function: { name, arguments: serializedInput.slice(0, splitAt) }
              }
            ]
          }
        }
      ]
    }),
    sse({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                function: { arguments: serializedInput.slice(splitAt) }
              }
            ]
          },
          finish_reason: "tool_calls"
        }
      ]
    }),
    "data: [DONE]\n\n"
  ];
}

function sse(value: unknown): string {
  return `data: ${JSON.stringify(value)}\n\n`;
}

function streamResponse(chunks: string[]): StreamResponse {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    body: {
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) {
          yield encoder.encode(chunk);
        }
      }
    },
    async text() {
      return "";
    }
  };
}

function lastMessage(messages: unknown[]) {
  return messages[messages.length - 1];
}
