import { DEEPSEEK_MODEL_MODES, type DeepSeekModelMode } from "@ore-code/agent-core";

export const deepSeekModelOptions: Array<{
  description: string;
  label: string;
  value: DeepSeekModelMode;
}> = DEEPSEEK_MODEL_MODES.map((value) => ({
  value,
  label: deepSeekModelModeLabel(value),
  description: deepSeekModelModeDescription(value)
}));

export function deepSeekModelModeLabel(value: DeepSeekModelMode) {
  switch (value) {
    case "pro":
      return "V4 Pro";
    case "flash":
      return "V4 Flash";
    case "auto":
    default:
      return "Auto";
  }
}

export function deepSeekModelModeDescription(value: DeepSeekModelMode) {
  switch (value) {
    case "pro":
      return "固定使用 deepseek-v4-pro，适合复杂编码和大上下文任务。";
    case "flash":
      return "固定使用 deepseek-v4-flash，适合低成本只读分析。";
    case "auto":
    default:
      return "简单只读走 Flash，编辑、命令、测试、MCP 和复杂任务走 Pro。";
  }
}
