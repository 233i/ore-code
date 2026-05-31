import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "@seekforge/protocol";
import { deriveShellJobs } from "./shellJobs";

const base = {
  id: "event",
  seq: 0,
  threadId: "thread",
  turnId: "turn",
  createdAt: "2026-05-08T00:00:00.000Z"
};

describe("deriveShellJobs", () => {
  it("folds shell approval and completion events into a job", () => {
    const events: RuntimeEvent[] = [
      {
        ...base,
        id: "1",
        seq: 1,
        type: "tool_call_requested",
        call: { id: "shell-1", name: "exec_shell", input: { command: "pnpm test", timeoutMs: 1000 } }
      },
      {
        ...base,
        id: "2",
        seq: 2,
        type: "approval_requested",
        call: { id: "shell-1", name: "exec_shell", input: { command: "pnpm test", timeoutMs: 1000 } }
      },
      {
        ...base,
        id: "3",
        seq: 3,
        type: "approval_decided",
        decision: { callId: "shell-1", decision: "approved-once" }
      },
      {
        ...base,
        id: "4",
        seq: 4,
        type: "tool_started",
        call: { id: "shell-1", name: "exec_shell", input: { command: "pnpm test", timeoutMs: 1000 } }
      },
      {
        ...base,
        id: "5",
        seq: 5,
        type: "tool_completed",
        result: {
          callId: "shell-1",
          ok: true,
          output: {
            command: "pnpm test",
            exitCode: 0,
            stdout: "ok",
            stderr: "",
            durationMs: 42,
            timedOut: false
          }
        }
      }
    ];

    expect(deriveShellJobs(events)).toEqual([
      {
        id: "turn:shell-1",
        turnId: "turn",
        callId: "shell-1",
        command: "pnpm test",
        timeoutMs: 1000,
        status: "completed",
        createdAt: "2026-05-08T00:00:00.000Z",
        updatedAt: "2026-05-08T00:00:00.000Z",
        approvalDecision: "approved-once",
        exitCode: 0,
        durationMs: 42,
        timedOut: false,
        stdoutTail: "ok",
        stderrTail: undefined,
        errorMessage: undefined
      }
    ]);
  });

  it("marks denied shell approvals as denied jobs", () => {
    const events: RuntimeEvent[] = [
      {
        ...base,
        id: "1",
        seq: 1,
        type: "approval_requested",
        call: { id: "shell-1", name: "exec_shell", input: { command: "rm -rf tmp" } }
      },
      {
        ...base,
        id: "2",
        seq: 2,
        type: "approval_decided",
        decision: { callId: "shell-1", decision: "denied" }
      },
      {
        ...base,
        id: "3",
        seq: 3,
        type: "tool_failed",
        result: {
          callId: "shell-1",
          ok: false,
          error: { code: "approval_denied", message: "exec_shell was denied by the user." }
        }
      }
    ];

    expect(deriveShellJobs(events)[0]).toMatchObject({
      command: "rm -rf tmp",
      status: "denied",
      approvalDecision: "denied",
      errorMessage: "exec_shell was denied by the user."
    });
  });

  it("keeps only the output tail for long shell output", () => {
    const output = `${"a".repeat(2100)}tail`;
    const events: RuntimeEvent[] = [
      {
        ...base,
        id: "1",
        seq: 1,
        type: "tool_started",
        call: { id: "shell-1", name: "exec_shell", input: { command: "yes" } }
      },
      {
        ...base,
        id: "2",
        seq: 2,
        type: "tool_completed",
        result: {
          callId: "shell-1",
          ok: true,
          output: {
            command: "yes",
            exitCode: null,
            stdout: output,
            stderr: "",
            durationMs: 300000,
            timedOut: true
          }
        }
      }
    ];

    expect(deriveShellJobs(events)[0].stdoutTail).toHaveLength(2000);
    expect(deriveShellJobs(events)[0].stdoutTail?.endsWith("tail")).toBe(true);
  });

  it("marks non-zero shell exits as failed even when the tool returned output", () => {
    const events: RuntimeEvent[] = [
      {
        ...base,
        id: "1",
        seq: 1,
        type: "tool_started",
        call: { id: "shell-1", name: "exec_shell", input: { command: "missing-command" } }
      },
      {
        ...base,
        id: "2",
        seq: 2,
        type: "tool_completed",
        result: {
          callId: "shell-1",
          ok: true,
          output: {
            command: "missing-command",
            exitCode: 127,
            stdout: "",
            stderr: "not found",
            durationMs: 12,
            timedOut: false
          }
        }
      }
    ];

    expect(deriveShellJobs(events)[0]).toMatchObject({
      status: "failed",
      exitCode: 127,
      stderrTail: "not found"
    });
  });
});
