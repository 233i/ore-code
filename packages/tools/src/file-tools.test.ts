import { describe, expect, it } from "vitest";
import { executeRegisteredTool } from "./executor";
import {
  createFileTools,
  type ApplyPatchOutput,
  type EditFileOutput,
  type FileSearchOutput,
  type FileToolHost,
  type GrepFilesOutput,
  type ListDirOutput,
  type ReadFileOutput,
  type WriteFileOutput
} from "./file-tools";
import { ToolRegistry } from "./registry";
import type { ToolContext } from "./spec";

const host: FileToolHost = {
  async readText(input) {
    return { path: `${input.workspacePath}/${input.path}`, content: "hello" };
  },
  async listDir(input) {
    return {
      entries: [
        { name: "src", path: `${input.workspacePath}/${input.path}/src`, isDir: true },
        { name: "package.json", path: `${input.workspacePath}/${input.path}/package.json`, isDir: false, size: 12 }
      ]
    };
  },
  async searchFiles(input) {
    return {
      matches: [
        {
          path: `${input.workspacePath}/src/app.ts`,
          name: "app.ts",
          isDir: false,
          size: 42
        }
      ],
      truncated: false
    };
  },
  async grepFiles(input) {
    return {
      matches: [
        {
          path: `${input.workspacePath}/src/app.ts`,
          lineNumber: 3,
          line: `const value = "${input.pattern}";`,
          matchStart: 15,
          matchEnd: 15 + input.pattern.length
        }
      ],
      truncated: false
    };
  },
  async writeText(input) {
    return { path: `${input.workspacePath}/${input.path}`, bytesWritten: input.content.length };
  }
};

const context: ToolContext = {
  workspacePath: "/workspace",
  mode: "agent",
  trustedWorkspace: false
};

function registryWithFileTools() {
  const registry = new ToolRegistry();
  for (const tool of createFileTools(host)) {
    registry.register(tool);
  }
  return registry;
}

describe("file tools", () => {
  it("reads files through the file host", async () => {
    const result = await executeRegisteredTool(registryWithFileTools(), "read_file", { path: "README.md" }, context);

    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      const output = result.result.output as ReadFileOutput;
      expect(output).toEqual({ path: "/workspace/README.md", content: "hello" });
    }
  });

  it("lists directories through the file host", async () => {
    const result = await executeRegisteredTool(registryWithFileTools(), "list_dir", { path: "." }, context);

    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      const output = result.result.output as ListDirOutput;
      expect(output.entries[0]).toMatchObject({ name: "src", isDir: true });
    }
  });

  it("searches files by path through the file host", async () => {
    const result = await executeRegisteredTool(
      registryWithFileTools(),
      "file_search",
      { query: "app", path: "src" },
      context
    );

    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      const output = result.result.output as FileSearchOutput;
      expect(output.matches[0]).toMatchObject({ name: "app.ts", isDir: false });
    }
  });

  it("greps files by content through the file host", async () => {
    const result = await executeRegisteredTool(
      registryWithFileTools(),
      "grep_files",
      { pattern: "needle", path: "src" },
      context
    );

    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      const output = result.result.output as GrepFilesOutput;
      expect(output.matches[0]).toMatchObject({ path: "/workspace/src/app.ts", lineNumber: 3 });
    }
  });

  it("requires approval before writing files in agent mode", async () => {
    const result = await executeRegisteredTool(
      registryWithFileTools(),
      "write_file",
      { path: "note.txt", content: "abc" },
      context
    );

    expect(result.type).toBe("approval-required");
  });

  it("writes files in agent mode after approval", async () => {
    const result = await executeRegisteredTool(
      registryWithFileTools(),
      "write_file",
      { path: "note.txt", content: "abc" },
      context,
      { callId: "write-file-1", decision: "approved-once" }
    );

    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      const output = result.result.output as WriteFileOutput;
      expect(output).toEqual({ path: "/workspace/note.txt", bytesWritten: 3 });
    }
  });

  it("requires approval for writes in plan mode", async () => {
    const result = await executeRegisteredTool(
      registryWithFileTools(),
      "write_file",
      { path: "note.txt", content: "abc" },
      { ...context, mode: "plan" }
    );

    expect(result.type).toBe("approval-required");
  });

  it("edits a uniquely matching text range after approval", async () => {
    const mutableHost = createMutableHost({ "src/app.ts": "one\ntwo\nthree\n" });
    const result = await executeRegisteredTool(
      registryWithFileToolsForHost(mutableHost),
      "edit_file",
      { path: "src/app.ts", oldText: "two", newText: "TWO" },
      context,
      { callId: "edit-file-1", decision: "approved-once" }
    );

    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      const output = result.result.output as EditFileOutput;
      expect(output.replacements).toBe(1);
      expect(mutableHost.files["src/app.ts"]).toBe("one\nTWO\nthree\n");
    }
  });

  it("fails edit_file when oldText is not unique", async () => {
    const mutableHost = createMutableHost({ "src/app.ts": "same\nsame\n" });
    const result = await executeRegisteredTool(
      registryWithFileToolsForHost(mutableHost),
      "edit_file",
      { path: "src/app.ts", oldText: "same", newText: "next" },
      context,
      { callId: "edit-file-1", decision: "approved-once" }
    );

    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      expect(result.result.ok).toBe(false);
      expect(result.result.error?.code).toBe("old_text_not_unique");
      expect(mutableHost.files["src/app.ts"]).toBe("same\nsame\n");
    }
  });

  it("applies a unified patch after approval", async () => {
    const mutableHost = createMutableHost({ "src/app.ts": "one\ntwo\nthree\n" });
    const patch = [
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,3 +1,3 @@",
      " one",
      "-two",
      "+TWO",
      " three",
      ""
    ].join("\n");

    const result = await executeRegisteredTool(
      registryWithFileToolsForHost(mutableHost),
      "apply_patch",
      { patch },
      context,
      { callId: "apply-patch-1", decision: "approved-once" }
    );

    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      const output = result.result.output as ApplyPatchOutput;
      expect(output.files[0]).toMatchObject({ hunksApplied: 1 });
      expect(mutableHost.files["src/app.ts"]).toBe("one\nTWO\nthree\n");
    }
  });

  it("preserves CRLF line endings when applying a unified patch", async () => {
    const mutableHost = createMutableHost({ "src/app.ts": "one\r\ntwo\r\nthree\r\n" });
    const patch = [
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,3 +1,3 @@",
      " one",
      "-two",
      "+TWO",
      " three",
      ""
    ].join("\n");

    const result = await executeRegisteredTool(
      registryWithFileToolsForHost(mutableHost),
      "apply_patch",
      { patch },
      context,
      { callId: "apply-patch-1", decision: "approved-once" }
    );

    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      expect(result.result.ok).toBe(true);
      expect(mutableHost.files["src/app.ts"]).toBe("one\r\nTWO\r\nthree\r\n");
    }
  });

  it("preserves missing final newline and CRLF style when applying a unified patch", async () => {
    const mutableHost = createMutableHost({ "src/app.ts": "one\r\ntwo\r\nthree" });
    const patch = [
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,3 +1,3 @@",
      " one",
      "-two",
      "+TWO",
      " three",
      ""
    ].join("\n");

    const result = await executeRegisteredTool(
      registryWithFileToolsForHost(mutableHost),
      "apply_patch",
      { patch },
      context,
      { callId: "apply-patch-1", decision: "approved-once" }
    );

    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      expect(result.result.ok).toBe(true);
      expect(mutableHost.files["src/app.ts"]).toBe("one\r\nTWO\r\nthree");
    }
  });

  it("fails apply_patch when hunk context does not match", async () => {
    const mutableHost = createMutableHost({ "src/app.ts": "one\nwrong\nthree\n" });
    const patch = [
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,3 +1,3 @@",
      " one",
      "-two",
      "+TWO",
      " three",
      ""
    ].join("\n");

    const result = await executeRegisteredTool(
      registryWithFileToolsForHost(mutableHost),
      "apply_patch",
      { patch },
      context,
      { callId: "apply-patch-1", decision: "approved-once" }
    );

    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      expect(result.result.ok).toBe(false);
      expect(result.result.error?.code).toBe("hunk_context_mismatch");
      expect(mutableHost.files["src/app.ts"]).toBe("one\nwrong\nthree\n");
    }
  });
});

function registryWithFileToolsForHost(fileHost: FileToolHost) {
  const registry = new ToolRegistry();
  for (const tool of createFileTools(fileHost)) {
    registry.register(tool);
  }
  return registry;
}

function createMutableHost(initialFiles: Record<string, string>): FileToolHost & { files: Record<string, string> } {
  const files = { ...initialFiles };
  return {
    files,
    async readText(input) {
      const content = files[input.path];
      if (content === undefined) {
        throw new Error(`missing file: ${input.path}`);
      }
      return { path: `${input.workspacePath}/${input.path}`, content };
    },
    async listDir() {
      return { entries: [] };
    },
    async searchFiles() {
      return { matches: [], truncated: false };
    },
    async grepFiles() {
      return { matches: [], truncated: false };
    },
    async writeText(input) {
      files[input.path] = input.content;
      return { path: `${input.workspacePath}/${input.path}`, bytesWritten: input.content.length };
    }
  };
}
