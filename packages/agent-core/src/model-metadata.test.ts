import { describe, expect, it } from "vitest";
import {
  contextWindowForModel,
  DEEPSEEK_V4_MAX_OUTPUT_TOKENS,
  inputBudgetForModel,
  isDeepSeekThinkingModel,
  maxOutputTokensForModel,
  SAFETY_HEADROOM_TOKENS
} from "./model-metadata";

describe("model metadata", () => {
  it("uses 1M context windows for DeepSeek V4 Pro and Flash", () => {
    expect(contextWindowForModel("deepseek-v4-pro")).toBe(1_000_000);
    expect(contextWindowForModel("deepseek-v4-flash")).toBe(1_000_000);
    expect(maxOutputTokensForModel("deepseek-v4-pro")).toBe(DEEPSEEK_V4_MAX_OUTPUT_TOKENS);
    expect(maxOutputTokensForModel("deepseek-v4-flash")).toBe(DEEPSEEK_V4_MAX_OUTPUT_TOKENS);
  });

  it("uses 128K for legacy DeepSeek and unknown models", () => {
    expect(contextWindowForModel("deepseek-chat")).toBe(128_000);
    expect(contextWindowForModel("deepseek-reasoner")).toBe(128_000);
    expect(contextWindowForModel("custom-coding-model")).toBe(128_000);
    expect(maxOutputTokensForModel("custom-coding-model")).toBe(8_192);
  });

  it("recognizes explicit context suffixes", () => {
    expect(contextWindowForModel("gateway-model-32k")).toBe(32_000);
    expect(contextWindowForModel("gateway-model_128K")).toBe(128_000);
    expect(contextWindowForModel("gateway-model-256k")).toBe(256_000);
    expect(contextWindowForModel("gateway-model-1M")).toBe(1_000_000);
  });

  it("recognizes DeepSeek thinking models for reasoning retention", () => {
    expect(isDeepSeekThinkingModel("deepseek-v4-pro")).toBe(true);
    expect(isDeepSeekThinkingModel("deepseek-v4-flash")).toBe(true);
    expect(isDeepSeekThinkingModel("deepseek-reasoner")).toBe(true);
    expect(isDeepSeekThinkingModel("deepseek-chat")).toBe(false);
  });

  it("calculates input budget with output reserve and safety headroom", () => {
    expect(inputBudgetForModel("deepseek-v4-pro")).toBe(1_000_000 - 65_536 - SAFETY_HEADROOM_TOKENS);
    expect(inputBudgetForModel("deepseek-chat")).toBe(128_000 - 8_192 - SAFETY_HEADROOM_TOKENS);
  });
});
