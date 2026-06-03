import { describe, expect, it } from "vitest";
import type { LlmMessage } from "./llm";
import { buildRuntimeContextFromMessages } from "./runtime-history";

describe("runtime history pre-compress", () => {
  it("pre-compresses old shell tool results at l2 while keeping recent tool results full", () => {
    const longStdout = [
      "old shell head marker",
      "Error: build failed at src/main.ts:12",
      ...Array.from({ length: 5_000 }, (_, index) => `noise line ${index} ${"x".repeat(180)}`),
      "old shell tail marker"
    ].join("\n");
    const messages = [
      ...toolTurn("old-shell", "old shell", {
        stdout: longStdout,
        stderr: "fatal: test runner exited",
        command: "pnpm test",
        exitCode: 1,
        timedOut: false
      }),
      ...Array.from({ length: 6 }, (_, index) => toolTurn(`recent-${index}`, `recent ${index}`, {
        stdout: `RECENT_FULL_MARKER_${index} ${"r".repeat(4_000)}`,
        stderr: "",
        command: `echo recent-${index}`,
        exitCode: 0,
        timedOut: false
      })).flat()
    ];

    const context = buildRuntimeContextFromMessages(messages, { model: "deepseek-v4-pro" });
    const oldTool = toolMessage(context.messages, "old-shell");
    const recentTool = toolMessage(context.messages, "recent-0");
    const oldContent = JSON.parse(oldTool.content);

    expect(oldContent.output).toMatchObject({
      precompressed: true,
      kind: "shell",
      command: "pnpm test",
      exitCode: 1
    });
    expect(oldContent.output.stdoutSummary).toContain("Error: build failed at src/main.ts:12");
    expect(oldContent.output.stdoutSummary).toContain("old shell tail marker");
    expect(oldTool.content.length).toBeLessThan(6_000);
    expect(recentTool.content).toContain("RECENT_FULL_MARKER_0");
    expect(recentTool.content).not.toContain('"precompressed":true');
  });

  it("does not pre-compress old tool results before l2", () => {
    const messages = [
      ...toolTurn("old-shell", "old shell", {
        stdout: "old shell output that should stay verbatim",
        command: "pnpm test",
        exitCode: 0
      }),
      ...Array.from({ length: 6 }, (_, index) => toolTurn(`recent-${index}`, `recent ${index}`, {
        stdout: `recent output ${index}`,
        command: `echo recent-${index}`,
        exitCode: 0
      })).flat()
    ];
    const oldBefore = toolMessage(messages, "old-shell").content;

    const context = buildRuntimeContextFromMessages(messages, { model: "deepseek-v4-pro" });

    expect(toolMessage(context.messages, "old-shell").content).toBe(oldBefore);
  });
});

describe("runtime history context briefing", () => {
  it("folds old messages into a context briefing at the briefing seam", () => {
    const messages: LlmMessage[] = [
      { role: "user", content: `preserve migration plan for packages/agent-core/src/runtime-history.ts ${"x".repeat(8_000)}` },
      { role: "assistant", content: "Decision: keep transcript unchanged and only reduce model-side history." },
      ...Array.from({ length: 6 }, (_, index) => [
        { role: "user" as const, content: `recent request ${index}` },
        { role: "assistant" as const, content: `recent answer ${index}` }
      ]).flat()
    ];

    const context = buildRuntimeContextFromMessages(messages, {
      model: "deepseek-v4-pro",
      maxInputTokens: 1_000,
      maxChars: 100_000
    });

    expect(context.briefing).toMatchObject({
      status: "applied",
      reason: "hard",
      foldedMessages: 2,
      retainedMessages: 12
    });
    expect(context.messages[0]).toMatchObject({ role: "system" });
    expect(context.messages[0].content).toContain("[context_briefing]");
    expect(context.messages[0].content).toContain("preserve migration plan");
    expect(context.messages[0].content).toContain("packages/agent-core/src/runtime-history.ts");
    expect(context.messages.slice(1)).toEqual(messages.slice(2));
    expect(context.briefing.inputTokensAfter).toBeLessThan(context.briefing.inputTokensBefore);
  });

  it("can disable context briefing while leaving the transcript-derived history intact", () => {
    const messages: LlmMessage[] = [
      { role: "user", content: `old large request ${"x".repeat(8_000)}` },
      { role: "assistant", content: "old large answer" },
      ...Array.from({ length: 6 }, (_, index) => [
        { role: "user" as const, content: `recent request ${index}` },
        { role: "assistant" as const, content: `recent answer ${index}` }
      ]).flat()
    ];

    const context = buildRuntimeContextFromMessages(messages, {
      model: "deepseek-v4-pro",
      briefing: "off",
      maxInputTokens: 1_000,
      maxChars: 100_000
    });

    expect(context.briefing.status).toBe("none");
    expect(context.messages).toEqual(messages);
  });

  it("runs briefing before checkpoint and skips checkpoint when briefing is sufficient", () => {
    const messages: LlmMessage[] = [
      { role: "user", content: `old implementation notes ${"x".repeat(8_000)}` },
      { role: "assistant", content: "Decision: checkpoint should be fallback after briefing." },
      ...Array.from({ length: 6 }, (_, index) => [
        { role: "user" as const, content: `recent request ${index}` },
        { role: "assistant" as const, content: `recent answer ${index}` }
      ]).flat()
    ];

    const context = buildRuntimeContextFromMessages(messages, {
      model: "deepseek-v4-pro",
      checkpoint: "auto",
      maxInputTokens: 1_000,
      maxChars: 100_000,
      briefingMaxChars: 700
    });

    expect(context.briefing.status).toBe("applied");
    expect(context.checkpoint.status).toBe("none");
    expect(context.checkpointEvent).toBeUndefined();
    expect(context.messages[0].content).toContain("[context_briefing]");
  });

  it("falls back to checkpoint when briefing is disabled and checkpoint is enabled", () => {
    const messages: LlmMessage[] = [
      { role: "user", content: `old implementation notes ${"x".repeat(8_000)}` },
      { role: "assistant", content: "Decision: checkpoint should be fallback after briefing." },
      ...Array.from({ length: 6 }, (_, index) => [
        { role: "user" as const, content: `recent request ${index}` },
        { role: "assistant" as const, content: `recent answer ${index}` }
      ]).flat()
    ];

    const context = buildRuntimeContextFromMessages(messages, {
      model: "deepseek-v4-pro",
      checkpoint: "auto",
      briefing: "off",
      maxInputTokens: 1_000,
      maxChars: 100_000
    });

    expect(context.briefing.status).toBe("none");
    expect(context.checkpoint).toMatchObject({
      status: "applied",
      reason: "provider_limit",
      cacheBreak: true
    });
    expect(context.checkpointEvent).toBeDefined();
    expect(context.messages[0].content).toContain("[context_checkpoint]");
  });
});

function toolTurn(callId: string, userText: string, output: Record<string, unknown>): LlmMessage[] {
  return [
    { role: "user", content: userText },
    {
      role: "assistant",
      content: "",
      toolCalls: [{ id: callId, name: "exec_shell", input: { command: output.command ?? "echo ok" } }]
    },
    {
      role: "tool",
      toolCallId: callId,
      content: JSON.stringify({ callId, ok: true, output })
    }
  ];
}

function toolMessage(messages: readonly LlmMessage[], callId: string): LlmMessage {
  const message = messages.find((candidate) => candidate.role === "tool" && candidate.toolCallId === callId);
  if (!message) {
    throw new Error(`Missing tool message ${callId}`);
  }
  return message;
}
