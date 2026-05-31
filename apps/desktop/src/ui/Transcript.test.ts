import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "@seekforge/protocol";
import type { ToolCardState } from "../features/tools/toolCards";
import { deriveTranscriptItems } from "./Transcript";

describe("deriveTranscriptItems", () => {
  it("keeps reasoning and tool calls interleaved without duplicating updated tool cards", () => {
    const events = [
      event("user_message", { id: "u1", text: "运行测试" }),
      event("reasoning_delta", { id: "r1", text: "先检查命令。" }),
      event("tool_call_requested", {
        id: "tc1",
        call: { id: "shell-1", name: "exec_shell", input: { command: "pnpm test" } }
      }),
      event("tool_started", {
        id: "ts1",
        call: { id: "shell-1", name: "exec_shell", input: { command: "pnpm test" } }
      }),
      event("tool_completed", {
        id: "td1",
        result: { callId: "shell-1", ok: true, output: { exitCode: 0 } }
      }),
      event("assistant_message", { id: "a1", text: "验证通过。" })
    ] satisfies RuntimeEvent[];
    const toolCards: ToolCardState[] = [{
      id: "turn-1:shell-1",
      turnId: "turn-1",
      callId: "shell-1",
      name: "exec_shell",
      status: "completed",
      input: { command: "pnpm test" },
      result: { callId: "shell-1", ok: true, output: { exitCode: 0 } }
    }];

    const items = deriveTranscriptItems(events, toolCards);

    expect(items.map((item) => item.type)).toEqual(["message", "reasoning", "tool", "message"]);
    expect(items.filter((item) => item.type === "tool")).toHaveLength(1);
    expect(items[2]).toMatchObject({ type: "tool", card: { status: "completed", name: "exec_shell" } });
  });

  it("folds repeated read-only activity into a compact progress group", () => {
    const events = [
      event("user_message", { id: "u1", text: "分析工作树" }),
      event("reasoning_delta", { id: "r1", text: "先看后端命令。" }),
      event("tool_call_requested", {
        id: "tc1",
        call: { id: "read-1", name: "read_file", input: { path: "/tmp/project/src/git_commands.rs" } }
      }),
      event("tool_completed", {
        id: "td1",
        result: { callId: "read-1", ok: true, output: { content: "git commands" } }
      }),
      event("reasoning_delta", { id: "r2", text: "继续看 shell 命令。" }),
      event("tool_call_requested", {
        id: "tc2",
        call: { id: "read-2", name: "read_file", input: { path: "/tmp/project/src/shell_commands.rs" } }
      }),
      event("tool_completed", {
        id: "td2",
        result: { callId: "read-2", ok: true, output: { content: "shell commands" } }
      }),
      event("assistant_message", { id: "a1", text: "分析完了。" })
    ] satisfies RuntimeEvent[];
    const toolCards: ToolCardState[] = [
      readFileCard("read-1", "/tmp/project/src/git_commands.rs"),
      readFileCard("read-2", "/tmp/project/src/shell_commands.rs")
    ];

    const items = deriveTranscriptItems(events, toolCards);

    expect(items.map((item) => item.type)).toEqual(["message", "activity", "message"]);
    expect(items[1]).toMatchObject({
      type: "activity",
      group: {
        reasoning: [{ id: "r1" }, { id: "r2" }],
        tools: [
          { callId: "read-1", name: "read_file", status: "completed" },
          { callId: "read-2", name: "read_file", status: "completed" }
        ]
      }
    });
  });

  it("keeps failed read-only tools visible as standalone failures", () => {
    const events = [
      event("user_message", { id: "u1", text: "读取文件" }),
      event("tool_call_requested", {
        id: "tc1",
        call: { id: "read-1", name: "read_file", input: { path: "/tmp/missing.ts" } }
      }),
      event("tool_failed", {
        id: "tf1",
        result: { callId: "read-1", ok: false, error: { code: "not_found", message: "No such file" } }
      })
    ] satisfies RuntimeEvent[];
    const toolCards: ToolCardState[] = [{
      id: "turn-1:read-1",
      turnId: "turn-1",
      callId: "read-1",
      name: "read_file",
      status: "failed",
      input: { path: "/tmp/missing.ts" },
      result: { callId: "read-1", ok: false, error: { code: "not_found", message: "No such file" } }
    }];

    const items = deriveTranscriptItems(events, toolCards);

    expect(items.map((item) => item.type)).toEqual(["message", "tool"]);
    expect(items[1]).toMatchObject({ type: "tool", card: { status: "failed", name: "read_file" } });
  });

  it("renders subagent completion as a concise transcript message", () => {
    const events = [
      event("user_message", { id: "u1", text: "检查 auth" }),
      event("subagent_completed", {
        id: "sa1",
        agentId: "agent-1",
        name: "auth",
        status: "completed",
        summary: "SUMMARY\nAuth checked.",
        eventCount: 4
      })
    ] satisfies RuntimeEvent[];

    const items = deriveTranscriptItems(events, []);

    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({
      type: "message",
      message: {
        role: "assistant",
        text: "子任务 auth 已完成：SUMMARY\nAuth checked."
      }
    });
  });

  it("renders codebase context hits as a compact hint only", () => {
    const events = [
      event("user_message", { id: "u1", text: "修复 App.tsx" }),
      event("codebase_context", {
        id: "ctx1",
        status: "hit",
        fileCount: 2,
        paths: ["src/App.tsx", "src/App.test.tsx"],
        semanticIndexSource: "cache",
        semanticIndexDocumentCount: 12,
        message: "已参考 2 个相关文件。"
      }),
      event("assistant_message", { id: "a1", text: "我会先读取相关文件。" })
    ] satisfies RuntimeEvent[];

    const items = deriveTranscriptItems(events, []);

    expect(items.map((item) => item.type)).toEqual(["message", "context", "message"]);
    expect(items[1]).toMatchObject({
      type: "context",
      context: {
        status: "hit",
        fileCount: 2,
        paths: ["src/App.tsx", "src/App.test.tsx"]
      }
    });
  });

  it("does not render skipped codebase context events in the transcript", () => {
    const events = [
      event("user_message", { id: "u1", text: "你是谁" }),
      event("codebase_context", {
        id: "ctx1",
        status: "skipped",
        fileCount: 0,
        paths: [],
        semanticIndexSource: "none",
        message: "本轮未注入代码库上下文。"
      })
    ] satisfies RuntimeEvent[];

    expect(deriveTranscriptItems(events, [])).toHaveLength(1);
  });

  it("normalizes legacy user-stop failures to friendly copy", () => {
    const events = [
      event("user_message", { id: "u1", text: "开始" }),
      event("turn_failed", { id: "f1", message: "Turn was stopped by the user." })
    ] satisfies RuntimeEvent[];

    const items = deriveTranscriptItems(events, []);

    expect(items[1]).toMatchObject({
      type: "message",
      message: {
        role: "failure",
        text: "已停止当前任务。"
      }
    });
  });
});

function readFileCard(callId: string, path: string): ToolCardState {
  return {
    id: `turn-1:${callId}`,
    turnId: "turn-1",
    callId,
    name: "read_file",
    status: "completed",
    input: { path },
    result: { callId, ok: true, output: { path, content: "content" } }
  };
}

function event<T extends RuntimeEvent["type"]>(
  type: T,
  fields: Omit<Extract<RuntimeEvent, { type: T }>, "type" | "seq" | "threadId" | "turnId" | "createdAt">
): Extract<RuntimeEvent, { type: T }> {
  return {
    ...fields,
    type,
    seq: 0,
    threadId: "thread-1",
    turnId: "turn-1",
    createdAt: "2026-05-12T00:00:00.000Z"
  } as Extract<RuntimeEvent, { type: T }>;
}
