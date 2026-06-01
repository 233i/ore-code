import { DEEPSEEK_THINKING_LEVELS, type DeepSeekThinkingLevel } from "@ore-code/agent-core";

export const deepSeekThinkingOptions: Array<{
  description: string;
  label: string;
  value: DeepSeekThinkingLevel;
}> = DEEPSEEK_THINKING_LEVELS.map((value) => ({
  value,
  label: deepSeekThinkingLabel(value),
  description: deepSeekThinkingDescription(value)
}));

export function deepSeekThinkingLabel(value: DeepSeekThinkingLevel) {
  switch (value) {
    case "off":
      return "关闭思考";
    case "high":
      return "高";
    case "max":
      return "最强";
    case "auto":
    default:
      return "自动";
  }
}

export function deepSeekThinkingDescription(value: DeepSeekThinkingLevel) {
  switch (value) {
    case "off":
      return "发送 thinking disabled，适合低延迟闲聊和简单改字。";
    case "high":
      return "发送 reasoning_effort high，适合常规编码、排查和中等复杂任务。";
    case "max":
      return "发送 reasoning_effort max，适合复杂重构、长期任务和多工具规划。";
    case "auto":
    default:
      return "不显式传 thinking 参数，使用 DeepSeek 默认策略。";
  }
}
