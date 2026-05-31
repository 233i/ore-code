import { describe, expect, it } from "vitest";
import { executeRegisteredTool } from "./executor";
import { createGitTools, type GitDiffOutput, type GitToolHost } from "./git-tools";
import { ToolRegistry } from "./registry";
import type { ToolContext } from "./spec";

const context: ToolContext = {
  workspacePath: "/workspace",
  mode: "agent",
  trustedWorkspace: false
};

function registryWithGitTools(host: GitToolHost) {
  const registry = new ToolRegistry();
  for (const tool of createGitTools(host)) {
    registry.register(tool);
  }
  return registry;
}

describe("git tools", () => {
  it("reads git status without approval", async () => {
    const result = await executeRegisteredTool(
      registryWithGitTools(makeHost()),
      "git_status",
      {},
      context
    );

    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      expect(result.result.output).toMatchObject({
        isRepo: true,
        branch: "main",
        changedFiles: 1
      });
    }
  });

  it("allows git status in plan mode", async () => {
    const result = await executeRegisteredTool(
      registryWithGitTools(makeHost()),
      "git_status",
      {},
      { ...context, mode: "plan" }
    );

    expect(result.type).toBe("completed");
  });

  it("returns a structured non-git error", async () => {
    const result = await executeRegisteredTool(
      registryWithGitTools(makeHost({ isRepo: false, error: "not a git repository" })),
      "git_status",
      {},
      context
    );

    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      expect(result.result.ok).toBe(false);
      expect(result.result.error?.code).toBe("not_git_workspace");
    }
  });

  it("reads and truncates git diff", async () => {
    const longDiff = "x".repeat(40_010);
    const result = await executeRegisteredTool(
      registryWithGitTools(makeHost({ diff: longDiff })),
      "git_diff",
      { staged: true },
      context
    );

    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      const output = result.result.output as GitDiffOutput;
      expect(output.staged).toBe(true);
      expect(output.diff).toHaveLength(40_000);
      expect(output.truncated).toBe(true);
    }
  });

  it("passes an optional path filter to git diff", async () => {
    let requestedPath: string | undefined;
    const host = makeHost();
    const originalDiff = host.diff;
    host.diff = async (input) => {
      requestedPath = input.path;
      return originalDiff(input);
    };

    const result = await executeRegisteredTool(
      registryWithGitTools(host),
      "git_diff",
      { staged: false, path: "src/app.ts" },
      context
    );

    expect(result.type).toBe("completed");
    expect(requestedPath).toBe("src/app.ts");
    if (result.type === "completed") {
      expect((result.result.output as GitDiffOutput).path).toBe("src/app.ts");
    }
  });

  it("registers structured git review tools", async () => {
    const registry = registryWithGitTools(makeHost());

    await expect(executeRegisteredTool(registry, "git_branch", {}, context)).resolves.toMatchObject({ type: "completed" });
    await expect(executeRegisteredTool(registry, "git_log", { maxCount: 5 }, context)).resolves.toMatchObject({ type: "completed" });
    await expect(executeRegisteredTool(registry, "git_show", { rev: "HEAD" }, context)).resolves.toMatchObject({ type: "completed" });
    await expect(executeRegisteredTool(registry, "git_blame", { path: "src/app.ts" }, context)).resolves.toMatchObject({ type: "completed" });
  });
});

function makeHost(
  overrides: Partial<{
    isRepo: boolean;
    error: string;
    diff: string;
  }> = {}
): GitToolHost {
  return {
    async status() {
      return {
        isRepo: overrides.isRepo ?? true,
        branch: "main",
        entries: [{ status: "M", path: "src/app.ts" }],
        raw: "## main\n M src/app.ts",
        error: overrides.error
      };
    },
    async diff(input) {
      return {
        isRepo: overrides.isRepo ?? true,
        diff: overrides.diff ?? `diff --git a/src/app.ts b/src/app.ts\n+${input.staged ? "staged" : "unstaged"}\n`,
        error: overrides.error
      };
    },
    async branch() {
      return {
        isRepo: overrides.isRepo ?? true,
        current: "main",
        branches: ["main"],
        raw: "* main",
        error: overrides.error
      };
    },
    async log(input) {
      return {
        isRepo: overrides.isRepo ?? true,
        output: `abc123 commit history ${input.maxCount}`,
        error: overrides.error
      };
    },
    async show(input) {
      return {
        isRepo: overrides.isRepo ?? true,
        output: `commit ${input.rev}`,
        error: overrides.error
      };
    },
    async blame(input) {
      return {
        isRepo: overrides.isRepo ?? true,
        output: `abc123 (${input.path} 1) line`,
        error: overrides.error
      };
    }
  };
}
