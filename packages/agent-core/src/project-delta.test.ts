import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "@ore-code/protocol";
import { assembleRequest, diffRequestSegments } from "./request-assembler";
import { buildProjectDeltaEventBody, formatProjectDeltaForModel } from "./project-delta";
import { buildRuntimeContext } from "./runtime-history";

describe("project delta", () => {
  it("records inspected paths, file changes, tests, errors, and artifacts for one turn", () => {
    const events: RuntimeEvent[] = [
      event({ type: "user_message", text: "update app" }),
      event({
        type: "tool_call_requested",
        call: { id: "read-1", name: "read_file", input: { path: "src/App.tsx" } }
      }),
      event({
        type: "tool_completed",
        result: { callId: "read-1", ok: true, output: { path: "src/App.tsx" } }
      }),
      event({
        type: "tool_call_requested",
        call: { id: "test-1", name: "run_tests", input: { command: "pnpm test" } }
      }),
      event({
        type: "tool_completed",
        result: {
          callId: "test-1",
          ok: true,
          artifactId: "artifact-1",
          output: { command: "pnpm test", exitCode: 0, stdout: "passed", artifactSummary: "test log", artifactType: "text", artifactSize: 42 }
        }
      }),
      event({
        type: "tool_call_requested",
        call: { id: "bad-1", name: "exec_shell", input: { command: "pnpm lint" } }
      }),
      event({
        type: "tool_failed",
        result: { callId: "bad-1", ok: false, error: { code: "tool_execution_error", message: "lint failed" } }
      }),
      event({
        type: "file_changed",
        path: "src/App.tsx",
        changeKind: "updated",
        additions: 2,
        deletions: 1,
        snapshotId: "snapshot-1"
      })
    ];

    const body = buildProjectDeltaEventBody(events, "turn-1");

    expect(body).toMatchObject({
      type: "project_delta",
      readPaths: ["src/App.tsx"],
      changedFiles: [{ path: "src/App.tsx", changeKind: "updated", additions: 2, deletions: 1 }],
      testResults: [{ toolName: "run_tests", command: "pnpm test", ok: true, exitCode: 0 }],
      errors: [{ source: "tool", toolName: "exec_shell", message: "lint failed" }],
      artifacts: [{ artifactId: "artifact-1", sourceCallId: "test-1", summary: "test log", type: "text", size: 42 }],
      workingSetPaths: ["src/App.tsx"]
    });
  });

  it("enters the conversation ledger without changing the project snapshot segment", () => {
    const systemPrompt = "Static system prompt.";
    const projectContext = "<project_context>workspace=/repo</project_context>";
    const firstRequest = assembleRequest({
      systemPrompt,
      projectContext,
      userText: "first request"
    });
    const projectDeltaBody = buildProjectDeltaEventBody([
      event({
        type: "file_changed",
        path: "src/App.tsx",
        changeKind: "updated",
        additions: 1,
        deletions: 0
      })
    ], "turn-1");
    expect(projectDeltaBody).toBeTruthy();
    const projectDelta = event(projectDeltaBody!) as Extract<RuntimeEvent, { type: "project_delta" }>;
    const context = buildRuntimeContext([
      event({ type: "user_message", text: "first request" }),
      projectDelta
    ]);
    const nextRequest = assembleRequest({
      systemPrompt,
      projectContext,
      history: context.messages,
      userText: "second request"
    });
    const firstProjectHash = firstRequest.segments.find((segment) => segment.name === "project_snapshot")?.hash;
    const nextProjectHash = nextRequest.segments.find((segment) => segment.name === "project_snapshot")?.hash;
    const diff = diffRequestSegments(firstRequest.segments, nextRequest.segments);

    expect(formatProjectDeltaForModel(projectDelta)).toContain("<internal_project_delta>");
    expect(formatProjectDeltaForModel(projectDelta)).toContain("[project_delta:turn-1]");
    expect(formatProjectDeltaForModel(projectDelta)).toContain("Do not quote, summarize, append, or mention this block");
    expect(context.messages.some((message) => message.content.includes("[project_delta:turn-1]"))).toBe(true);
    expect(context.messages.some((message) => message.role === "system" && message.content.includes("[project_delta:turn-1]"))).toBe(true);
    expect(firstProjectHash).toBe(nextProjectHash);
    expect(diff.changedSegments).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "conversation_ledger", breaksPrefix: false })
    ]));
    expect(diff.breaksPrefix).toBe(false);
  });

  it("automatically maintains explicit long-term reference requests as internal pinned context", () => {
    const pinBody = buildProjectDeltaEventBody([
      event({
        type: "user_message",
        text: "后续都参考 docs/architecture.md 和 `src/App.tsx` 这两个文件。"
      })
    ], "turn-1");
    expect(pinBody).toMatchObject({
      pinnedContexts: [
        { kind: "path", value: "docs/architecture.md", sourceTurnId: "turn-1", lastMentionedTurnId: "turn-1" },
        { kind: "path", value: "src/App.tsx", sourceTurnId: "turn-1", lastMentionedTurnId: "turn-1" }
      ],
      workingSetPaths: ["docs/architecture.md", "src/App.tsx"]
    });

    const pinEvent = event(pinBody!);
    const carriedBody = buildProjectDeltaEventBody([
      pinEvent,
      event({ type: "user_message", text: "继续", turnId: "turn-2" })
    ], "turn-2");
    expect(carriedBody).toMatchObject({
      pinnedContexts: [
        { kind: "path", value: "docs/architecture.md", sourceTurnId: "turn-1", lastMentionedTurnId: "turn-1" },
        { kind: "path", value: "src/App.tsx", sourceTurnId: "turn-1", lastMentionedTurnId: "turn-1" }
      ],
      workingSetPaths: ["docs/architecture.md", "src/App.tsx"]
    });

    const carriedEvent = event({ ...carriedBody!, turnId: "turn-2" }) as Extract<RuntimeEvent, { type: "project_delta" }>;
    expect(formatProjectDeltaForModel(carriedEvent)).toContain("Pinned context:");
    expect(buildRuntimeContext([carriedEvent]).messages[0].content).toContain("path=docs/architecture.md");
  });

  it("removes pinned paths when the user explicitly stops referencing them", () => {
    const pinBody = buildProjectDeltaEventBody([
      event({ type: "user_message", text: "以后都参考 docs/architecture.md" })
    ], "turn-1");
    const unpinnedBody = buildProjectDeltaEventBody([
      event(pinBody!),
      event({ type: "user_message", text: "后面不再参考 docs/architecture.md", turnId: "turn-2" })
    ], "turn-2");

    expect(unpinnedBody).toBeNull();
  });
});

function event(fields: Record<string, unknown> & { type: RuntimeEvent["type"] }): RuntimeEvent {
  return {
    id: crypto.randomUUID(),
    seq: 0,
    threadId: "thread-1",
    turnId: "turn-1",
    createdAt: "2026-05-19T00:00:00.000Z",
    ...fields
  } as RuntimeEvent;
}
