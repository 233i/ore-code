import { describe, expect, it } from "vitest";
import { executeRegisteredTool } from "./executor";
import {
  createShellTool,
  createShellJobOutputTool,
  createShellJobStatusTool,
  createShellJobTools,
  createStartShellJobTool,
  type ShellJobStartOutput,
  type ShellJobToolHost,
  type ShellToolHost,
  type ShellToolOutput
} from "./shell-tools";
import { ToolRegistry } from "./registry";
import type { ToolContext } from "./spec";

const context: ToolContext = {
  workspacePath: "/workspace",
  mode: "agent",
  trustedWorkspace: false
};

function registryWithShellTool(host: ShellToolHost) {
  const registry = new ToolRegistry();
  registry.register(createShellTool(host));
  return registry;
}

function registryWithShellJobTool(host: ShellJobToolHost) {
  const registry = new ToolRegistry();
  registry.register(createStartShellJobTool(host));
  return registry;
}

function registryWithShellJobTools(host: ShellJobToolHost) {
  const registry = new ToolRegistry();
  for (const tool of createShellJobTools(host)) {
    registry.register(tool);
  }
  return registry;
}

describe("exec_shell tool", () => {
  it("auto-runs read-only shell commands in agent mode", async () => {
    const calls: Array<{ workspacePath: string; command: string; timeoutMs: number }> = [];
    const result = await executeRegisteredTool(
      registryWithShellTool(makeHost(calls)),
      "exec_shell",
      { command: "pnpm test" },
      context
    );

    expect(calls).toEqual([{ workspacePath: "/workspace", command: "pnpm test", timeoutMs: 30_000 }]);
    expect(result.type).toBe("completed");
  });

  it("requires approval for mutating shell commands in agent mode", async () => {
    const result = await executeRegisteredTool(
      registryWithShellTool(makeHost()),
      "exec_shell",
      { command: "pnpm install" },
      context
    );

    expect(result.type).toBe("approval-required");
  });

  it("runs through the shell host after approval", async () => {
    const calls: Array<{ workspacePath: string; command: string; timeoutMs: number }> = [];
    const result = await executeRegisteredTool(
      registryWithShellTool(makeHost(calls)),
      "exec_shell",
      { command: "pnpm install" },
      context,
      { callId: "shell-1", decision: "approved-once" }
    );

    expect(calls).toEqual([{ workspacePath: "/workspace", command: "pnpm install", timeoutMs: 30_000 }]);
    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      expect(result.result.output).toMatchObject({ command: "pnpm install", exitCode: 0, timedOut: false });
    }
  });

  it("forwards shell output deltas with the current tool call id", async () => {
    const deltas: Array<{ callId: string; stream: "stdout" | "stderr"; text: string }> = [];
    const result = await executeRegisteredTool(
      registryWithShellTool({
        async run(input) {
          input.onOutput?.({ stream: "stdout", text: "one\n" });
          input.onOutput?.({ stream: "stderr", text: "warn\n" });
          return {
            command: input.command,
            exitCode: 0,
            stdout: "one\n",
            stderr: "warn\n",
            durationMs: 12,
            timedOut: false
          };
        }
      }),
      "exec_shell",
      { command: "pnpm test" },
      {
        ...context,
        onCommandOutput: (delta) => deltas.push(delta)
      },
      undefined,
      { callId: "shell-1" }
    );

    expect(result.type).toBe("completed");
    expect(deltas).toEqual([
      { callId: "shell-1", stream: "stdout", text: "one\n" },
      { callId: "shell-1", stream: "stderr", text: "warn\n" }
    ]);
  });

  it("allows read-only shell commands in plan mode", async () => {
    const result = await executeRegisteredTool(
      registryWithShellTool(makeHost()),
      "exec_shell",
      { command: "pnpm test" },
      { ...context, mode: "plan" }
    );

    expect(result.type).toBe("completed");
  });

  it("runs approved mutating shell commands in plan mode", async () => {
    const result = await executeRegisteredTool(
      registryWithShellTool(makeHost()),
      "exec_shell",
      { command: "pnpm install" },
      { ...context, mode: "plan" },
      { callId: "shell-1", decision: "approved-once" }
    );

    expect(result.type).toBe("completed");
  });

  it("preserves timeout results and truncates long output", async () => {
    const longText = "x".repeat(20_010);
    const result = await executeRegisteredTool(
      registryWithShellTool(makeHost([], { stdout: longText, stderr: longText, timedOut: true, exitCode: null })),
      "exec_shell",
      { command: "sleep 9", timeoutMs: 1000 },
      context,
      { callId: "shell-1", decision: "approved-once" }
    );

    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      const output = result.result.output as ShellToolOutput;
      expect(output.timedOut).toBe(true);
      expect(output.exitCode).toBeNull();
      expect(output.stdout).toHaveLength(20_000);
      expect(output.stderr).toHaveLength(20_000);
      expect(output.stdoutTruncated).toBe(true);
      expect(output.stderrTruncated).toBe(true);
    }
  });
});

describe("start_shell_job tool", () => {
  it("auto-starts read-only shell jobs in agent mode", async () => {
    const calls: Array<{ workspacePath: string; command: string; timeoutMs: number }> = [];
    const result = await executeRegisteredTool(
      registryWithShellJobTool(makeJobHost(calls)),
      "start_shell_job",
      { command: "pnpm test" },
      context
    );

    expect(calls).toEqual([{ workspacePath: "/workspace", command: "pnpm test", timeoutMs: 30_000 }]);
    expect(result.type).toBe("completed");
  });

  it("requires approval for mutating shell jobs in agent mode", async () => {
    const result = await executeRegisteredTool(
      registryWithShellJobTool(makeJobHost()),
      "start_shell_job",
      { command: "pnpm install" },
      context
    );

    expect(result.type).toBe("approval-required");
  });

  it("starts a background shell job after approval", async () => {
    const calls: Array<{ workspacePath: string; command: string; timeoutMs: number }> = [];
    const result = await executeRegisteredTool(
      registryWithShellJobTool(makeJobHost(calls)),
      "start_shell_job",
      { command: "pnpm install", timeoutMs: 60_000 },
      context,
      { callId: "job-1", decision: "approved-once" }
    );

    expect(calls).toEqual([{ workspacePath: "/workspace", command: "pnpm install", timeoutMs: 60_000 }]);
    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      expect(result.result.output).toMatchObject({
        id: "job-1",
        command: "pnpm install",
        status: "running"
      });
    }
  });

  it("runs approved mutating background shell jobs in plan mode", async () => {
    const result = await executeRegisteredTool(
      registryWithShellJobTool(makeJobHost()),
      "start_shell_job",
      { command: "pnpm install" },
      { ...context, mode: "plan" },
      { callId: "job-1", decision: "approved-once" }
    );

    expect(result.type).toBe("completed");
  });
});

describe("shell job query tools", () => {
  it("reads job status without approval in plan mode", async () => {
    const result = await executeRegisteredTool(
      registryWithShellJobTools(makeJobHost()),
      "shell_job_status",
      { jobId: "job-1" },
      { ...context, mode: "plan" }
    );

    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      expect(result.result.output).toEqual({
        id: "job-1",
        workspacePath: "/workspace",
        command: "pnpm test",
        status: "completed",
        exitCode: 0,
        durationMs: 20,
        timedOut: false,
        createdAt: "1",
        updatedAt: "2",
        error: undefined
      });
    }
  });

  it("reads job stdout and stderr without approval", async () => {
    const registry = new ToolRegistry();
    registry.register(createShellJobOutputTool(makeJobHost()));
    registry.register(createShellJobStatusTool(makeJobHost()));

    const result = await executeRegisteredTool(
      registry,
      "shell_job_output",
      { jobId: "job-1" },
      context
    );

    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      expect(result.result.output).toMatchObject({
        id: "job-1",
        stdout: "ok",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false
      });
    }
  });
});

function makeHost(
  calls: Array<{ workspacePath: string; command: string; timeoutMs: number }> = [],
  overrides: Partial<ShellToolOutput> = {}
): ShellToolHost {
  return {
    async run(input) {
      calls.push(input);
      return {
        command: input.command,
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        durationMs: 12,
        timedOut: false,
        ...overrides
      };
    }
  };
}

function makeJobHost(
  calls: Array<{ workspacePath: string; command: string; timeoutMs: number }> = [],
  overrides: Partial<ShellJobStartOutput> = {}
): ShellJobToolHost {
  return {
    async start(input) {
      calls.push(input);
      return {
        id: "job-1",
        workspacePath: input.workspacePath,
        command: input.command,
        status: "running",
        exitCode: null,
        stdout: "",
        stderr: "",
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
        createdAt: "1",
        updatedAt: "1",
        ...overrides
      };
    },
    async get(input) {
      return {
        id: input.jobId,
        workspacePath: input.workspacePath,
        command: "pnpm test",
        status: "completed",
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        durationMs: 20,
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
        createdAt: "1",
        updatedAt: "2",
        ...overrides
      };
    }
  };
}
