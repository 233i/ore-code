import { describe, expect, it } from "vitest";
import { createLspDiagnosticsTool } from "./lsp-diagnostics";
import type { FileToolHost } from "./file-tools";
import type { ProcessToolHost } from "./process-tools";
import type { ToolContext } from "./spec";

const context: ToolContext = {
  workspacePath: "/workspace",
  mode: "agent",
  trustedWorkspace: false
};

describe("lsp_diagnostics tool", () => {
  it("runs TypeScript diagnostics and parses tsc output", async () => {
    const calls: Array<{ program: string; args: string[] }> = [];
    const tool = createLspDiagnosticsTool(makeFileHost(["tsconfig.json"]), makeProcessHost(calls, {
      stdout: "src/App.tsx(12,7): error TS2322: Type 'string' is not assignable to type 'number'.\n",
      exitCode: 2
    }));

    const result = await tool.execute({ analyzers: ["typescript"] }, context);

    expect(calls[0]).toMatchObject({ program: "pnpm", args: ["exec", "tsc", "--noEmit", "--pretty", "false"] });
    expect(result.output).toMatchObject({
      diagnostics: [{
        analyzer: "typescript",
        file: "src/App.tsx",
        line: 12,
        column: 7,
        severity: "error",
        code: "TS2322",
        message: "Type 'string' is not assignable to type 'number'."
      }],
      summary: {
        errors: 1,
        failedAnalyzers: 1
      }
    });
  });

  it("parses pyright JSON diagnostics", async () => {
    const tool = createLspDiagnosticsTool(makeFileHost(["app.py"]), makeProcessHost([], {
      stdout: JSON.stringify({
        generalDiagnostics: [{
          file: "/workspace/app.py",
          severity: "warning",
          message: "Type is partially unknown",
          rule: "reportUnknownVariableType",
          range: { start: { line: 4, character: 2 } }
        }]
      }),
      exitCode: 1
    }));

    const result = await tool.execute({ analyzers: ["python"] }, context);

    expect(result.output).toMatchObject({
      diagnostics: [{
        analyzer: "python",
        file: "/workspace/app.py",
        line: 5,
        column: 3,
        severity: "warning",
        code: "reportUnknownVariableType"
      }],
      summary: {
        warnings: 1
      }
    });
  });

  it("marks missing analyzers as unavailable", async () => {
    const tool = createLspDiagnosticsTool(makeFileHost(["app.py"]), makeProcessHost([], {}, true));

    const result = await tool.execute({ analyzers: ["python"] }, context);

    expect(result.output).toMatchObject({
      analyzers: [{
        analyzer: "python",
        status: "unavailable",
        diagnostics: []
      }],
      summary: {
        unavailableAnalyzers: 1
      }
    });
  });
});

function makeProcessHost(
  calls: Array<{ program: string; args: string[] }>,
  output: { stdout?: string; stderr?: string; exitCode?: number | null } = {},
  failToStart = false
): ProcessToolHost {
  return {
    async run(input) {
      calls.push({ program: input.program, args: input.args ?? [] });
      if (failToStart) {
        throw new Error(`${input.program} not found`);
      }
      return {
        program: input.program,
        args: input.args ?? [],
        command: [input.program, ...(input.args ?? [])].join(" "),
        exitCode: output.exitCode ?? 0,
        stdout: output.stdout ?? "",
        stderr: output.stderr ?? "",
        durationMs: 10,
        timedOut: false
      };
    }
  };
}

function makeFileHost(paths: string[]): FileToolHost {
  return {
    async readText(input) {
      return { path: input.path, content: "" };
    },
    async listDir() {
      return { entries: [] };
    },
    async searchFiles(input) {
      const matches = paths
        .filter((path) => path.includes(input.query))
        .map((path) => ({ path, name: path.split(/[\\/]/).pop() ?? path, isDir: false }));
      return { matches, truncated: false };
    },
    async grepFiles() {
      return { matches: [], truncated: false };
    },
    async writeText(input) {
      return { path: input.path, bytesWritten: input.content.length };
    }
  };
}
