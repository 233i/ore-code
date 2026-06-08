import { DEEPSEEK_THINKING_LEVELS, MIMO_THINKING_LEVELS, type MimoThinkingLevel, type ProviderThinkingLevel } from "@ore-code/agent-core";

export type ThinkingOption = {
  description: string;
  label: string;
  value: ProviderThinkingLevel;
};

export const deepSeekThinkingOptions: ThinkingOption[] = DEEPSEEK_THINKING_LEVELS.map((value) => ({
  value,
  label: deepSeekThinkingLabel(value),
  description: deepSeekThinkingDescription(value)
}));

export const mimoThinkingOptions: ThinkingOption[] = MIMO_THINKING_LEVELS.map((value) => ({
  value,
  label: mimoThinkingLabel(value),
  description: mimoThinkingDescription(value)
}));

export function thinkingOptionsForProvider(provider: string): ThinkingOption[] {
  if (provider === "mimo") {
    return mimoThinkingOptions;
  }
  if (provider === "deepseek") {
    return deepSeekThinkingOptions;
  }
  return [];
}

export function thinkingLabelForProvider(provider: string, value: ProviderThinkingLevel) {
  if (provider === "mimo") {
    return mimoThinkingLabel(value);
  }
  return deepSeekThinkingLabel(value);
}

export function deepSeekThinkingLabel(value: ProviderThinkingLevel) {
  switch (value) {
    case "off":
      return "关闭思考";
    case "on":
      return "开启思考";
    case "high":
      return "高";
    case "max":
      return "最强";
    case "auto":
    default:
      return "自动";
  }
}

export function mimoThinkingLabel(value: ProviderThinkingLevel) {
  switch (value) {
    case "off":
      return "关闭思考";
    case "on":
    case "high":
    case "max":
      return "开启思考";
    case "auto":
    default:
      return "自动";
  }
}

export function deepSeekThinkingDescription(value: ProviderThinkingLevel) {
  switch (value) {
    case "off":
      return "发送 thinking disabled，适合低延迟闲聊和简单改字。";
    case "on":
      return "发送 thinking enabled，适合常规编码和排查。";
    case "high":
      return "发送 reasoning_effort high，适合常规编码、排查和中等复杂任务。";
    case "max":
      return "发送 reasoning_effort max，适合复杂重构、长期任务和多工具规划。";
    case "auto":
    default:
      return "不显式传 thinking 参数，使用 DeepSeek 默认策略。";
  }
}

export function mimoThinkingDescription(value: MimoThinkingLevel) {
  switch (value) {
    case "off":
      return "发送 thinking disabled，适合低延迟和简单任务。";
    case "on":
      return "发送 thinking enabled，适合编码、排查和复杂任务。";
    case "auto":
    default:
      return "不显式传 thinking 参数，使用 Mimo 默认策略。";
  }
}
