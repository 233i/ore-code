import {
  createAutomationTools,
  createCodingSystemPrompt,
  createProjectContextPrompt,
  createDeepSeekClient,
  createInteractionRequestTool,
  createNoteTools,
  createRlmQueryTool,
  createSubagentTools,
  createTaskTools,
  MockLlmClient,
  SubagentManager,
  type AutomationManager,
  type DeepSeekToolProfile,
  type DurableTaskManager,
  type LlmClient,
  type RuntimeOperatingSystem,
  type SubagentRuntimeAgent
} from "@ore-code/agent-core";
import {
  createArtifactTools,
  createCodeExecutionTool,
  createFileTools,
  createGitTools,
  createLspDiagnosticsTool,
  createLspNavigationTools,
  createRunTestsTool,
  createShellJobTools,
  createShellTool,
  createStructuredReviewTool,
  createToolSearchTool,
  createValidateDataTool,
  createWebTools,
  ToolRegistry,
  type FileToolHost,
  type ProcessToolHost,
  type ShellToolHost,
  type ToolSpec
} from "@ore-code/tools";
import { DEFAULT_DEEPSEEK_BASE_URL } from "../services/appSettings";
import type { createRuntimeArtifactStore } from "../services/artifactStore";
import type { OreCodeInstructions } from "../services/oreCodeInstructions";
import type { ProviderConfig } from "../services/oreCodeConfig";
import { createRuntimeFileHost, isTauriRuntime } from "../services/fileHost";
import { createRuntimeGitHost } from "../services/gitHost";
import {
  createMcpGatewayTools,
  createRuntimeMcpHost,
  emptyMcpSnapshot,
  mcpConnectionSummary,
  type McpToolSnapshot
} from "../services/mcpHost";
import { createRuntimeNoteStore } from "../services/noteStore";
import { createRuntimeProcessHost } from "../services/processHost";
import { detectRuntimeOperatingSystem } from "../services/runtimePlatform";
import { createInstallSkillTool } from "../services/skillTools";
import { createRuntimeShellHost, createRuntimeShellJobHost } from "../services/shellHost";
import { createRuntimeWebHost } from "../services/webHost";
import { fallbackDeepSeekProvider, type Provider } from "./useProviderConfig";

export type DesktopToolRegistryOptions = {
  activeModel: string;
  artifactStore: ReturnType<typeof createRuntimeArtifactStore>;
  automationManager?: AutomationManager;
  createConfiguredProviderClient?: (reason: string) => Promise<LlmClient | null>;
  deepSeekBaseUrl: string;
  deepSeekModel: string;
  durableTaskManager?: DurableTaskManager;
  effectiveProviderConfig: ProviderConfig | null;
  enableInteractionTool?: boolean;
  enableMcpTools?: boolean;
  enableNoteTool?: boolean;
  enableRlmTool?: boolean;
  enableSubagentTools?: boolean;
  fileHost?: FileToolHost;
  instructions?: OreCodeInstructions;
  onMcpMessage?: (message: string | null) => void;
  onMcpSnapshot?: (snapshot: McpToolSnapshot | null) => void;
  operatingSystem?: RuntimeOperatingSystem;
  processHost?: ProcessToolHost;
  provider: Provider | string;
  resolveProviderApiKey: (providerConfig: ProviderConfig) => Promise<string | null>;
  shellHost?: ShellToolHost;
  toolProfile?: DeepSeekToolProfile;
  workspacePath: string;
};

const READONLY_DESKTOP_TOOL_NAMES = new Set([
  "automation_list",
  "automation_read",
  "fetch_url",
  "file_search",
  "git_blame",
  "git_branch",
  "git_diff",
  "git_log",
  "git_show",
  "git_status",
  "grep_files",
  "list_dir",
  "lsp_definition",
  "lsp_diagnostics",
  "lsp_document_symbols",
  "lsp_hover",
  "lsp_references",
  "mcp_apply_prompt",
  "mcp_list_tools",
  "mcp_read_resource",
  "note_list",
  "note_read",
  "pr_attempt_list",
  "pr_attempt_read",
  "read_file",
  "retrieve_tool_result",
  "shell_job_output",
  "shell_job_status",
  "structured_review",
  "task_list",
  "task_read",
  "tool_search",
  "validate_data",
  "web_search"
]);

export async function createDesktopToolRegistry(options: DesktopToolRegistryOptions): Promise<ToolRegistry> {
  const registry = new ToolRegistry();
  const fileHost = options.fileHost ?? createRuntimeFileHost();
  const processHost = options.processHost ?? createRuntimeProcessHost();
  const shellHost = options.shellHost ?? createRuntimeShellHost();

  registerCoreDesktopTools(registry, {
    artifactStore: options.artifactStore,
    fileHost,
    processHost,
    shellHost
  });

  if (options.durableTaskManager) {
    for (const tool of createTaskTools(options.durableTaskManager, { shellHost })) {
      registry.register(tool);
    }
  }

  if (options.automationManager) {
    for (const tool of createAutomationTools(options.automationManager)) {
      registry.register(tool);
    }
  }

  if (options.enableNoteTool) {
    for (const tool of createNoteTools(createRuntimeNoteStore(options.workspacePath))) {
      registry.register(tool);
    }
  }

  if (options.enableRlmTool !== false && options.provider === "deepseek") {
    registry.register(createRlmQueryTool({
      artifacts: { store: options.artifactStore },
      childModel: "deepseek-v4-flash",
      createClient: async () => createDeepSeekRlmClient(options),
      readonlyTools: registry
    }));
  }

  if (options.enableSubagentTools) {
    for (const tool of createSubagentTools(createDesktopSubagentManager(registry, options))) {
      registry.register(tool);
    }
  }

  if (options.enableMcpTools) {
    await registerMcpTools(registry, options);
  }

  if (options.enableInteractionTool) {
    registry.register(createInteractionRequestTool());
  }

  const profiledRegistry = filterRegistryForToolProfile(registry, options.toolProfile ?? "full");
  if ((options.toolProfile ?? "full") !== "none") {
    profiledRegistry.register(createToolSearchTool(profiledRegistry));
  }
  return profiledRegistry;
}

export function isDesktopToolAllowedForProfile(toolName: string, profile: DeepSeekToolProfile) {
  if (profile === "full") {
    return true;
  }
  if (profile === "none") {
    return false;
  }
  return READONLY_DESKTOP_TOOL_NAMES.has(toolName);
}

function filterRegistryForToolProfile(registry: ToolRegistry, profile: DeepSeekToolProfile) {
  if (profile === "full") {
    return registry;
  }
  const filtered = new ToolRegistry();
  for (const tool of registry.list()) {
    if (isToolAllowedForProfile(tool, profile)) {
      filtered.register(tool);
    }
  }
  return filtered;
}

function isToolAllowedForProfile(tool: ToolSpec, profile: DeepSeekToolProfile) {
  return isDesktopToolAllowedForProfile(tool.name, profile);
}

function registerCoreDesktopTools(
  registry: ToolRegistry,
  input: {
    artifactStore: ReturnType<typeof createRuntimeArtifactStore>;
    fileHost: FileToolHost;
    processHost: ProcessToolHost;
    shellHost: ShellToolHost;
  }
) {
  for (const tool of createFileTools(input.fileHost)) {
    registry.register(tool);
  }
  registry.register(createInstallSkillTool());
  registry.register(createValidateDataTool(input.fileHost));
  for (const tool of createArtifactTools(input.artifactStore)) {
    registry.register(tool);
  }
  const gitHost = createRuntimeGitHost();
  for (const tool of createGitTools(gitHost)) {
    registry.register(tool);
  }
  registry.register(createStructuredReviewTool(gitHost));
  for (const tool of createWebTools(createRuntimeWebHost())) {
    registry.register(tool);
  }
  registry.register(createShellTool(input.shellHost));
  registry.register(createRunTestsTool(input.shellHost, { processHost: input.processHost }));
  registry.register(createCodeExecutionTool(input.processHost));
  registry.register(createLspDiagnosticsTool(input.fileHost, input.processHost));
  for (const tool of createLspNavigationTools(input.fileHost)) {
    registry.register(tool);
  }
  for (const tool of createShellJobTools(createRuntimeShellJobHost())) {
    registry.register(tool);
  }
}

async function createDeepSeekRlmClient(options: DesktopToolRegistryOptions): Promise<LlmClient> {
  const providerConfig = options.effectiveProviderConfig ?? fallbackDeepSeekProvider(options.deepSeekModel, options.deepSeekBaseUrl);
  const apiKey = await options.resolveProviderApiKey(providerConfig);
  if (!apiKey) {
    throw new Error("DeepSeek API Key is required for rlm_query.");
  }
  return createDeepSeekClient({
    apiKey,
    model: "deepseek-v4-flash",
    baseUrl: options.deepSeekBaseUrl.trim() || DEFAULT_DEEPSEEK_BASE_URL
  });
}

function createDesktopSubagentManager(registry: ToolRegistry, options: DesktopToolRegistryOptions) {
  return new SubagentManager({
    artifacts: { store: options.artifactStore },
    createClient: async (_toolContext, agent) => {
      if (options.provider === "mock") {
        return new MockLlmClient([
          { type: "assistant_delta", text: "子智能体模拟任务已完成。" },
          { type: "done" }
        ]);
      }
      if (options.provider === "deepseek") {
        return createDeepSeekSubagentClient(options, agent);
      }
      if (!options.createConfiguredProviderClient) {
        throw new Error("Provider client factory is required for sub-agents.");
      }
      const client = await options.createConfiguredProviderClient("sub-agents");
      if (!client) {
        throw new Error("Provider API Key is required for sub-agents.");
      }
      return client;
    },
    createRegistry: () => registry,
    maxConcurrent: 4,
    model: (_toolContext, agent) => options.provider === "deepseek"
      ? resolveDeepSeekSubagentModel(options, agent)
      : options.activeModel,
    projectContext: (toolContext) => createProjectContextPrompt({
      workspacePath: toolContext.workspacePath,
      mode: toolContext.mode,
      operatingSystem: options.operatingSystem ?? detectRuntimeOperatingSystem(),
      projectInstructions: options.instructions?.projectInstructions,
      userInstructions: options.instructions?.userInstructions
    }),
    systemPrompt: (toolContext) => createCodingSystemPrompt({
      workspacePath: toolContext.workspacePath,
      mode: toolContext.mode,
      operatingSystem: options.operatingSystem ?? detectRuntimeOperatingSystem(),
      projectInstructions: options.instructions?.projectInstructions,
      userInstructions: options.instructions?.userInstructions,
      tools: registry.list()
    })
  });
}

async function createDeepSeekSubagentClient(options: DesktopToolRegistryOptions, agent: SubagentRuntimeAgent): Promise<LlmClient> {
  const providerConfig = options.effectiveProviderConfig ?? fallbackDeepSeekProvider(options.deepSeekModel, options.deepSeekBaseUrl);
  const apiKey = await options.resolveProviderApiKey(providerConfig);
  if (!apiKey) {
    throw new Error("DeepSeek API Key is required for sub-agents.");
  }
  return createDeepSeekClient({
    apiKey,
    model: resolveDeepSeekSubagentModel(options, agent),
    baseUrl: providerConfig.baseUrl || options.deepSeekBaseUrl.trim() || DEFAULT_DEEPSEEK_BASE_URL
  });
}

function resolveDeepSeekSubagentModel(options: DesktopToolRegistryOptions, agent: SubagentRuntimeAgent) {
  if (agent.modelPreference === "pro") {
    return "deepseek-v4-pro";
  }
  if (agent.modelPreference === "parent") {
    return options.activeModel;
  }
  return "deepseek-v4-flash";
}

async function registerMcpTools(registry: ToolRegistry, options: DesktopToolRegistryOptions) {
  const mcpHost = createRuntimeMcpHost();
  for (const tool of createMcpGatewayTools(mcpHost)) {
    registry.register(tool);
  }

  try {
    const snapshot = await mcpHost.loadSnapshot();
    options.onMcpSnapshot?.(snapshot);
    options.onMcpMessage?.(mcpConnectionSummary(snapshot));
  } catch (error) {
    const fallback = emptyMcpSnapshot({ error: messageFromUnknown(error), supported: isTauriRuntime() });
    options.onMcpSnapshot?.(fallback);
    options.onMcpMessage?.(messageFromUnknown(error));
  }
}

function messageFromUnknown(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
