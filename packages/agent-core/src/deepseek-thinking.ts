export const DEEPSEEK_THINKING_LEVELS = ["auto", "off", "high", "max"] as const;
export const MIMO_THINKING_LEVELS = ["auto", "off", "on"] as const;
export const PROVIDER_THINKING_LEVELS = ["auto", "off", "on", "high", "max"] as const;

export type DeepSeekThinkingLevel = typeof DEEPSEEK_THINKING_LEVELS[number];
export type MimoThinkingLevel = typeof MIMO_THINKING_LEVELS[number];
export type ProviderThinkingLevel = typeof PROVIDER_THINKING_LEVELS[number];
export type DeepSeekReasoningEffort = "high" | "max";
export type DeepSeekThinkingType = "enabled" | "disabled";

export interface DeepSeekThinkingRequestPatch {
  thinking?: {
    type: DeepSeekThinkingType;
  };
  reasoning_effort?: DeepSeekReasoningEffort;
}

export interface MimoThinkingRequestPatch {
  thinking?: {
    type: DeepSeekThinkingType;
  };
}

export function parseDeepSeekThinkingLevel(value: unknown): DeepSeekThinkingLevel | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase().replace(/[\s_]+/g, "-");
  switch (normalized) {
    case "auto":
    case "default":
      return "auto";
    case "off":
    case "none":
    case "disabled":
    case "disable":
      return "off";
    case "high":
    case "enabled":
    case "enable":
    case "low":
    case "medium":
      return "high";
    case "max":
    case "maximum":
    case "xhigh":
    case "x-high":
      return "max";
    default:
      return undefined;
  }
}

export function normalizeDeepSeekThinkingLevel(value: unknown): DeepSeekThinkingLevel {
  return parseDeepSeekThinkingLevel(value) ?? "auto";
}

export function parseMimoThinkingLevel(value: unknown): MimoThinkingLevel | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase().replace(/[\s_]+/g, "-");
  switch (normalized) {
    case "auto":
    case "default":
      return "auto";
    case "off":
    case "none":
    case "disabled":
    case "disable":
    case "false":
      return "off";
    case "on":
    case "enabled":
    case "enable":
    case "true":
    case "high":
    case "max":
    case "maximum":
      return "on";
    default:
      return undefined;
  }
}

export function normalizeMimoThinkingLevel(value: unknown): MimoThinkingLevel {
  return parseMimoThinkingLevel(value) ?? "auto";
}

export function parseProviderThinkingLevel(provider: string, value: unknown): ProviderThinkingLevel | undefined {
  if (provider === "mimo") {
    return parseMimoThinkingLevel(value);
  }
  return parseDeepSeekThinkingLevel(value);
}

export function deepSeekThinkingRequestPatch(value: unknown): DeepSeekThinkingRequestPatch {
  const level = normalizeDeepSeekThinkingLevel(value);
  switch (level) {
    case "off":
      return { thinking: { type: "disabled" } };
    case "high":
      return { thinking: { type: "enabled" }, reasoning_effort: "high" };
    case "max":
      return { thinking: { type: "enabled" }, reasoning_effort: "max" };
    case "auto":
    default:
      return {};
  }
}

export function mimoThinkingRequestPatch(value: unknown): MimoThinkingRequestPatch {
  const level = normalizeMimoThinkingLevel(value);
  switch (level) {
    case "off":
      return { thinking: { type: "disabled" } };
    case "on":
      return { thinking: { type: "enabled" } };
    case "auto":
    default:
      return {};
  }
}

export function isDeepSeekThinkingExplicitlyEnabled(value: unknown): boolean {
  const patch = deepSeekThinkingRequestPatch(value);
  return patch.thinking?.type === "enabled";
}
