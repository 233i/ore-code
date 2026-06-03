import { describe, expect, it } from "vitest";
import { createMcpGatewayTools, emptyMcpSnapshot, mcpConnectionSummary, type McpHost, type McpToolSnapshot } from "./mcpHost";

describe("mcpHost", () => {
  it("exposes a stable MCP gateway tool set", () => {
    const tools = createMcpGatewayTools(fakeHost());

    expect(tools.map((tool) => tool.name)).toEqual([
      "mcp_list_tools",
      "mcp_call_tool",
      "mcp_read_resource",
      "mcp_apply_prompt"
    ]);
    const [, callTool] = tools;

    expect(callTool.modelParameters).toMatchObject({
      required: ["qualifiedName", "arguments"],
      additionalProperties: false
    });
  });

  it("lists MCP tools through the gateway without registering each tool as a model function", async () => {
    const tools = createMcpGatewayTools(fakeHost(emptyMcpSnapshot({
      configured: true,
      servers: [],
      tools: [
        {
          annotations: { readOnlyHint: true },
          description: "Read data",
          inputSchema: { type: "object", properties: { q: { type: "string" } } },
          name: "read",
          qualifiedName: "mcp_demo_read",
          serverName: "demo"
        }
      ]
    })));
    const [listTools] = tools;

    await expect(listTools.execute({}, { workspacePath: ".", mode: "yolo", trustedWorkspace: true })).resolves.toMatchObject({
      ok: true,
      output: {
        tools: [
          {
            qualifiedName: "mcp_demo_read",
            inputSchema: { type: "object", properties: { q: { type: "string" } } },
            readOnly: true
          }
        ]
      }
    });
  });

  it("uses high-risk approval for MCP tool calls while keeping list/resource/prompt readonly", () => {
    const [listTools, callTool, resourceTool, promptTool] = createMcpGatewayTools(fakeHost());

    expect(callTool).toMatchObject({
      capability: "high-risk",
      approval: "required"
    });
    expect(listTools).toMatchObject({
      capability: "readonly",
      approval: "never"
    });
    expect(resourceTool).toMatchObject({
      capability: "readonly",
      approval: "never"
    });
    expect(promptTool).toMatchObject({
      capability: "readonly",
      approval: "never"
    });
  });

  it("executes MCP tool calls through the gateway host", async () => {
    const [, callTool] = createMcpGatewayTools(fakeHost(emptyMcpSnapshot({
      configured: true,
      servers: [],
      tools: [
        {
          description: "Ping",
          inputSchema: { type: "object" },
          name: "ping",
          qualifiedName: "mcp_demo_ping",
          serverName: "demo"
        }
      ]
    })));

    await expect(callTool.execute({ qualifiedName: "mcp_demo_ping", arguments: { message: "hello" } }, { workspacePath: ".", mode: "yolo", trustedWorkspace: true })).resolves.toMatchObject({
      ok: true,
      output: {
        server: "demo",
        tool: "ping",
        content: { message: "hello" }
      }
    });
  });

  it("fails missing MCP tool calls with a repairable error", async () => {
    const [, callTool] = createMcpGatewayTools(fakeHost());

    await expect(callTool.execute({ qualifiedName: "mcp_missing", arguments: {} }, { workspacePath: ".", mode: "yolo", trustedWorkspace: true })).resolves.toMatchObject({
      ok: false,
      error: {
        code: "mcp_tool_not_found"
      }
    });
  });

  it("reads resources and fetches prompts through stable gateway tools", async () => {
    const [, , resourceTool, promptTool] = createMcpGatewayTools(fakeHost());
    const runtimeEvents: unknown[] = [];
    const context = {
      workspacePath: ".",
      mode: "yolo" as const,
      trustedWorkspace: true,
      onRuntimeEvent: (event: unknown) => runtimeEvents.push(event)
    };

    await expect(resourceTool.execute({ serverName: "demo", uri: "file://readme" }, context)).resolves.toMatchObject({
      ok: true,
      output: {
        text: "resource:file://readme"
      }
    });
    await expect(promptTool.execute({ serverName: "demo", name: "review", arguments: { topic: "ui" } }, context)).resolves.toMatchObject({
      ok: true,
      output: {
        prompt: "prompt:review"
      }
    });
    expect(runtimeEvents).toEqual([
      expect.objectContaining({ type: "lazy_context_loaded", source: "mcp_resource", sourceId: "demo:file://readme" }),
      expect.objectContaining({ type: "lazy_context_loaded", source: "mcp_prompt", sourceId: "demo:review" })
    ]);
  });

  it("summarizes connection states", () => {
    expect(mcpConnectionSummary(null)).toBe("MCP 未加载");
    expect(mcpConnectionSummary(emptyMcpSnapshot({ supported: false }))).toBe("MCP 不可用");
    expect(mcpConnectionSummary(emptyMcpSnapshot())).toBe("MCP 未配置");
    expect(mcpConnectionSummary(emptyMcpSnapshot({
      configured: true,
      servers: [{
        args: [],
        executeTimeoutSecs: 5,
        name: "demo",
        promptCount: 0,
        prompts: [],
        resourceCount: 0,
        resources: [],
        status: "connected",
        toolCount: 1,
        tools: [],
        transport: "stdio"
      }],
      tools: [{
        description: "Ping",
        inputSchema: {},
        name: "ping",
        qualifiedName: "mcp_demo_ping",
        serverName: "demo"
      }]
    }))).toBe("MCP: 1 tools");
  });
});

function fakeHost(snapshot: McpToolSnapshot = emptyMcpSnapshot()): McpHost {
  return {
    async addServer() {
      return emptyMcpSnapshot();
    },
    async callTool(input) {
      return {
        content: input.arguments,
        isError: false,
        server: "demo",
        tool: input.qualifiedName.replace(/^mcp_demo_/, "")
      };
    },
    async configStatus() {
      return emptyMcpSnapshot();
    },
    async getPrompt(input) {
      return {
        content: {},
        prompt: `prompt:${input.name}`,
        server: input.serverName,
        name: input.name
      };
    },
    async initConfig() {
      return emptyMcpSnapshot();
    },
    async loadSnapshot() {
      return snapshot;
    },
    async reload() {
      return emptyMcpSnapshot();
    },
    async reloadServer() {
      return emptyMcpSnapshot();
    },
    async readResource(input) {
      return {
        content: {},
        server: input.serverName,
        text: `resource:${input.uri}`,
        uri: input.uri
      };
    },
    async removeServer() {
      return emptyMcpSnapshot();
    },
    async setServerEnabled() {
      return emptyMcpSnapshot();
    },
    async stopAll() {
      return undefined;
    },
    async updateServer() {
      return emptyMcpSnapshot();
    },
    async validateConfig() {
      return { configPath: "~/.ore-code/mcp.json", errors: [], ok: true, servers: [] };
    }
  };
}
