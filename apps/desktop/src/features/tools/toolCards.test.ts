import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "@seekforge/protocol";
import { deriveToolCards } from "./toolCards";

const base = {
  id: "event",
  seq: 0,
  threadId: "thread",
  turnId: "turn",
  createdAt: "2026-05-08T00:00:00.000Z"
};

describe("deriveToolCards", () => {
  it("folds approval and completion events into one card", () => {
    const events: RuntimeEvent[] = [
      {
        ...base,
        id: "1",
        seq: 1,
        type: "tool_call_requested",
        call: { id: "shell-1", name: "shell_probe", input: { command: "pnpm test" } }
      },
      {
        ...base,
        id: "2",
        seq: 2,
        type: "approval_requested",
        call: { id: "shell-1", name: "shell_probe", input: { command: "pnpm test" } }
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
        call: { id: "shell-1", name: "shell_probe", input: { command: "pnpm test" } }
      },
      {
        ...base,
        id: "5",
        seq: 5,
        type: "tool_completed",
        result: { callId: "shell-1", ok: true, output: { command: "pnpm test" } }
      }
    ];

    expect(deriveToolCards(events)).toEqual([
      {
        id: "turn:shell-1",
        turnId: "turn",
        callId: "shell-1",
        name: "shell_probe",
        input: { command: "pnpm test" },
        approvalDecision: "approved-once",
        status: "completed",
        result: { callId: "shell-1", ok: true, output: { command: "pnpm test" } }
      }
    ]);
  });

  it("keeps same provider call id separate across turns", () => {
    const events: RuntimeEvent[] = [
      {
        ...base,
        id: "1",
        seq: 1,
        turnId: "turn-1",
        type: "tool_call_requested",
        call: { id: "list-dir-1", name: "list_dir", input: { path: "." } }
      },
      {
        ...base,
        id: "2",
        seq: 2,
        turnId: "turn-1",
        type: "tool_completed",
        result: { callId: "list-dir-1", ok: true, output: { entries: [] } }
      },
      {
        ...base,
        id: "3",
        seq: 3,
        turnId: "turn-2",
        type: "tool_call_requested",
        call: { id: "list-dir-1", name: "list_dir", input: { path: "." } }
      },
      {
        ...base,
        id: "4",
        seq: 4,
        turnId: "turn-2",
        type: "tool_completed",
        result: { callId: "list-dir-1", ok: true, output: { entries: [] } }
      }
    ];

    expect(deriveToolCards(events).map((card) => card.id)).toEqual([
      "turn-1:list-dir-1",
      "turn-2:list-dir-1"
    ]);
  });

  it("marks completed shell results with non-zero exit code as failed", () => {
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
          output: { command: "missing-command", exitCode: 127, timedOut: false }
        }
      }
    ];

    expect(deriveToolCards(events)[0]).toMatchObject({
      status: "failed",
      result: { output: { exitCode: 127 } }
    });
  });

  it("accumulates command output deltas on the matching tool card", () => {
    const events: RuntimeEvent[] = [
      {
        ...base,
        id: "1",
        seq: 1,
        type: "tool_started",
        call: { id: "shell-1", name: "exec_shell", input: { command: "pnpm test" } }
      },
      {
        ...base,
        id: "2",
        seq: 2,
        type: "command_output_delta",
        callId: "shell-1",
        stream: "stdout",
        text: "one\n"
      },
      {
        ...base,
        id: "3",
        seq: 3,
        type: "command_output_delta",
        callId: "shell-1",
        stream: "stderr",
        text: "warn\n"
      },
      {
        ...base,
        id: "4",
        seq: 4,
        type: "command_output_delta",
        callId: "shell-1",
        stream: "stdout",
        text: "two\n"
      }
    ];

    expect(deriveToolCards(events)[0]).toMatchObject({
      status: "running",
      commandOutput: {
        stdout: "one\ntwo\n",
        stderr: "warn\n",
        truncated: false
      }
    });
  });

  it("keeps command output when the tool completes", () => {
    const events: RuntimeEvent[] = [
      {
        ...base,
        id: "1",
        seq: 1,
        type: "tool_started",
        call: { id: "shell-1", name: "exec_shell", input: { command: "pnpm test" } }
      },
      {
        ...base,
        id: "2",
        seq: 2,
        type: "command_output_delta",
        callId: "shell-1",
        stream: "stdout",
        text: "ok\n"
      },
      {
        ...base,
        id: "3",
        seq: 3,
        type: "tool_completed",
        result: { callId: "shell-1", ok: true, output: { exitCode: 0 } }
      }
    ];

    expect(deriveToolCards(events)[0]).toMatchObject({
      status: "completed",
      commandOutput: {
        stdout: "ok\n",
        stderr: "",
        truncated: false
      }
    });
  });
});
