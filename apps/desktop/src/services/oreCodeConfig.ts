import { invoke } from "@tauri-apps/api/core";
import {
  parseDeepSeekModelMode,
  parseDeepSeekThinkingLevel,
  type DeepSeekModelMode,
  type DeepSeekThinkingLevel
} from "@ore-code/agent-core";
import { parse as parseToml, type TomlTable } from "smol-toml";
import { z } from "zod";
import { DEFAULT_DEEPSEEK_BASE_URL, DEFAULT_DEEPSEEK_MODEL } from "./appSettings";
import { isTauriRuntime } from "./fileHost";

export type ConfigScope = "global" | "project";
export type ConfigSourceStatus = "loaded" | "missing" | "error";

export interface ConfigSource {
  scope: ConfigScope;
  path: string;
  status: ConfigSourceStatus;
  content?: string;
  error?: string;
}

export interface ConfigEnvStatus {
  name: string;
  present: boolean;
  value?: string;
  last4?: string;
}

export interface ConfigStatus {
  sources: ConfigSource[];
  env: ConfigEnvStatus[];
}

export interface ProviderConfig {
  id: string;
  label: string;
  kind: "mock" | "openai-compatible";
  model: string;
  deepSeekModelMode?: DeepSeekModelMode;
  baseUrl: string;
  apiKeyEnv: string;
  deepSeekThinkingLevel?: DeepSeekThinkingLevel;
}

export interface ResolvedOreCodeConfig {
  activeProfile: string;
  providerId: string;
  providers: ProviderConfig[];
  context: {
    enableCacheWarmup: boolean;
  };
  sources: ConfigSource[];
  env: ConfigEnvStatus[];
  warnings: string[];
}

const CONFIG_ENV_NAMES = [
  "ORE_CODE_PROFILE",
  "ORE_CODE_PROVIDER",
  "ORE_CODE_MODEL",
  "ORE_CODE_DEEPSEEK_MODEL_MODE",
  "ORE_CODE_BASE_URL",
  "ORE_CODE_DEEPSEEK_THINKING",
  "DEEPSEEK_API_KEY"
];

const ConfigSourceSchema = z.object({
  scope: z.enum(["global", "project"]),
  path: z.string(),
  status: z.enum(["loaded", "missing", "error"]),
  content: z.string().optional(),
  error: z.string().optional()
});

const ConfigEnvStatusSchema = z.object({
  name: z.string(),
  present: z.boolean(),
  value: z.string().optional(),
  last4: z.string().optional()
});

const ConfigStatusSchema = z.object({
  sources: z.array(ConfigSourceSchema),
  env: z.array(ConfigEnvStatusSchema)
});

export async function loadOreCodeConfig(workspacePath: string): Promise<ResolvedOreCodeConfig> {
  const status = await loadConfigStatus(workspacePath);
  return resolveOreCodeConfig(status);
}

export async function loadConfigStatus(workspacePath: string): Promise<ConfigStatus> {
  if (!isTauriRuntime()) {
    return ConfigStatusSchema.parse({
      sources: [
        { scope: "global", path: "~/.ore-code/config.toml", status: "missing" },
        { scope: "project", path: `${workspacePath}/.ore-code/config.toml`, status: "missing" }
      ],
      env: CONFIG_ENV_NAMES.map((name) => ({ name, present: false }))
    });
  }

  const raw = await invoke<unknown>("ore_code_config_status", { workspacePath });
  return ConfigStatusSchema.parse(raw);
}

export async function getConfigEnvSecret(name: string): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  const result = await invoke<{ name: string; value: string; last4?: string }>("ore_code_config_env_secret_get", { name });
  return result.value;
}

export function resolveOreCodeConfig(status: ConfigStatus): ResolvedOreCodeConfig {
  const warnings: string[] = [];
  let merged: TomlTable = {};

  for (const source of status.sources) {
    if (source.status !== "loaded" || !source.content) {
      continue;
    }

    try {
      merged = deepMerge(merged, parseOreCodeToml(source.content));
    } catch (error) {
      warnings.push(`${source.scope} config parse failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const env = envMap(status.env);
  const activeProfile = env.ORE_CODE_PROFILE || stringValue(merged.profile) || stringValue(merged.active_profile) || "default";
  const profiles = tableValue(merged.profiles);
  const profileConfig = tableValue(profiles[activeProfile]);
  const rootProviderId = stringValue(merged.provider);
  const profileProviderId = stringValue(profileConfig.provider);
  const providerId = env.ORE_CODE_PROVIDER || profileProviderId || rootProviderId || "deepseek";
  const contextConfig = {
    ...tableValue(merged.context),
    ...tableValue(profileConfig.context)
  };
  const providerTables = {
    ...tableValue(merged.provider),
    ...tableValue(merged.providers)
  };

  const providers = new Map<string, ProviderConfig>();
  providers.set("deepseek", {
    id: "deepseek",
    label: "DeepSeek",
    kind: "openai-compatible",
    model: DEFAULT_DEEPSEEK_MODEL,
    deepSeekModelMode: "auto",
    baseUrl: DEFAULT_DEEPSEEK_BASE_URL,
    apiKeyEnv: "DEEPSEEK_API_KEY",
    deepSeekThinkingLevel: "auto"
  });

  for (const [id, value] of Object.entries(providerTables)) {
    const table = tableValue(value);
    if (!Object.keys(table).length) {
      continue;
    }
    providers.set(id, normalizeProviderConfig(id, table, providers.get(id)));
  }

  if (!providers.has(providerId) && providerId !== "mock") {
    providers.set(providerId, normalizeProviderConfig(providerId, {}, undefined));
  }

  const selected = providers.get(providerId);
  if (selected) {
    const profileProviderTable = tableValue(tableValue(profileConfig.provider)[providerId]);
    const thinkingLevel =
      env.ORE_CODE_DEEPSEEK_THINKING ||
      stringValue(profileProviderTable.thinking_level) ||
      stringValue(profileProviderTable.thinkingLevel) ||
      stringValue(profileProviderTable.reasoning_effort) ||
      stringValue(profileConfig.thinking_level) ||
      stringValue(profileConfig.thinkingLevel) ||
      stringValue(profileConfig.reasoning_effort) ||
      selected.deepSeekThinkingLevel;
    const modelMode =
      env.ORE_CODE_DEEPSEEK_MODEL_MODE ||
      stringValue(profileProviderTable.model_mode) ||
      stringValue(profileProviderTable.modelMode) ||
      stringValue(profileConfig.model_mode) ||
      stringValue(profileConfig.modelMode) ||
      selected.deepSeekModelMode;
    const overrides: TomlTable = {
      ...selected,
      ...profileConfig,
      ...profileProviderTable,
      model: env.ORE_CODE_MODEL || stringValue(profileProviderTable.model) || stringValue(profileConfig.model) || selected.model,
      base_url: env.ORE_CODE_BASE_URL || stringValue(profileProviderTable.base_url) || stringValue(profileConfig.base_url) || selected.baseUrl
    };
    if (thinkingLevel) {
      overrides.thinking_level = thinkingLevel;
    }
    if (modelMode) {
      overrides.model_mode = modelMode;
    }
    providers.set(providerId, normalizeProviderConfig(providerId, overrides, selected));
  }

  return {
    activeProfile,
    providerId,
    providers: [...providers.values()],
    context: {
      enableCacheWarmup: booleanValue(contextConfig.enableCacheWarmup) ?? booleanValue(contextConfig.enable_cache_warmup) ?? false
    },
    sources: status.sources,
    env: status.env,
    warnings
  };
}

export function resolveProvider(config: ResolvedOreCodeConfig | null, providerId: string): ProviderConfig | null {
  if (providerId === "mock") {
    return {
      id: "mock",
      label: "Mock Harness",
      kind: "mock",
      model: "mock",
      baseUrl: "",
      apiKeyEnv: ""
    };
  }
  return config?.providers.find((provider) => provider.id === providerId) ?? null;
}

function normalizeProviderConfig(id: string, table: TomlTable, base?: ProviderConfig): ProviderConfig {
  const kind = stringValue(table.kind) || stringValue(table.type) || (id === "mock" ? "mock" : "openai-compatible");
  return {
    id,
    label: stringValue(table.label) || base?.label || titleCase(id),
    kind: kind === "mock" ? "mock" : "openai-compatible",
    model: stringValue(table.model) || base?.model || DEFAULT_DEEPSEEK_MODEL,
    deepSeekModelMode:
      parseDeepSeekModelMode(
        stringValue(table.model_mode) ||
        stringValue(table.modelMode)
      ) ?? base?.deepSeekModelMode,
    baseUrl: stringValue(table.base_url) || stringValue(table.baseUrl) || base?.baseUrl || DEFAULT_DEEPSEEK_BASE_URL,
    apiKeyEnv: stringValue(table.api_key_env) || stringValue(table.apiKeyEnv) || base?.apiKeyEnv || `${id.toUpperCase().replace(/\W+/g, "_")}_API_KEY`,
    deepSeekThinkingLevel:
      parseDeepSeekThinkingLevel(
        stringValue(table.thinking_level) ||
        stringValue(table.thinkingLevel) ||
        stringValue(table.reasoning_effort) ||
        stringValue(table.reasoningEffort) ||
        stringValue(table.thinking)
      ) ?? base?.deepSeekThinkingLevel
  };
}

export function parseOreCodeToml(content: string): TomlTable {
  const parsed = parseToml(content);
  if (!isTable(parsed)) {
    throw new Error("config root must be a TOML table");
  }
  return parsed;
}

export const parseMiniToml = parseOreCodeToml;

function deepMerge(left: TomlTable, right: TomlTable): TomlTable {
  const result: TomlTable = { ...left };
  for (const [key, value] of Object.entries(right)) {
    const existing = result[key];
    result[key] =
      isTable(existing) && isTable(value)
        ? deepMerge(existing, value)
        : value;
  }
  return result;
}

function tableValue(value: unknown): TomlTable {
  return isTable(value) ? value : {};
}

function isTable(value: unknown): value is TomlTable {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function envMap(env: ConfigEnvStatus[]) {
  return Object.fromEntries(env.map((item) => [item.name, item.value ?? ""])) as Record<string, string>;
}

function titleCase(value: string) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
