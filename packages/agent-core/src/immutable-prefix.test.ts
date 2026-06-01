import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  createImmutablePrefixSnapshot,
  resolvePrefixInvalidationReason,
  shouldReuseImmutablePrefixSnapshot,
  toolSpecsToLlmDefinitions
} from "./immutable-prefix";
import type { ToolSpec } from "@ore-code/tools";

const readTool: ToolSpec = {
  name: "read_file",
  description: "Read a file.",
  capability: "readonly",
  approval: "never",
  inputSchema: z.object({ path: z.string() }),
  async execute() {
    return { callId: "call-1", ok: true };
  }
};

const writeTool: ToolSpec = {
  name: "write_file",
  description: "Write a file.",
  capability: "workspace-write",
  approval: "required",
  inputSchema: z.object({ path: z.string(), content: z.string() }),
  async execute() {
    return { callId: "call-2", ok: true };
  }
};

describe("immutable prefix snapshot", () => {
  it("freezes core, project, and tool definitions with stable hashes", () => {
    const first = createImmutablePrefixSnapshot({
      provider: "deepseek",
      model: "deepseek-v4-pro",
      workspacePath: "/repo",
      mode: "agent",
      systemPrompt: "  static system  ",
      projectContext: "<project_context>/repo</project_context>",
      toolSpecs: [writeTool, readTool]
    });
    const sameContextDifferentToolOrder = createImmutablePrefixSnapshot({
      provider: "deepseek",
      model: "deepseek-v4-pro",
      workspacePath: "/repo",
      mode: "agent",
      systemPrompt: "static system",
      projectContext: "<project_context>/repo</project_context>",
      toolSpecs: [readTool, writeTool]
    });

    expect(first.contextKey).toBe(sameContextDifferentToolOrder.contextKey);
    expect(first.fingerprint).toBe(sameContextDifferentToolOrder.fingerprint);
    expect(first.toolDefinitions?.map((tool) => tool.function.name)).toEqual(["read_file", "write_file"]);
    expect(shouldReuseImmutablePrefixSnapshot(first, sameContextDifferentToolOrder)).toBe(true);
  });

  it("rebuilds when context identity changes but not solely because tool schemas change", () => {
    const first = createImmutablePrefixSnapshot({
      provider: "deepseek",
      model: "deepseek-v4-pro",
      workspacePath: "/repo",
      mode: "agent",
      systemPrompt: "static system",
      projectContext: "<project_context>/repo</project_context>",
      toolSpecs: [readTool]
    });
    const changedWorkspace = createImmutablePrefixSnapshot({
      provider: "deepseek",
      model: "deepseek-v4-pro",
      workspacePath: "/other",
      mode: "agent",
      systemPrompt: "static system",
      projectContext: "<project_context>/repo</project_context>",
      toolSpecs: [readTool]
    });
    const changedToolsOnly = createImmutablePrefixSnapshot({
      provider: "deepseek",
      model: "deepseek-v4-pro",
      workspacePath: "/repo",
      mode: "agent",
      systemPrompt: "static system",
      projectContext: "<project_context>/repo</project_context>",
      toolSpecs: [readTool, writeTool]
    });

    expect(shouldReuseImmutablePrefixSnapshot(first, changedWorkspace)).toBe(false);
    expect(resolvePrefixInvalidationReason(first, changedWorkspace)).toBe("workspace_changed");
    expect(shouldReuseImmutablePrefixSnapshot(first, changedToolsOnly)).toBe(true);
    expect(first.toolHash).not.toBe(changedToolsOnly.toolHash);
  });

  it("converts tool specs to model definitions", () => {
    expect(toolSpecsToLlmDefinitions([writeTool, readTool])?.map((tool) => tool.function.name)).toEqual([
      "read_file",
      "write_file"
    ]);
  });
});
