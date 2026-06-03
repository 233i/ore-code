import { describe, expect, it } from "vitest";
import type { FileToolHost } from "@ore-code/tools";
import { loadOreCodeInstructions } from "./oreCodeInstructions";

describe("oreCodeInstructions", () => {
  it("loads user and project instructions without treating missing files as errors", async () => {
    const host = makeHost({
      "/Users/test::.ore-code/instructions.md": "Use Chinese for summaries.",
      "/repo::.ore-code/instructions.md": "Run tests before final answers."
    });

    const result = await loadOreCodeInstructions({
      fileHost: host,
      userHomePath: "/Users/test",
      workspacePath: "/repo"
    });

    expect(result.userInstructions).toBe("Use Chinese for summaries.");
    expect(result.projectInstructions).toBe("Run tests before final answers.");
    expect(result.sources).toEqual([
      { path: "~/.ore-code/instructions.md", scope: "user", status: "loaded", error: undefined },
      { path: ".ore-code/instructions.md", scope: "project", status: "loaded", error: undefined }
    ]);
  });

  it("uses Windows path separators for Windows home and workspace paths", async () => {
    const seen: Array<{ workspacePath: string; path: string }> = [];
    const host = makeHost({
      "C:\\Users\\test::.ore-code\\instructions.md": "User rules",
      "D:\\work\\project::.ore-code\\instructions.md": "Project rules"
    }, seen);
    const result = await loadOreCodeInstructions({
      fileHost: host,
      userHomePath: "C:\\Users\\test",
      workspacePath: "D:\\work\\project"
    });

    expect(seen).toContainEqual({ workspacePath: "C:\\Users\\test", path: ".ore-code\\instructions.md" });
    expect(seen).toContainEqual({ workspacePath: "D:\\work\\project", path: ".ore-code\\instructions.md" });
    expect(result.userInstructions).toBe("User rules");
    expect(result.projectInstructions).toBe("Project rules");
  });

  it("skips instruction loading in browser preview without an explicit home path", async () => {
    const result = await loadOreCodeInstructions({
      fileHost: makeHost({ "/repo::.ore-code/instructions.md": "Project rules" }),
      workspacePath: "/repo"
    });

    expect(result.userInstructions).toBeUndefined();
    expect(result.projectInstructions).toBeUndefined();
    expect(result.sources).toEqual([]);
  });
});

function makeHost(
  files: Record<string, string>,
  seen: Array<{ workspacePath: string; path: string }> = []
): FileToolHost {
  return {
    async readText(input) {
      seen.push({ workspacePath: input.workspacePath, path: input.path });
      const key = `${input.workspacePath}::${input.path}`;
      if (!(key in files)) {
        throw new Error("No such file or directory");
      }
      return { path: input.path, content: files[key] };
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
      files[`${input.workspacePath}::${input.path}`] = input.content;
      return { path: input.path, bytesWritten: input.content.length };
    }
  };
}
