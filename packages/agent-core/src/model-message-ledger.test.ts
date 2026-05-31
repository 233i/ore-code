import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "@seekforge/protocol";
import { buildRuntimeContextFromMessages } from "./runtime-history";
import { ModelMessageLedger, modelMessagesFromEvents } from "./model-message-ledger";

describe("ModelMessageLedger", () => {
  it("replays reasoning content with assistant tool calls and tool results", () => {
    const events: RuntimeEvent[] = [
      event({ seq: 0, type: "user_message", text: "inspect files" }),
      event({ seq: 1, type: "reasoning_delta", text: "Need to inspect first." }),
      event({ seq: 2, type: "assistant_delta", text: "I will inspect." }),
      event({
        seq: 3,
        type: "tool_call_requested",
        call: { id: "call-1", name: "read_file", input: { path: "src/App.tsx" } }
      }),
      event({
        seq: 4,
        type: "tool_completed",
        result: { callId: "call-1", ok: true, output: { path: "src/App.tsx", content: "export {}" } }
      }),
      event({ seq: 5, type: "assistant_delta", text: "Done." })
    ];

    expect(ModelMessageLedger.fromEvents(events).messages()).toEqual([
      { role: "user", content: "inspect files" },
      {
        role: "assistant",
        content: "I will inspect.",
        reasoningContent: "Need to inspect first.",
        toolCalls: [{ id: "call-1", name: "read_file", input: { path: "src/App.tsx" } }]
      },
      {
        role: "tool",
        toolCallId: "call-1",
        content: JSON.stringify({
          callId: "call-1",
          ok: true,
          output: { path: "src/App.tsx", content: "export {}" }
        })
      },
      { role: "assistant", content: "Done." }
    ]);
  });

  it("keeps incremental append equivalent to hydrating from existing runtime events", () => {
    const events: RuntimeEvent[] = [
      event({ seq: 0, type: "user_message", text: "update app" }),
      event({ seq: 1, type: "assistant_delta", text: "Updated app." }),
      event({
        seq: 2,
        type: "project_delta",
        summary: "1 changed file",
        readPaths: ["src/App.tsx"],
        changedFiles: [{ path: "src/App.tsx", changeKind: "updated", additions: 1, deletions: 0 }],
        testResults: [{ toolName: "run_tests", command: "pnpm test", ok: true, exitCode: 0 }],
        errors: [],
        artifacts: [],
        pinnedContexts: [],
        workingSetPaths: ["src/App.tsx"]
      })
    ];

    const incremental = new ModelMessageLedger();
    incremental.append(events[0]);
    incremental.append(events[1]);
    incremental.append(events[2]);

    expect(incremental.messages()).toEqual(ModelMessageLedger.fromEvents(events).messages());
    expect(incremental.messages()[2]).toMatchObject({ role: "system" });
    expect(incremental.messages()[2].content).toContain("<internal_project_delta>");
    expect(incremental.messages()[2].content).toContain("Do not quote, summarize, append, or mention this block");
    expect(buildRuntimeContextFromMessages(incremental.messages()).messages[2].content).toContain("[project_delta:turn-1]");
  });

  it("resets the model ledger at context checkpoint boundaries", () => {
    const events: RuntimeEvent[] = [
      event({ seq: 0, type: "user_message", text: "old request should be folded" }),
      event({ seq: 1, type: "assistant_delta", text: "old answer should be folded" }),
      event({
        seq: 2,
        type: "context_checkpoint",
        checkpointId: "checkpoint-1",
        reason: "capacity",
        inputTokensBefore: 100,
        inputTokensAfter: 20,
        maxInputTokens: 90,
        thresholdTokens: 75,
        messagesBefore: 2,
        messagesAfter: 2,
        droppedMessages: 2,
        retainedMessages: 1,
        summaryChars: 64,
        cacheBreak: true,
        message: "checkpoint created",
        checkpointMessages: [
          { role: "assistant", content: "[context_checkpoint]\nFolded old request and answer." },
          { role: "user", content: "latest retained request" }
        ]
      }),
      event({ seq: 3, type: "assistant_delta", text: "new answer" })
    ];

    expect(ModelMessageLedger.fromEvents(events).messages()).toEqual([
      { role: "assistant", content: "[context_checkpoint]\nFolded old request and answer." },
      { role: "user", content: "latest retained request" },
      { role: "assistant", content: "new answer" }
    ]);
  });

  it("injects loaded lazy context into the model ledger only when content is attached", () => {
    const events: RuntimeEvent[] = [
      event({
        seq: 0,
        type: "lazy_context_loaded",
        source: "skill",
        sourceId: "reviewer",
        title: "Skill /reviewer",
        summary: "Review current changes",
        content: "# Reviewer\nCheck bugs and tests.",
        contentChars: 32,
        tokenEstimate: 12
      }),
      event({
        seq: 1,
        type: "lazy_context_loaded",
        source: "mcp_resource",
        sourceId: "demo:file://readme",
        title: "MCP resource file://readme",
        summary: "Readme loaded by tool result",
        contentChars: 0,
        tokenEstimate: 0
      }),
      event({ seq: 2, type: "user_message", text: "review src/App.tsx" })
    ];

    expect(ModelMessageLedger.fromEvents(events).messages()).toEqual([
      {
        role: "assistant",
        content: expect.stringContaining("[lazy_context:skill:reviewer]")
      },
      { role: "user", content: "review src/App.tsx" }
    ]);
  });

  it("can omit tool results without mutating the underlying ledger", () => {
    const ledger = ModelMessageLedger.fromEvents([
      event({ seq: 0, type: "user_message", text: "run command" }),
      event({
        seq: 1,
        type: "tool_call_requested",
        call: { id: "call-1", name: "exec_shell", input: { command: "pwd" } }
      }),
      event({
        seq: 2,
        type: "tool_completed",
        result: { callId: "call-1", ok: true, output: { stdout: "/repo" } }
      })
    ]);

    expect(ledger.messages({ includeToolResults: false })).toEqual([
      { role: "user", content: "run command" }
    ]);
    expect(ledger.messages()).toEqual([
      { role: "user", content: "run command" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call-1", name: "exec_shell", input: { command: "pwd" } }]
      },
      {
        role: "tool",
        toolCallId: "call-1",
        content: JSON.stringify({ callId: "call-1", ok: true, output: { stdout: "/repo" } })
      }
    ]);
  });

  it("summarizes artifact-backed tool results instead of replaying raw output", () => {
    const messages = modelMessagesFromEvents([
      event({ seq: 0, type: "user_message", text: "read long output" }),
      event({
        seq: 1,
        type: "tool_completed",
        result: {
          callId: "shell-1",
          ok: true,
          artifactId: "artifact-1",
          output: {
            stdout: "raw-output-should-not-return".repeat(100),
            artifactSummary: "large shell output"
          }
        }
      })
    ]);

    expect(messages[1].content).toContain("artifact-1");
    expect(messages[1].content).toContain("large shell output");
    expect(messages[1].content).not.toContain("raw-output-should-not-return");
  });
});

function event<T extends Omit<RuntimeEvent, "id" | "threadId" | "turnId" | "createdAt">>(input: T): RuntimeEvent {
  return {
    id: crypto.randomUUID(),
    threadId: "thread-1",
    turnId: "turn-1",
    createdAt: "2026-05-19T00:00:00.000Z",
    ...input
  } as RuntimeEvent;
}
