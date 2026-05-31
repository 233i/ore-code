import { describe, expect, it } from "vitest";
import { executeRegisteredTool } from "./executor";
import type { GitToolHost } from "./git-tools";
import { ToolRegistry } from "./registry";
import { createStructuredReviewTool, type StructuredReviewOutput } from "./review-tools";
import type { ToolContext } from "./spec";

const context: ToolContext = {
  workspacePath: "/workspace",
  mode: "agent",
  trustedWorkspace: false
};

describe("structured_review tool", () => {
  it("reviews the workspace diff by default", async () => {
    const result = await executeRegisteredTool(
      registryWithReviewTool(makeHost({ diff: [
        "diff --git a/src/app.ts b/src/app.ts",
        "--- a/src/app.ts",
        "+++ b/src/app.ts",
        "@@ -1,1 +1,3 @@",
        " export function run() {",
        "+  console.log('debug');",
        "+  return true as any;",
        " }"
      ].join("\n") })),
      "structured_review",
      {},
      context
    );

    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      const output = result.result.output as StructuredReviewOutput;
      expect(output.scope).toBe("workspace");
      expect(output.files).toEqual([{ path: "src/app.ts", additions: 2, deletions: 0 }]);
      expect(output.findings).toEqual(expect.arrayContaining([
        expect.objectContaining({ category: "debug", severity: "warning", path: "src/app.ts", line: 2 }),
        expect.objectContaining({ category: "tests", severity: "warning" })
      ]));
      expect(output.riskLevel).toBe("low");
    }
  });

  it("accepts explicit diff input for PR review", async () => {
    const result = await executeRegisteredTool(
      registryWithReviewTool(makeHost()),
      "structured_review",
      {
        scope: "pr",
        title: "PR 42",
        diff: [
          "diff --git a/src/app.test.ts b/src/app.test.ts",
          "--- a/src/app.test.ts",
          "+++ b/src/app.test.ts",
          "@@ -1,1 +1,2 @@",
          "+test.only('focus', () => {});"
        ].join("\n")
      },
      context
    );

    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      expect(result.result.output).toMatchObject({
        scope: "pr",
        source: "PR 42",
        riskLevel: "high",
        findingCounts: { critical: 1 }
      });
    }
  });

  it("loads revision diffs through git show", async () => {
    const calls: Array<{ rev: string; path?: string }> = [];
    const result = await executeRegisteredTool(
      registryWithReviewTool(makeHost({ calls })),
      "structured_review",
      { scope: "revision", rev: "HEAD~1", path: "src/app.ts" },
      context
    );

    expect(result.type).toBe("completed");
    expect(calls).toEqual([{ rev: "HEAD~1", path: "src/app.ts" }]);
  });

  it("requires explicit diff for PR scope", async () => {
    const result = await executeRegisteredTool(
      registryWithReviewTool(makeHost()),
      "structured_review",
      { scope: "pr" },
      context
    );

    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      expect(result.result.ok).toBe(false);
      expect(result.result.error?.code).toBe("pr_diff_required");
    }
  });
});

function registryWithReviewTool(host: GitToolHost) {
  const registry = new ToolRegistry();
  registry.register(createStructuredReviewTool(host));
  return registry;
}

function makeHost(input: {
  diff?: string;
  isRepo?: boolean;
  calls?: Array<{ rev: string; path?: string }>;
} = {}): GitToolHost {
  const diff = input.diff ?? [
    "diff --git a/src/app.ts b/src/app.ts",
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -1,1 +1,1 @@",
    "+export const ok = true;"
  ].join("\n");

  return {
    async status() {
      return { isRepo: true, entries: [], raw: "" };
    },
    async diff() {
      return { isRepo: input.isRepo ?? true, diff };
    },
    async branch() {
      return { isRepo: true, branches: [], raw: "" };
    },
    async log() {
      return { isRepo: true, output: "" };
    },
    async show(request) {
      input.calls?.push({ rev: request.rev, path: request.path });
      return { isRepo: input.isRepo ?? true, output: diff };
    },
    async blame() {
      return { isRepo: true, output: "" };
    }
  };
}
