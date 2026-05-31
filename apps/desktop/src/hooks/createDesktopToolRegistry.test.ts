import { describe, expect, it } from "vitest";
import type { FileToolHost, ShellToolHost } from "@seekforge/tools";
import { createRuntimeArtifactStore } from "../services/artifactStore";
import { createDesktopToolRegistry, isDesktopToolAllowedForProfile } from "./createDesktopToolRegistry";

describe("createDesktopToolRegistry", () => {
  it("registers shared desktop tools in one place", async () => {
    const registry = await createDesktopToolRegistry({
      activeModel: "mock",
      artifactStore: createRuntimeArtifactStore(),
      deepSeekBaseUrl: "",
      deepSeekModel: "deepseek-v4-pro",
      effectiveProviderConfig: null,
      fileHost: makeFileHost(),
      provider: "mock",
      resolveProviderApiKey: async () => null,
      shellHost: makeShellHost(),
      workspacePath: "/tmp/workspace"
    });

    expect(registry.list().map((tool) => tool.name)).toEqual(expect.arrayContaining([
      "apply_patch",
      "code_execution",
      "exec_shell",
      "install_skill",
      "lsp_definition",
      "lsp_diagnostics",
      "read_file",
      "run_tests",
      "structured_review",
      "tool_search",
      "validate_data",
      "web_search"
    ]));
  });

  it("registers memory index/read tools when notes are enabled", async () => {
    const registry = await createDesktopToolRegistry({
      activeModel: "mock",
      artifactStore: createRuntimeArtifactStore(),
      deepSeekBaseUrl: "",
      deepSeekModel: "deepseek-v4-pro",
      effectiveProviderConfig: null,
      enableNoteTool: true,
      fileHost: makeFileHost(),
      provider: "mock",
      resolveProviderApiKey: async () => null,
      shellHost: makeShellHost(),
      workspacePath: "/tmp/workspace"
    });

    expect(registry.list().map((tool) => tool.name)).toEqual(expect.arrayContaining([
      "note",
      "note_list",
      "note_read"
    ]));
  });

  it("only registers plan interaction when explicitly enabled", async () => {
    const baseOptions = {
      activeModel: "mock",
      artifactStore: createRuntimeArtifactStore(),
      deepSeekBaseUrl: "",
      deepSeekModel: "deepseek-v4-pro",
      effectiveProviderConfig: null,
      fileHost: makeFileHost(),
      provider: "mock",
      resolveProviderApiKey: async () => null,
      shellHost: makeShellHost(),
      workspacePath: "/tmp/workspace"
    };

    const agentRegistry = await createDesktopToolRegistry(baseOptions);
    const planRegistry = await createDesktopToolRegistry({ ...baseOptions, enableInteractionTool: true });

    expect(agentRegistry.get("request_user_input")).toBeUndefined();
    expect(planRegistry.get("request_user_input")).toBeTruthy();
  });

  it("registers stable MCP gateway tools instead of expanded MCP server tools", async () => {
    const registry = await createDesktopToolRegistry({
      activeModel: "mock",
      artifactStore: createRuntimeArtifactStore(),
      deepSeekBaseUrl: "",
      deepSeekModel: "deepseek-v4-pro",
      effectiveProviderConfig: null,
      enableMcpTools: true,
      fileHost: makeFileHost(),
      provider: "mock",
      resolveProviderApiKey: async () => null,
      shellHost: makeShellHost(),
      workspacePath: "/tmp/workspace"
    });

    expect(registry.list().map((tool) => tool.name)).toEqual(expect.arrayContaining([
      "mcp_apply_prompt",
      "mcp_call_tool",
      "mcp_list_tools",
      "mcp_read_resource"
    ]));
  });

  it("limits readonly profile to read, list, search, and diff tools", async () => {
    const registry = await createDesktopToolRegistry({
      activeModel: "deepseek-v4-flash",
      artifactStore: createRuntimeArtifactStore(),
      deepSeekBaseUrl: "",
      deepSeekModel: "deepseek-v4-pro",
      effectiveProviderConfig: null,
      enableMcpTools: true,
      fileHost: makeFileHost(),
      provider: "deepseek",
      resolveProviderApiKey: async () => null,
      shellHost: makeShellHost(),
      toolProfile: "readonly",
      workspacePath: "/tmp/workspace"
    });

    const names = registry.list().map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining([
      "git_diff",
      "grep_files",
      "list_dir",
      "mcp_list_tools",
      "mcp_read_resource",
      "read_file",
      "tool_search"
    ]));
    expect(names).not.toEqual(expect.arrayContaining([
      "apply_patch",
      "code_execution",
      "exec_shell",
      "mcp_call_tool",
      "run_tests",
      "install_skill",
      "write_file"
    ]));

    const search = registry.get("tool_search");
    const result = await search?.execute(
      { query: "write", maxResults: 20 },
      { workspacePath: "/tmp/workspace", mode: "agent", trustedWorkspace: false }
    );
    const output = result?.output as { results: Array<{ name: string }> } | undefined;
    const searchedNames = output?.results.map((tool) => tool.name) ?? [];
    expect(searchedNames).not.toEqual(expect.arrayContaining(["apply_patch", "write_file"]));
  });

  it("classifies write and shell tools as disallowed for readonly profile", () => {
    expect(isDesktopToolAllowedForProfile("read_file", "readonly")).toBe(true);
    expect(isDesktopToolAllowedForProfile("git_diff", "readonly")).toBe(true);
    expect(isDesktopToolAllowedForProfile("apply_patch", "readonly")).toBe(false);
    expect(isDesktopToolAllowedForProfile("install_skill", "readonly")).toBe(false);
    expect(isDesktopToolAllowedForProfile("exec_shell", "readonly")).toBe(false);
    expect(isDesktopToolAllowedForProfile("mcp_call_tool", "readonly")).toBe(false);
  });
});

function makeFileHost(): FileToolHost {
  return {
    async readText(input) {
      return { path: input.path, content: "" };
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
      return { path: input.path, bytesWritten: input.content.length };
    }
  };
}

function makeShellHost(): ShellToolHost {
  return {
    async run(input) {
      return {
        command: input.command,
        durationMs: 0,
        exitCode: 0,
        stderr: "",
        stdout: "",
        timedOut: false
      };
    }
  };
}
