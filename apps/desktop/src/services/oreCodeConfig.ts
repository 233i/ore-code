import { invoke } from "@tauri-apps/api/core";
import {
  parseDeepSeekModelMode,
  parseProviderThinkingLevel,
  type DeepSeekModelMode,
  type ProviderThinkingLevel
} from "@ore-code/agent-core";
import { parse as parseToml, stringify as stringifyToml, type TomlTable } from "smol-toml";
import { z } from "zod";
import {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_MIMO_BASE_URL,
  DEFAULT_MIMO_MODEL
} from "./appSettings";
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

export type ConfigFieldKey = "provider" | "model" | "modelMode" | "baseUrl" | "thinkingLevel";
export type ConfigValueSource = ConfigScope | "env" | "default";

export interface ConfigFieldSource {
  source: ConfigValueSource;
  path?: string;
  envName?: string;
}

export type ProviderConfigSources = Record<ConfigFieldKey, ConfigFieldSource>;

export interface ProviderConfig {
  id: string;
  label: string;
  kind: "mock" | "openai-compatible";
  model: string;
  deepSeekModelMode?: DeepSeekModelMode;
  baseUrl: string;
  apiKeyEnv: string;
  thinkingLevel?: ProviderThinkingLevel;
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
  providerConfigSources: ProviderConfigSources;
  warnings: string[];
}

export interface UserOreCodeProviderConfig {
  providerId: string;
  model: string;
  deepSeekModelMode: DeepSeekModelMode;
  baseUrl: string;
  thinkingLevel: ProviderThinkingLevel;
}

const USER_CONFIG_STORAGE_KEY = "ore-code.user-config.toml";
const CONFIG_ENV_NAMES = [
  "ORE_CODE_PROFILE",
  "ORE_CODE_PROVIDER",
  "ORE_CODE_MODEL",
  "ORE_CODE_DEEPSEEK_MODEL_MODE",
  "ORE_CODE_BASE_URL",
  "ORE_CODE_THINKING",
  "ORE_CODE_DEEPSEEK_THINKING",
  "ORE_CODE_MIMO_THINKING",
  "DEEPSEEK_API_KEY",
  "MIMO_API_KEY"
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
    const userConfig = readPreviewUserConfig();
    return ConfigStatusSchema.parse({
      sources: [
        userConfig
          ? { scope: "global", path: "~/.ore-code/config.toml", status: "loaded", content: userConfig }
          : { scope: "global", path: "~/.ore-code/config.toml", status: "missing" },
        { scope: "project", path: `${workspacePath}/.ore-code/config.toml`, status: "missing" }
      ],
      env: CONFIG_ENV_NAMES.map((name) => ({ name, present: false }))
    });
  }

  const raw = await invoke<unknown>("ore_code_config_status", { workspacePath });
  return ConfigStatusSchema.parse(raw);
}

export async function saveUserOreCodeConfig(
  workspacePath: string,
  input: UserOreCodeProviderConfig
): Promise<ResolvedOreCodeConfig> {
  const currentStatus = await loadConfigStatus(workspacePath);
  const userSource = currentStatus.sources.find((source) => source.scope === "global");
  const content = buildUserOreCodeConfigContent(userSource?.content, input);

  if (isTauriRuntime()) {
    await invoke<unknown>("ore_code_config_write", { content });
  } else {
    writePreviewUserConfig(content);
  }

  return loadOreCodeConfig(workspacePath);
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
  const parsedSources: ParsedConfigSource[] = [];

  for (const source of status.sources) {
    if (source.status !== "loaded" || !source.content) {
      continue;
    }

    try {
      const parsed = parseOreCodeToml(source.content);
      parsedSources.push({ source, table: parsed });
      merged = deepMerge(merged, parsed);
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
    thinkingLevel: "auto"
  });
  providers.set("mimo", {
    id: "mimo",
    label: "Mimo",
    kind: "openai-compatible",
    model: DEFAULT_MIMO_MODEL,
    baseUrl: DEFAULT_MIMO_BASE_URL,
    apiKeyEnv: "MIMO_API_KEY",
    thinkingLevel: "auto"
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
      providerThinkingEnvValue(env, providerId) ||
      stringValue(profileProviderTable.thinking_level) ||
      stringValue(profileProviderTable.thinkingLevel) ||
      stringValue(profileProviderTable.reasoning_effort) ||
      stringValue(profileConfig.thinking_level) ||
      stringValue(profileConfig.thinkingLevel) ||
      stringValue(profileConfig.reasoning_effort) ||
      selected.thinkingLevel;
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
    providerConfigSources: resolveProviderConfigSources(status.env, parsedSources, activeProfile, providerId),
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
  if (providerId === "mimo") {
    return config?.providers.find((provider) => provider.id === providerId) ?? {
      id: "mimo",
      label: "Mimo",
      kind: "openai-compatible",
      model: DEFAULT_MIMO_MODEL,
      baseUrl: DEFAULT_MIMO_BASE_URL,
      apiKeyEnv: "MIMO_API_KEY",
      thinkingLevel: "auto"
    };
  }
  return config?.providers.find((provider) => provider.id === providerId) ?? null;
}

export function buildUserOreCodeConfigContent(
  existingContent: string | undefined,
  input: UserOreCodeProviderConfig
): string {
  const root = existingContent?.trim() ? cloneTomlTable(parseOreCodeToml(existingContent)) : {};
  const providerId = normalizeProviderId(input.providerId);
  const activeProfile = userConfigActiveProfile(root);
  const target = activeProfile ? ensureProfileTable(root, activeProfile) : root;
  target.provider = providerId;

  if (providerId !== "mock") {
    const defaults = defaultProviderConfig(providerId);
    target.model = normalizeConfigString(input.model, defaults.model);
    target.base_url = normalizeConfigString(input.baseUrl, defaults.baseUrl);
    const providers = ensureChildTable(root, "providers");
    const providerTable = ensureChildTable(providers, providerId);
    providerTable.model = normalizeConfigString(input.model, defaults.model);
    providerTable.base_url = normalizeConfigString(input.baseUrl, defaults.baseUrl);
    providerTable.api_key_env = stringValue(providerTable.api_key_env) || defaults.apiKeyEnv;

    if (providerId === "deepseek") {
      target.model_mode = input.deepSeekModelMode;
      target.thinking_level = input.thinkingLevel;
      providerTable.model_mode = input.deepSeekModelMode;
      providerTable.thinking_level = input.thinkingLevel;
      providerTable.api_key_env = "DEEPSEEK_API_KEY";
    } else if (providerId === "mimo") {
      target.thinking_level = input.thinkingLevel;
      providerTable.thinking_level = input.thinkingLevel;
      providerTable.api_key_env = "MIMO_API_KEY";
    }
  }

  return stringifyToml(root).trimEnd() + "\n";
}

type ParsedConfigSource = {
  source: ConfigSource;
  table: TomlTable;
};

function resolveProviderConfigSources(
  env: ConfigEnvStatus[],
  sources: ParsedConfigSource[],
  activeProfile: string,
  providerId: string
): ProviderConfigSources {
  return {
    provider: sourceForField(
      env,
      "ORE_CODE_PROVIDER",
      sources,
      (table) => firstStringValue(
        profileConfigTable(table, activeProfile).provider,
        table.provider
      )
    ),
    model: sourceForField(
      env,
      "ORE_CODE_MODEL",
      sources,
      (table) => firstStringValue(
        providerProfileTable(table, activeProfile, providerId).model,
        profileConfigTable(table, activeProfile).model,
        providerConfigTable(table, providerId).model
      )
    ),
    modelMode: sourceForField(
      env,
      "ORE_CODE_DEEPSEEK_MODEL_MODE",
      sources,
      (table) => firstStringValue(
        providerProfileTable(table, activeProfile, providerId).model_mode,
        providerProfileTable(table, activeProfile, providerId).modelMode,
        profileConfigTable(table, activeProfile).model_mode,
        profileConfigTable(table, activeProfile).modelMode,
        providerConfigTable(table, providerId).model_mode,
        providerConfigTable(table, providerId).modelMode
      )
    ),
    baseUrl: sourceForField(
      env,
      "ORE_CODE_BASE_URL",
      sources,
      (table) => firstStringValue(
        providerProfileTable(table, activeProfile, providerId).base_url,
        providerProfileTable(table, activeProfile, providerId).baseUrl,
        profileConfigTable(table, activeProfile).base_url,
        profileConfigTable(table, activeProfile).baseUrl,
        providerConfigTable(table, providerId).base_url,
        providerConfigTable(table, providerId).baseUrl
      )
    ),
    thinkingLevel: sourceForField(
      env,
      providerThinkingEnvName(providerId),
      sources,
      (table) => firstStringValue(
        providerProfileTable(table, activeProfile, providerId).thinking_level,
        providerProfileTable(table, activeProfile, providerId).thinkingLevel,
        providerProfileTable(table, activeProfile, providerId).reasoning_effort,
        providerProfileTable(table, activeProfile, providerId).reasoningEffort,
        providerProfileTable(table, activeProfile, providerId).thinking,
        profileConfigTable(table, activeProfile).thinking_level,
        profileConfigTable(table, activeProfile).thinkingLevel,
        profileConfigTable(table, activeProfile).reasoning_effort,
        profileConfigTable(table, activeProfile).reasoningEffort,
        profileConfigTable(table, activeProfile).thinking,
        providerConfigTable(table, providerId).thinking_level,
        providerConfigTable(table, providerId).thinkingLevel,
        providerConfigTable(table, providerId).reasoning_effort,
        providerConfigTable(table, providerId).reasoningEffort,
        providerConfigTable(table, providerId).thinking
      )
    )
  };
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
    thinkingLevel:
      parseProviderThinkingLevel(
        id,
        stringValue(table.thinking_level) ||
        stringValue(table.thinkingLevel) ||
        stringValue(table.reasoning_effort) ||
        stringValue(table.reasoningEffort) ||
        stringValue(table.thinking)
      ) ?? base?.thinkingLevel
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

function sourceForField(
  env: ConfigEnvStatus[],
  envNames: string | string[],
  sources: ParsedConfigSource[],
  readValue: (table: TomlTable) => string | undefined
): ConfigFieldSource {
  for (const envName of Array.isArray(envNames) ? envNames : [envNames]) {
    const envItem = env.find((item) => item.name === envName);
    if (stringValue(envItem?.value)) {
      return { source: "env", envName };
    }
  }

  for (let index = sources.length - 1; index >= 0; index -= 1) {
    const source = sources[index];
    if (readValue(source.table)) {
      return {
        source: source.source.scope,
        path: source.source.path
      };
    }
  }

  return { source: "default" };
}

function providerThinkingEnvName(providerId: string) {
  switch (providerId) {
    case "deepseek":
      return ["ORE_CODE_DEEPSEEK_THINKING", "ORE_CODE_THINKING"];
    case "mimo":
      return ["ORE_CODE_MIMO_THINKING", "ORE_CODE_THINKING"];
    default:
      return "ORE_CODE_THINKING";
  }
}

function providerThinkingEnvValue(env: Record<string, string | undefined>, providerId: string) {
  const envNames = providerThinkingEnvName(providerId);
  for (const envName of Array.isArray(envNames) ? envNames : [envNames]) {
    const value = env[envName];
    if (value) {
      return value;
    }
  }
  return undefined;
}

function profileConfigTable(table: TomlTable, activeProfile: string): TomlTable {
  return tableValue(tableValue(table.profiles)[activeProfile]);
}

function providerProfileTable(table: TomlTable, activeProfile: string, providerId: string): TomlTable {
  return tableValue(tableValue(profileConfigTable(table, activeProfile).provider)[providerId]);
}

function providerConfigTable(table: TomlTable, providerId: string): TomlTable {
  return {
    ...tableValue(tableValue(table.provider)[providerId]),
    ...tableValue(tableValue(table.providers)[providerId])
  };
}

function firstStringValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    const resolved = stringValue(value);
    if (resolved) {
      return resolved;
    }
  }
  return undefined;
}

function userConfigActiveProfile(root: TomlTable): string | null {
  const activeProfile = stringValue(root.profile) || stringValue(root.active_profile);
  return activeProfile && activeProfile !== "default" ? activeProfile : null;
}

function ensureProfileTable(root: TomlTable, profile: string): TomlTable {
  const profiles = ensureChildTable(root, "profiles");
  return ensureChildTable(profiles, profile);
}

function ensureChildTable(parent: TomlTable, key: string): TomlTable {
  const existing = parent[key];
  if (isTable(existing)) {
    return existing;
  }
  const next: TomlTable = {};
  parent[key] = next;
  return next;
}

function cloneTomlTable(table: TomlTable): TomlTable {
  return Object.fromEntries(
    Object.entries(table).map(([key, value]) => [
      key,
      isTable(value) ? cloneTomlTable(value) : Array.isArray(value) ? [...value] : value
    ])
  );
}

function normalizeProviderId(providerId: string) {
  const normalized = providerId.trim().toLowerCase();
  if (!normalized || !/^[a-z0-9_-]{1,64}$/.test(normalized)) {
    throw new Error(`invalid provider id: ${providerId}`);
  }
  return normalized;
}

function normalizeConfigString(value: string, fallback: string) {
  return value.trim() || fallback;
}

function defaultProviderConfig(providerId: string) {
  switch (providerId) {
    case "deepseek":
      return {
        model: DEFAULT_DEEPSEEK_MODEL,
        baseUrl: DEFAULT_DEEPSEEK_BASE_URL,
        apiKeyEnv: "DEEPSEEK_API_KEY"
      };
    case "mimo":
      return {
        model: DEFAULT_MIMO_MODEL,
        baseUrl: DEFAULT_MIMO_BASE_URL,
        apiKeyEnv: "MIMO_API_KEY"
      };
    default:
      return {
        model: DEFAULT_DEEPSEEK_MODEL,
        baseUrl: DEFAULT_DEEPSEEK_BASE_URL,
        apiKeyEnv: `${providerId.toUpperCase().replace(/\W+/g, "_")}_API_KEY`
      };
  }
}

function readPreviewUserConfig() {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(USER_CONFIG_STORAGE_KEY);
}

function writePreviewUserConfig(content: string) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(USER_CONFIG_STORAGE_KEY, content);
}

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
