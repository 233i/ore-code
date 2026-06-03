import { invoke } from "@tauri-apps/api/core";
import { createLazyContextEventBody } from "@ore-code/agent-core";
import type { ToolSpec } from "@ore-code/tools";
import { isTauriRuntime } from "./fileHost";
import {
  buildMcpGatewayCatalog,
  findMcpTool,
  MCP_APPLY_PROMPT_MODEL_PARAMETERS,
  MCP_APPLY_PROMPT_TOOL_NAME,
  MCP_CALL_TOOL_MODEL_PARAMETERS,
  MCP_CALL_TOOL_NAME,
  MCP_LIST_TOOLS_MODEL_PARAMETERS,
  MCP_LIST_TOOLS_TOOL_NAME,
  MCP_READ_RESOURCE_MODEL_PARAMETERS,
  MCP_READ_RESOURCE_TOOL_NAME,
  McpApplyPromptInputSchema,
  McpCallToolInputSchema,
  McpListToolsInputSchema,
  McpReadResourceInputSchema,
  type McpApplyPromptInput,
  type McpCallToolInput,
  type McpListToolsInput,
  type McpReadResourceInput
} from "./mcpGatewayContract";

const DEFAULT_MCP_CONFIG_PATH = "~/.ore-code/mcp.json";

export type McpServerTransport = "stdio" | "http";
export type McpServerStatus = "connected" | "connecting" | "disabled" | "failed" | "unsupported" | "missing";
export type McpStdioFraming = "header" | "jsonl";
export type McpAddServerInput = {
  args?: string[];
  command?: string;
  connectTimeout?: number;
  disabled?: boolean;
  disabledTools?: string[];
  enabledTools?: string[];
  env?: Record<string, string>;
  executeTimeout?: number;
  framing?: McpStdioFraming;
  name: string;
  url?: string;
};

export interface McpToolDescriptor {
  annotations?: {
    readOnlyHint?: boolean;
  };
  description: string;
  inputSchema: unknown;
  name: string;
  qualifiedName: string;
  serverName: string;
}

export interface McpResourceDescriptor {
  description: string;
  mimeType?: string;
  name: string;
  serverName: string;
  uri: string;
}

export interface McpPromptDescriptor {
  description: string;
  name: string;
  serverName: string;
}

export interface McpServerSnapshot {
  args: string[];
  command?: string;
  connectTimeoutSecs?: number;
  disabledTools?: string[];
  error?: string;
  executeTimeoutSecs: number;
  enabledTools?: string[];
  env?: Record<string, string>;
  framing?: McpStdioFraming;
  name: string;
  promptCount: number;
  prompts: McpPromptDescriptor[];
  resourceCount: number;
  resources: McpResourceDescriptor[];
  status: McpServerStatus;
  toolCount: number;
  tools: McpToolDescriptor[];
  transport: McpServerTransport;
  url?: string;
}

export interface McpToolSnapshot {
  configPath: string;
  configured: boolean;
  error?: string;
  prompts: McpPromptDescriptor[];
  resources: McpResourceDescriptor[];
  servers: McpServerSnapshot[];
  supported: boolean;
  tools: McpToolDescriptor[];
}

export interface McpCallOutput {
  content: unknown;
  isError: boolean;
  server: string;
  tool: string;
}

export interface McpResourceReadOutput {
  content: unknown;
  mimeType?: string;
  server: string;
  text: string;
  uri: string;
}

export interface McpPromptGetOutput {
  content: unknown;
  description?: string;
  prompt: string;
  server: string;
  name: string;
}

export interface McpHost {
  addServer(input: McpAddServerInput): Promise<McpToolSnapshot>;
  callTool(input: { arguments: Record<string, unknown>; qualifiedName: string }): Promise<McpCallOutput>;
  configStatus(): Promise<McpToolSnapshot>;
  getPrompt(input: { arguments?: Record<string, unknown>; name: string; serverName: string }): Promise<McpPromptGetOutput>;
  initConfig(): Promise<McpToolSnapshot>;
  loadSnapshot(): Promise<McpToolSnapshot>;
  readResource(input: { serverName: string; uri: string }): Promise<McpResourceReadOutput>;
  reload(): Promise<McpToolSnapshot>;
  reloadServer(name: string): Promise<McpToolSnapshot>;
  removeServer(name: string): Promise<McpToolSnapshot>;
  setServerEnabled(name: string, enabled: boolean): Promise<McpToolSnapshot>;
  stopAll(): Promise<void>;
  updateServer(input: McpAddServerInput): Promise<McpToolSnapshot>;
  validateConfig(): Promise<{ configPath: string; errors: string[]; ok: boolean; servers: Array<{ disabled: boolean; name: string; transport: string }> }>;
}

export function createRuntimeMcpHost(): McpHost {
  if (isTauriRuntime()) {
    return createTauriMcpHost();
  }

  return createBrowserPreviewMcpHost();
}

export async function loadMcpToolSnapshot(host = createRuntimeMcpHost()) {
  return host.loadSnapshot();
}

export function createMcpGatewayTools(host: McpHost): [
  ToolSpec<McpListToolsInput, ReturnType<typeof buildMcpGatewayCatalog>>,
  ToolSpec<McpCallToolInput, McpCallOutput>,
  ToolSpec<McpReadResourceInput, McpResourceReadOutput>,
  ToolSpec<McpApplyPromptInput, McpPromptGetOutput>
] {
  return [
    {
      name: MCP_LIST_TOOLS_TOOL_NAME,
      description: "List currently configured MCP servers, tools, resources, and prompts without adding their schemas to the model tool prefix.",
      capability: "readonly",
      approval: "never",
      inputSchema: McpListToolsInputSchema,
      modelParameters: MCP_LIST_TOOLS_MODEL_PARAMETERS,
      async execute(input) {
        const snapshot = await host.loadSnapshot();
        return {
          callId: MCP_LIST_TOOLS_TOOL_NAME,
          ok: true,
          output: buildMcpGatewayCatalog(snapshot, input)
        };
      }
    },
    {
      name: MCP_CALL_TOOL_NAME,
      description: "Call one MCP tool by qualifiedName after inspecting its schema with mcp_list_tools. MCP tool schemas stay behind this stable gateway.",
      capability: "high-risk",
      approval: "required",
      inputSchema: McpCallToolInputSchema,
      modelParameters: MCP_CALL_TOOL_MODEL_PARAMETERS,
      async execute(input) {
        const snapshot = await host.loadSnapshot();
        const tool = findMcpTool(snapshot, input.qualifiedName);
        if (!tool) {
          return {
            callId: MCP_CALL_TOOL_NAME,
            ok: false,
            error: {
              code: "mcp_tool_not_found",
              message: `MCP tool is not available: ${input.qualifiedName}`
            }
          };
        }

        const output = await host.callTool({
          qualifiedName: tool.qualifiedName,
          arguments: input.arguments
        });

        return {
          callId: MCP_CALL_TOOL_NAME,
          ok: !output.isError,
          output
        };
      }
    },
    {
      name: MCP_READ_RESOURCE_TOOL_NAME,
      description: "Read an MCP resource by serverName and uri from mcp_list_tools through the stable MCP gateway.",
      capability: "readonly",
      approval: "never",
      inputSchema: McpReadResourceInputSchema,
      modelParameters: MCP_READ_RESOURCE_MODEL_PARAMETERS,
      async execute(input, context) {
        const output = await host.readResource(input);
        context.onRuntimeEvent?.(createLazyContextEventBody({
          source: "mcp_resource",
          sourceId: `${input.serverName}:${input.uri}`,
          title: `MCP resource ${input.uri}`,
          summary: summarizeLazyOutput(output.text || output.mimeType || input.uri)
        }));
        return {
          callId: MCP_READ_RESOURCE_TOOL_NAME,
          ok: true,
          output
        };
      }
    },
    {
      name: MCP_APPLY_PROMPT_TOOL_NAME,
      description: "Fetch an MCP prompt by serverName and name from mcp_list_tools through the stable MCP gateway.",
      capability: "readonly",
      approval: "never",
      inputSchema: McpApplyPromptInputSchema,
      modelParameters: MCP_APPLY_PROMPT_MODEL_PARAMETERS,
      async execute(input, context) {
        const output = await host.getPrompt(input);
        context.onRuntimeEvent?.(createLazyContextEventBody({
          source: "mcp_prompt",
          sourceId: `${input.serverName}:${input.name}`,
          title: `MCP prompt ${input.name}`,
          summary: summarizeLazyOutput(output.prompt || output.description || input.name)
        }));
        return {
          callId: MCP_APPLY_PROMPT_TOOL_NAME,
          ok: true,
          output
        };
      }
    }
  ];
}

function summarizeLazyOutput(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length <= 180 ? normalized : `${normalized.slice(0, 177)}...`;
}

export function mcpConnectionSummary(snapshot: McpToolSnapshot | null) {
  if (!snapshot) {
    return "MCP 未加载";
  }

  if (!snapshot.supported) {
    return "MCP 不可用";
  }

  if (!snapshot.configured) {
    return "MCP 未配置";
  }

  const connected = snapshot.servers.filter((server) => server.status === "connected").length;
  return connected > 0 ? `MCP: ${snapshot.tools.length} tools` : "MCP 未连接";
}

export function emptyMcpSnapshot(overrides: Partial<McpToolSnapshot> = {}): McpToolSnapshot {
  return {
    configPath: DEFAULT_MCP_CONFIG_PATH,
    configured: false,
    prompts: [],
    resources: [],
    servers: [],
    supported: true,
    tools: [],
    ...overrides
  };
}

function createTauriMcpHost(): McpHost {
  return {
    async addServer(input) {
      return invoke<McpToolSnapshot>("mcp_add_server", { input });
    },
    async updateServer(input) {
      return invoke<McpToolSnapshot>("mcp_update_server", { input });
    },
    async callTool(input) {
      return invoke<McpCallOutput>("mcp_call_tool", {
        arguments: input.arguments,
        qualifiedName: input.qualifiedName
      });
    },
    async configStatus() {
      return invoke<McpToolSnapshot>("mcp_config_status");
    },
    async initConfig() {
      return invoke<McpToolSnapshot>("mcp_init_config");
    },
    async getPrompt(input) {
      return invoke<McpPromptGetOutput>("mcp_get_prompt", {
        arguments: input.arguments ?? {},
        name: input.name,
        serverName: input.serverName
      });
    },
    async loadSnapshot() {
      return invoke<McpToolSnapshot>("mcp_list_tools");
    },
    async readResource(input) {
      return invoke<McpResourceReadOutput>("mcp_read_resource", {
        serverName: input.serverName,
        uri: input.uri
      });
    },
    async reload() {
      return invoke<McpToolSnapshot>("mcp_reload");
    },
    async reloadServer(name) {
      return invoke<McpToolSnapshot>("mcp_reload_server", { name });
    },
    async removeServer(name) {
      return invoke<McpToolSnapshot>("mcp_remove_server", { name });
    },
    async setServerEnabled(name, enabled) {
      return invoke<McpToolSnapshot>("mcp_set_server_enabled", { name, enabled });
    },
    async stopAll() {
      await invoke("mcp_stop_all");
    },
    async validateConfig() {
      return invoke("mcp_validate_config");
    }
  };
}

function createBrowserPreviewMcpHost(): McpHost {
  const snapshot = emptyMcpSnapshot({
    error: "浏览器预览不支持启动或连接 MCP server，请在 Tauri 桌面端运行。",
    supported: false
  });

  return {
    async addServer() {
      return snapshot;
    },
    async updateServer() {
      return snapshot;
    },
    async callTool() {
      return {
        content: "浏览器预览不支持 MCP。",
        isError: true,
        server: "browser-preview",
        tool: "unsupported"
      };
    },
    async configStatus() {
      return snapshot;
    },
    async getPrompt(input) {
      return {
        content: {},
        prompt: `浏览器预览不支持 MCP prompt：${input.name}`,
        server: input.serverName,
        name: input.name
      };
    },
    async loadSnapshot() {
      return snapshot;
    },
    async reload() {
      return snapshot;
    },
    async reloadServer() {
      return snapshot;
    },
    async readResource(input) {
      return {
        content: {},
        server: input.serverName,
        text: `浏览器预览不支持 MCP resource：${input.uri}`,
        uri: input.uri
      };
    },
    async initConfig() {
      return snapshot;
    },
    async removeServer() {
      return snapshot;
    },
    async setServerEnabled() {
      return snapshot;
    },
    async stopAll() {
      return undefined;
    },
    async validateConfig() {
      return {
        configPath: snapshot.configPath,
        errors: [snapshot.error ?? "MCP unsupported"],
        ok: false,
        servers: []
      };
    }
  };
}
