export const DEEPSEEK_THINKING_LEVELS = ["auto", "off", "high", "max"] as const;

export type DeepSeekThinkingLevel = typeof DEEPSEEK_THINKING_LEVELS[number];
export type DeepSeekReasoningEffort = "high" | "max";
export type DeepSeekThinkingType = "enabled" | "disabled";

export interface DeepSeekThinkingRequestPatch {
  thinking?: {
    type: DeepSeekThinkingType;
  };
  reasoning_effort?: DeepSeekReasoningEffort;
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

export function isDeepSeekThinkingExplicitlyEnabled(value: unknown): boolean {
  const patch = deepSeekThinkingRequestPatch(value);
  return patch.thinking?.type === "enabled";
}
