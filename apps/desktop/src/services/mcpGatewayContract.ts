import { z } from "zod";
import type { McpPromptDescriptor, McpResourceDescriptor, McpServerSnapshot, McpToolDescriptor, McpToolSnapshot } from "./mcpHost";

export const MCP_LIST_TOOLS_TOOL_NAME = "mcp_list_tools";
export const MCP_CALL_TOOL_NAME = "mcp_call_tool";
export const MCP_READ_RESOURCE_TOOL_NAME = "mcp_read_resource";
export const MCP_APPLY_PROMPT_TOOL_NAME = "mcp_apply_prompt";

export const McpListToolsInputSchema = z.object({
  serverName: z.string().min(1).optional()
}).strict();

export const McpCallToolInputSchema = z.object({
  qualifiedName: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).default({})
}).strict();

export const McpReadResourceInputSchema = z.object({
  serverName: z.string().min(1),
  uri: z.string().min(1)
}).strict();

export const McpApplyPromptInputSchema = z.object({
  serverName: z.string().min(1),
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).default({})
}).strict();

export type McpListToolsInput = z.infer<typeof McpListToolsInputSchema>;
export type McpCallToolInput = z.infer<typeof McpCallToolInputSchema>;
export type McpReadResourceInput = z.infer<typeof McpReadResourceInputSchema>;
export type McpApplyPromptInput = z.infer<typeof McpApplyPromptInputSchema>;

export const MCP_LIST_TOOLS_MODEL_PARAMETERS = {
  type: "object",
  properties: {
    serverName: {
      type: "string",
      description: "Optional MCP server name to filter by."
    }
  },
  additionalProperties: false
} as const;

export const MCP_CALL_TOOL_MODEL_PARAMETERS = {
  type: "object",
  properties: {
    qualifiedName: {
      type: "string",
      description: "Qualified MCP tool name from mcp_list_tools, for example mcp_tdesign_get_component_docs."
    },
    arguments: {
      type: "object",
      description: "JSON arguments for the target MCP tool. Use the inputSchema returned by mcp_list_tools.",
      additionalProperties: true
    }
  },
  required: ["qualifiedName", "arguments"],
  additionalProperties: false
} as const;

export const MCP_READ_RESOURCE_MODEL_PARAMETERS = {
  type: "object",
  properties: {
    serverName: {
      type: "string",
      description: "MCP server name from mcp_list_tools."
    },
    uri: {
      type: "string",
      description: "Resource URI from mcp_list_tools."
    }
  },
  required: ["serverName", "uri"],
  additionalProperties: false
} as const;

export const MCP_APPLY_PROMPT_MODEL_PARAMETERS = {
  type: "object",
  properties: {
    serverName: {
      type: "string",
      description: "MCP server name from mcp_list_tools."
    },
    name: {
      type: "string",
      description: "Prompt name from mcp_list_tools."
    },
    arguments: {
      type: "object",
      description: "Optional JSON arguments for the MCP prompt.",
      additionalProperties: true
    }
  },
  required: ["serverName", "name", "arguments"],
  additionalProperties: false
} as const;

export interface McpGatewayCatalog {
  configured: boolean;
  resources: McpResourceDescriptor[];
  prompts: McpPromptDescriptor[];
  servers: McpGatewayServer[];
  supported: boolean;
  tools: McpGatewayTool[];
}

export interface McpGatewayServer {
  name: string;
  status: McpServerSnapshot["status"];
  transport: McpServerSnapshot["transport"];
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  error?: string;
}

export interface McpGatewayTool {
  annotations?: McpToolDescriptor["annotations"];
  description: string;
  inputSchema: unknown;
  name: string;
  qualifiedName: string;
  readOnly: boolean;
  serverName: string;
}

export function buildMcpGatewayCatalog(snapshot: McpToolSnapshot, input: McpListToolsInput = {}): McpGatewayCatalog {
  const filteredServers = input.serverName
    ? snapshot.servers.filter((server) => server.name === input.serverName)
    : snapshot.servers;

  return {
    configured: snapshot.configured,
    resources: snapshot.resources.filter((resource) => matchesMcpServerFilter(resource.serverName, input.serverName)),
    prompts: snapshot.prompts.filter((prompt) => matchesMcpServerFilter(prompt.serverName, input.serverName)),
    servers: filteredServers.map((server) => ({
      name: server.name,
      status: server.status,
      transport: server.transport,
      toolCount: server.toolCount,
      resourceCount: server.resourceCount,
      promptCount: server.promptCount,
      ...(server.error ? { error: server.error } : {})
    })),
    supported: snapshot.supported,
    tools: snapshot.tools
      .filter((tool) => matchesMcpServerFilter(tool.serverName, input.serverName))
      .map((tool) => ({
        annotations: tool.annotations,
        description: tool.description,
        inputSchema: normalizeInputSchema(tool.inputSchema),
        name: tool.name,
        qualifiedName: tool.qualifiedName,
        readOnly: tool.annotations?.readOnlyHint === true,
        serverName: tool.serverName
      }))
  };
}

export function findMcpTool(snapshot: McpToolSnapshot, qualifiedName: string): McpToolDescriptor | undefined {
  return snapshot.tools.find((tool) => tool.qualifiedName === qualifiedName);
}

function normalizeInputSchema(value: unknown) {
  if (value && typeof value === "object") {
    return value;
  }

  return {
    type: "object",
    additionalProperties: true
  };
}

function matchesMcpServerFilter(serverName: string, filter?: string) {
  return !filter || serverName === filter;
}
