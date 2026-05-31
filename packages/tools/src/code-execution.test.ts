import { describe, expect, it } from "vitest";
import { executeRegisteredTool } from "./executor";
import { ToolRegistry } from "./registry";
import { createCodeExecutionTool, type CodeExecutionOutput } from "./code-execution";
import type { ProcessToolHost } from "./process-tools";
import type { ToolContext } from "./spec";

const context: ToolContext = {
  workspacePath: "/workspace",
  mode: "agent",
  trustedWorkspace: false
};

describe("code_execution tool", () => {
  it("requires approval outside yolo because it executes Python locally", async () => {
    const result = await executeRegisteredTool(
      registryWithCodeExecution(makeHost()),
      "code_execution",
      { code: "print(1 + 1)" },
      context
    );

    expect(result.type).toBe("approval-required");
  });

  it("runs approved deterministic Python snippets", async () => {
    const calls: Array<{ program: string; args: string[]; stdin?: string; timeoutMs: number }> = [];
    const result = await executeRegisteredTool(
      registryWithCodeExecution(makeHost(calls)),
      "code_execution",
      { code: "import statistics\nprint(statistics.mean([1, 2, 3]))" },
      context,
      { callId: "code-1", decision: "approved-once" },
      { callId: "code-1" }
    );

    expect(result.type).toBe("completed");
    expect(calls[0]).toMatchObject({ program: "python3", timeoutMs: 10_000 });
    expect(calls[0].args).toEqual(expect.arrayContaining(["-I", "-S", "-c"]));
    expect(calls[0].stdin).toContain("statistics.mean");
    if (result.type === "completed") {
      expect(result.result.output).toMatchObject({
        language: "python",
        passed: true,
        stdout: "2\n"
      });
    }
  });

  it("summarizes failed Python snippets", async () => {
    const result = await executeRegisteredTool(
      registryWithCodeExecution(makeHost([], { exitCode: 1, stdout: "", stderr: "ImportError: module not allowed: os\n" })),
      "code_execution",
      { code: "import os" },
      context,
      { callId: "code-1", decision: "approved-once" }
    );

    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      const output = result.result.output as CodeExecutionOutput;
      expect(output.passed).toBe(false);
      expect(output.stderr).toContain("module not allowed");
      expect(output.summary).toContain("failed");
    }
  });
});

function registryWithCodeExecution(host: ProcessToolHost) {
  const registry = new ToolRegistry();
  registry.register(createCodeExecutionTool(host));
  return registry;
}

function makeHost(
  calls: Array<{ program: string; args: string[]; stdin?: string; timeoutMs: number }> = [],
  output: Partial<CodeExecutionOutput> = {}
): ProcessToolHost {
  return {
    async run(input) {
      calls.push({ program: input.program, args: input.args ?? [], stdin: input.stdin, timeoutMs: input.timeoutMs });
      return {
        program: input.program,
        args: input.args ?? [],
        command: [input.program, ...(input.args ?? [])].join(" "),
        exitCode: 0,
        stdout: "2\n",
        stderr: "",
        durationMs: 8,
        timedOut: false,
        ...output
      };
    }
  };
}
