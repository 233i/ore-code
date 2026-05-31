import { describe, expect, it } from "vitest";
import { executeRegisteredTool } from "./executor";
import { ToolRegistry } from "./registry";
import { createRunTestsTool, resolveRunTestsCommand, type RunTestsOutput } from "./test-tools";
import type { ProcessToolHost } from "./process-tools";
import type { ShellToolHost } from "./shell-tools";
import type { ToolContext } from "./spec";

const context: ToolContext = {
  workspacePath: "/workspace",
  mode: "agent",
  trustedWorkspace: false
};

describe("run_tests tool", () => {
  it("resolves built-in targets to test commands", () => {
    expect(resolveRunTestsCommand({ target: "desktop" })).toEqual({
      target: "desktop",
      command: "pnpm --filter @seekforge/desktop test",
      custom: false
    });
    expect(resolveRunTestsCommand({ target: "tauri" })).toEqual({
      target: "tauri",
      command: "cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml",
      custom: false
    });
  });

  it("runs the selected test target through the shell host", async () => {
    const calls: Array<{ workspacePath: string; command: string; timeoutMs: number }> = [];
    const result = await executeRegisteredTool(
      registryWithRunTests(makeHost(calls)),
      "run_tests",
      { target: "agent-core" },
      context
    );

    expect(calls).toEqual([{
      workspacePath: "/workspace",
      command: "pnpm --filter @seekforge/agent-core test",
      sandboxPolicy: expect.objectContaining({ enabled: true, envMode: "inherit-safe" }),
      timeoutMs: 30_000
    }]);
    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      expect(result.result.output).toMatchObject({
        target: "agent-core",
        command: "pnpm --filter @seekforge/agent-core test",
        passed: true,
        summary: "Tests passed for agent-core in 12ms."
      });
    }
  });

  it("runs built-in targets through the process host when available", async () => {
    const shellCalls: Array<{ workspacePath: string; command: string; timeoutMs: number }> = [];
    const processCalls: Array<{ workspacePath: string; program: string; args: string[]; timeoutMs: number; sandboxPolicy?: unknown }> = [];
    const result = await executeRegisteredTool(
      registryWithRunTests(makeHost(shellCalls), makeProcessHost(processCalls)),
      "run_tests",
      { target: "desktop" },
      context
    );

    expect(result.type).toBe("completed");
    expect(shellCalls).toEqual([]);
    expect(processCalls).toEqual([{
      workspacePath: "/workspace",
      program: "pnpm",
      args: ["--filter", "@seekforge/desktop", "test"],
      sandboxPolicy: expect.objectContaining({ enabled: true, envMode: "inherit-safe" }),
      timeoutMs: 30_000
    }]);
  });

  it("lets explicit custom commands override the target", async () => {
    const calls: Array<{ workspacePath: string; command: string; timeoutMs: number }> = [];
    const result = await executeRegisteredTool(
      registryWithRunTests(makeHost(calls)),
      "run_tests",
      { target: "desktop", command: "pnpm --filter @seekforge/desktop test -- --runInBand", timeoutMs: 60_000 },
      context
    );

    expect(result.type).toBe("completed");
    expect(calls).toEqual([{
      workspacePath: "/workspace",
      command: "pnpm --filter @seekforge/desktop test -- --runInBand",
      timeoutMs: 60_000
    }]);
  });

  it("returns failed test summaries and truncates large logs", async () => {
    const longStdout = `AssertionError: expected true to be false\n${"x".repeat(20_010)}`;
    const result = await executeRegisteredTool(
      registryWithRunTests(makeHost([], {
        exitCode: 1,
        stdout: longStdout,
        stderr: "FAIL src/example.test.ts\nError: nope",
        timedOut: false
      })),
      "run_tests",
      { target: "tools" },
      context
    );

    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      const output = result.result.output as RunTestsOutput;
      expect(output.passed).toBe(false);
      expect(output.summary).toBe("Tests failed for tools with exit 1.");
      expect(output.failureSummary).toContain("FAIL src/example.test.ts");
      expect(output.failureSummary).toContain("AssertionError");
      expect(output.stdout).toHaveLength(20_000);
      expect(output.stdoutTruncated).toBe(true);
    }
  });

  it("requires approval for mutating custom commands", async () => {
    const result = await executeRegisteredTool(
      registryWithRunTests(makeHost()),
      "run_tests",
      { command: "pnpm install && pnpm test" },
      context
    );

    expect(result.type).toBe("approval-required");
  });
});

function registryWithRunTests(host: ShellToolHost, processHost?: ProcessToolHost) {
  const registry = new ToolRegistry();
  registry.register(createRunTestsTool(host, { processHost }));
  return registry;
}

function makeHost(
  calls: Array<{ workspacePath: string; command: string; timeoutMs: number; sandboxPolicy?: unknown }> = [],
  overrides: Partial<RunTestsOutput> = {}
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

function makeProcessHost(
  calls: Array<{ workspacePath: string; program: string; args: string[]; timeoutMs: number; sandboxPolicy?: unknown }> = []
): ProcessToolHost {
  return {
    async run(input) {
      calls.push({
        workspacePath: input.workspacePath,
        program: input.program,
        args: input.args ?? [],
        sandboxPolicy: input.sandboxPolicy,
        timeoutMs: input.timeoutMs
      });
      return {
        program: input.program,
        args: input.args ?? [],
        command: [input.program, ...(input.args ?? [])].join(" "),
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        durationMs: 12,
        timedOut: false
      };
    }
  };
}
