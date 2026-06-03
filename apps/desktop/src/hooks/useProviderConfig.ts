import { useMemo, useState } from "react";
import {
  createDeepSeekClient,
  DEEPSEEK_V4_PRO_MODEL,
  modelForDeepSeekMode,
  MockLlmClient,
  OpenAiCompatibleLlmClient,
  runProviderSmokeTest,
  type DeepSeekModelMode,
  type DeepSeekThinkingLevel,
  type LlmClient
} from "@ore-code/agent-core";
import {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_DEEPSEEK_MODEL_MODE,
  DEFAULT_DEEPSEEK_THINKING_LEVEL,
  DEFAULT_PROVIDER
} from "../services/appSettings";
import {
  getConfigEnvSecret,
  loadOreCodeConfig,
  resolveProvider,
  type ProviderConfig,
  type ResolvedOreCodeConfig
} from "../services/oreCodeConfig";
import {
  deleteProviderSecret,
  getProviderSecret,
  getProviderSecretStatus,
  setProviderSecret,
  type ProviderSecretStatus
} from "../services/providerSecrets";

const PROVIDER_TEST_TIMEOUT_MS = 30_000;
const DEVELOPER_HARNESS_ENABLED = import.meta.env.DEV || import.meta.env.MODE === "test";
const baseProviderOptions = [
  { label: "DeepSeek", value: "deepseek" },
  ...(DEVELOPER_HARNESS_ENABLED ? [{ label: "Mock Harness", value: "mock" }] : [])
];

export type Provider = string;
export type CreateLlmClientOptions = {
  modelOverride?: string;
};

export function useProviderConfig() {
  const [provider, setProvider] = useState<Provider>(DEFAULT_PROVIDER);
  const [deepSeekApiKey, setDeepSeekApiKey] = useState("");
  const [deepSeekModel, setDeepSeekModel] = useState(DEFAULT_DEEPSEEK_MODEL);
  const [deepSeekModelMode, setDeepSeekModelMode] = useState<DeepSeekModelMode>(DEFAULT_DEEPSEEK_MODEL_MODE);
  const [deepSeekBaseUrl, setDeepSeekBaseUrl] = useState(DEFAULT_DEEPSEEK_BASE_URL);
  const [deepSeekThinkingLevel, setDeepSeekThinkingLevel] = useState<DeepSeekThinkingLevel>(DEFAULT_DEEPSEEK_THINKING_LEVEL);
  const [oreCodeConfig, setOreCodeConfig] = useState<ResolvedOreCodeConfig | null>(null);
  const [configMessage, setConfigMessage] = useState<string | null>(null);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [providerTestMessage, setProviderTestMessage] = useState<string | null>(null);
  const [secretStatus, setSecretStatus] = useState<ProviderSecretStatus | null>(null);
  const [secretMessage, setSecretMessage] = useState<string | null>(null);

  const providerOptions = useMemo(() => {
    const configured = oreCodeConfig?.providers
      .filter((item) => item.id !== "deepseek" && (DEVELOPER_HARNESS_ENABLED || item.id !== "mock"))
      .map((item) => ({ label: item.label, value: item.id })) ?? [];
    return uniqueProviderOptions([...baseProviderOptions, ...configured]);
  }, [oreCodeConfig]);

  const selectedProviderConfig = useMemo(
    () => resolveProvider(oreCodeConfig, provider),
    [oreCodeConfig, provider]
  );
  const effectiveProviderConfig = useMemo(
    () => effectiveConfiguredProvider(provider, selectedProviderConfig, deepSeekModel, deepSeekBaseUrl),
    [deepSeekBaseUrl, deepSeekModel, provider, selectedProviderConfig]
  );
  const modelLabel = useMemo(() => {
    if (provider === "mock") {
      return providerLabel(provider);
    }
    return configuredModelLabel(effectiveProviderConfig, provider, deepSeekModel);
  }, [deepSeekModel, effectiveProviderConfig, provider]);
  const effectiveDeepSeekModelMode = useMemo(
    () => deepSeekModelMode === DEFAULT_DEEPSEEK_MODEL_MODE
      ? effectiveProviderConfig?.deepSeekModelMode ?? deepSeekModelMode
      : deepSeekModelMode,
    [deepSeekModelMode, effectiveProviderConfig]
  );

  async function refreshOreCodeConfig(path: string) {
    const config = await loadOreCodeConfig(path);
    setOreCodeConfig(config);
    setConfigMessage(configSummary(config));
    return config;
  }

  async function createLlmClient(userPrompt: string, options: CreateLlmClientOptions = {}): Promise<LlmClient | null> {
    if (DEVELOPER_HARNESS_ENABLED && provider === "mock") {
      const { planMockTurn } = await import("../testing/mockTurnPlanner");
      return new MockLlmClient(planMockTurn(userPrompt));
    }
    if (provider === "mock") {
      setProviderError("Mock Harness 仅在开发或测试模式可用。");
      return null;
    }

    return createConfiguredProviderClient("chat turn", options);
  }

  async function createConfiguredProviderClient(reason: string, options: CreateLlmClientOptions = {}): Promise<LlmClient | null> {
    const providerConfig = effectiveProviderConfig ?? fallbackDeepSeekProvider(deepSeekModel, deepSeekBaseUrl);
    const apiKey = await resolveProviderApiKey(providerConfig);
    if (!apiKey) {
      setProviderTestMessage(`${reason} 未运行。`);
      return null;
    }

    if (providerConfig.id === "deepseek") {
      return createDeepSeekClient({
        apiKey,
        model: options.modelOverride ?? (effectiveDeepSeekModelMode === "auto"
          ? providerConfig.model
          : modelForDeepSeekMode(effectiveDeepSeekModelMode)),
        baseUrl: providerConfig.baseUrl,
        deepSeekThinkingLevel: deepSeekThinkingLevel === DEFAULT_DEEPSEEK_THINKING_LEVEL
          ? providerConfig.deepSeekThinkingLevel ?? deepSeekThinkingLevel
          : deepSeekThinkingLevel
      });
    }

    return new OpenAiCompatibleLlmClient({
      apiKey,
      provider: providerConfig.id,
      model: providerConfig.model,
      baseUrl: providerConfig.baseUrl
    });
  }

  async function resolveProviderApiKey(providerConfig: ProviderConfig): Promise<string | null> {
    const typedKey = providerConfig.id === "deepseek" ? deepSeekApiKey.trim() : "";
    if (typedKey) {
      return typedKey;
    }

    if (providerConfig.apiKeyEnv) {
      try {
        const value = await getConfigEnvSecret(providerConfig.apiKeyEnv);
        if (value) {
          setSecretStatus({
            provider: providerConfig.id,
            source: "env",
            hasSecret: true,
            last4: value.slice(-4)
          });
          setSecretMessage(`已从环境变量 ${providerConfig.apiKeyEnv} 读取 API Key。`);
          return value;
        }
      } catch {
        // fall through to keychain
      }
    }

    try {
      const secret = await getProviderSecret(providerConfig.id);
      if (providerConfig.id === "deepseek") {
        setDeepSeekApiKey(secret.value);
      }
      setSecretStatus({
        provider: secret.provider,
        source: "keychain",
        hasSecret: true,
        last4: secret.last4
      });
      setSecretMessage(`已从安全存储读取 ${providerConfig.label} API Key${secret.last4 ? `，尾号 ${secret.last4}` : ""}。`);
      return secret.value;
    } catch {
      setProviderError(`${providerConfig.label} API Key 不能为空。请设置 ${providerConfig.apiKeyEnv}，或先保存到系统安全存储。`);
      return null;
    }
  }

  async function testProviderConnection() {
    setProviderError(null);
    setProviderTestMessage("正在测试 DeepSeek 连接...");

    const client = await createLlmClient("provider smoke test");
    if (!client) {
      setProviderTestMessage("连接测试未运行。");
      return;
    }

    try {
      const result = await withTimeout(
        runProviderSmokeTest(client),
        PROVIDER_TEST_TIMEOUT_MS,
        "DeepSeek 连接测试超时。"
      );
      setProviderTestMessage(
        `连接正常：${result.text || result.finishReason || "ok"} (${result.durationMs}ms)`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setProviderTestMessage(`连接失败：${message}`);
      setProviderError(message);
    }
  }

  async function refreshProviderSecretStatus(providerId = provider) {
    if (providerId === "mock") {
      setSecretStatus(null);
      setSecretMessage(null);
      return;
    }

    try {
      const status = await getProviderSecretStatus(providerId);
      setSecretStatus(status);
      setSecretMessage(secretStatusText(status));
    } catch (error) {
      setSecretStatus(null);
      setSecretMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function saveDeepSeekApiKey() {
    const value = deepSeekApiKey.trim();
    if (!value) {
      setSecretMessage("没有可保存的 API Key。");
      return;
    }

    try {
      const status = await setProviderSecret(provider, value);
      setSecretStatus(status);
      setSecretMessage(secretStatusText(status));
      setProviderError(null);
    } catch (error) {
      setSecretMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function loadDeepSeekApiKey() {
    try {
      const secret = await getProviderSecret(provider);
      if (provider === "deepseek") {
        setDeepSeekApiKey(secret.value);
      }
      setSecretStatus({
        provider: secret.provider,
        source: "keychain",
        hasSecret: true,
        last4: secret.last4
      });
      setSecretMessage(`已从安全存储读取 API Key${secret.last4 ? `，尾号 ${secret.last4}` : ""}。`);
      setProviderError(null);
    } catch (error) {
      setSecretMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function removeDeepSeekApiKey() {
    try {
      const status = await deleteProviderSecret(provider);
      setSecretStatus(status);
      setSecretMessage(secretStatusText(status));
    } catch (error) {
      setSecretMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    provider,
    setProvider,
    deepSeekApiKey,
    setDeepSeekApiKey,
    deepSeekModel,
    setDeepSeekModel,
    deepSeekModelMode,
    setDeepSeekModelMode,
    effectiveDeepSeekModelMode,
    deepSeekBaseUrl,
    setDeepSeekBaseUrl,
    deepSeekThinkingLevel,
    setDeepSeekThinkingLevel,
    oreCodeConfig,
    configMessage,
    providerError,
    setProviderError,
    providerTestMessage,
    setProviderTestMessage,
    secretStatus,
    setSecretStatus,
    secretMessage,
    setSecretMessage,
    providerOptions,
    selectedProviderConfig,
    effectiveProviderConfig,
    modelLabel,
    refreshOreCodeConfig,
    createLlmClient,
    createConfiguredProviderClient,
    resolveProviderApiKey,
    testProviderConnection,
    refreshProviderSecretStatus,
    saveDeepSeekApiKey,
    loadDeepSeekApiKey,
    removeDeepSeekApiKey
  };
}

export function providerLabel(provider: Provider) {
  switch (provider) {
    case "mock":
      return "Mock Harness";
    case "deepseek":
      return "DeepSeek";
    default:
      return provider;
  }
}

export function fallbackDeepSeekProvider(model: string, baseUrl: string): ProviderConfig {
  return {
    id: "deepseek",
    label: "DeepSeek",
    kind: "openai-compatible",
    model: model.trim() || DEEPSEEK_V4_PRO_MODEL,
    deepSeekModelMode: DEFAULT_DEEPSEEK_MODEL_MODE,
    baseUrl: baseUrl.trim() || DEFAULT_DEEPSEEK_BASE_URL,
    apiKeyEnv: "DEEPSEEK_API_KEY",
    deepSeekThinkingLevel: DEFAULT_DEEPSEEK_THINKING_LEVEL
  };
}

export function effectiveConfiguredProvider(
  provider: string,
  config: ProviderConfig | null,
  deepSeekModel: string,
  deepSeekBaseUrl: string
): ProviderConfig | null {
  if (provider !== "deepseek") {
    return config;
  }

  const uiModel = deepSeekModel.trim();
  const uiBaseUrl = deepSeekBaseUrl.trim();
  return {
    id: "deepseek",
    label: "DeepSeek",
    kind: "openai-compatible",
    model:
      uiModel && uiModel !== DEFAULT_DEEPSEEK_MODEL
        ? uiModel
        : config?.model || DEFAULT_DEEPSEEK_MODEL,
    deepSeekModelMode: config?.deepSeekModelMode ?? DEFAULT_DEEPSEEK_MODEL_MODE,
    baseUrl:
      uiBaseUrl && uiBaseUrl !== DEFAULT_DEEPSEEK_BASE_URL
        ? uiBaseUrl
        : config?.baseUrl || DEFAULT_DEEPSEEK_BASE_URL,
    apiKeyEnv: config?.apiKeyEnv || "DEEPSEEK_API_KEY",
    deepSeekThinkingLevel: config?.deepSeekThinkingLevel ?? DEFAULT_DEEPSEEK_THINKING_LEVEL
  };
}

export function configuredModelLabel(config: ProviderConfig | null, provider: string, deepSeekModel: string) {
  if (provider === "deepseek") {
    return config?.model || deepSeekModel.trim() || "DeepSeek";
  }
  if (config) {
    return `${config.label} · ${config.model}`;
  }
  return providerLabel(provider);
}

export function configSummary(config: ResolvedOreCodeConfig) {
  const loaded = config.sources.filter((source) => source.status === "loaded").length;
  const warning = config.warnings.length ? `，${config.warnings.length} 个警告` : "";
  return `profile ${config.activeProfile} · provider ${config.providerId} · ${loaded} 个配置文件已加载${warning}`;
}

export function secretStatusText(status: ProviderSecretStatus) {
  if (status.source === "unsupported") {
    return "浏览器预览不支持系统安全存储。";
  }

  if (!status.hasSecret) {
    return `系统安全存储中尚未保存 ${status.provider} API Key。`;
  }

  if (status.source === "env") {
    return `环境变量已提供 ${status.provider} API Key${status.last4 ? `，尾号 ${status.last4}` : ""}。`;
  }

  return `安全存储已保存 ${status.provider} API Key${status.last4 ? `，尾号 ${status.last4}` : ""}。`;
}

export function secretRuntimeText(status: ProviderSecretStatus | null) {
  if (!status) {
    return "unknown";
  }

  if (status.source === "unsupported") {
    return "unsupported";
  }

  if (!status.hasSecret) {
    return "missing";
  }

  return status.last4 ? `${status.source}:${status.last4}` : status.source;
}

function uniqueProviderOptions(options: Array<{ label: string; value: string }>) {
  const seen = new Set<string>();
  return options.filter((option) => {
    if (seen.has(option.value)) {
      return false;
    }
    seen.add(option.value);
    return true;
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}
