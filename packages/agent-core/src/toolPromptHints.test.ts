import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ToolRegistry, type ToolSpec } from "@seekforge/tools";
import { toolNamesFromPromptHintSource, toolPromptHintLines } from "./toolPromptHints";

describe("tool prompt hints", () => {
  it("derives sorted tool names from a registry", () => {
    const registry = new ToolRegistry();
    registry.register(tool("run_tests"));
    registry.register(tool("read_file"));

    expect(toolNamesFromPromptHintSource(registry)).toEqual(["read_file", "run_tests"]);
  });

  it("only mentions registered tool-specific guidance", () => {
    const lines = toolPromptHintLines(["read_file", "grep_files", "git_diff"]).join("\n");

    expect(lines).toContain("Read files with read_file");
    expect(lines).toContain("Search file contents with grep_files");
    expect(lines).toContain("Inspect Git status, diffs, history");
    expect(lines).not.toContain("run_tests");
    expect(lines).not.toContain("install_skill");
    expect(lines).not.toContain("mcp_list_tools");
    expect(lines).not.toContain("lsp_hover");
  });

  it("keeps legacy full guidance when no registry is supplied", () => {
    const lines = toolPromptHintLines().join("\n");

    expect(lines).toContain("Run test validation with run_tests before shelling out");
    expect(lines).toContain("Install SeekForge skills with install_skill");
    expect(lines).toContain("Use MCP through the stable gateway tools");
    expect(lines).toContain("Use lsp_hover, lsp_definition, lsp_references, and lsp_document_symbols");
  });
});

function tool(name: string): ToolSpec {
  return {
    name,
    description: name,
    capability: "readonly",
    approval: "never",
    inputSchema: z.object({}),
    async execute() {
      return { callId: name, ok: true, output: {} };
    }
  };
}
