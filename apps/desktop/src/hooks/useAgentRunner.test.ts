import { describe, expect, it } from "vitest";
import { resolveActiveModel } from "./useAgentRunner";

describe("resolveActiveModel", () => {
  it("returns concrete DeepSeek API models for auto routing", () => {
    expect(resolveActiveModel({
      classifier: { confidence: 0.9, intent: "readonly", sideEffectRisk: "none" },
      provider: "deepseek",
      effectiveProviderConfig: null,
      deepSeekModel: "deepseek-v4-pro",
      deepSeekBaseUrl: "https://api.deepseek.com/beta",
      deepSeekModelMode: "auto",
      prompt: "解释这段代码"
    })).toMatchObject({
      mode: "auto",
      resolvedModel: "deepseek-v4-flash"
    });

    expect(resolveActiveModel({
      classifier: { confidence: 0.9, intent: "side_effect", sideEffectRisk: "required" },
      provider: "deepseek",
      effectiveProviderConfig: null,
      deepSeekModel: "deepseek-v4-pro",
      deepSeekBaseUrl: "https://api.deepseek.com/beta",
      deepSeekModelMode: "auto",
      prompt: "修复 bug"
    })).toMatchObject({
      mode: "auto",
      resolvedModel: "deepseek-v4-pro"
    });
  });

  it("marks ambiguous auto routing as requiring the Flash classifier", () => {
    expect(resolveActiveModel({
      provider: "deepseek",
      effectiveProviderConfig: null,
      deepSeekModel: "deepseek-v4-pro",
      deepSeekBaseUrl: "https://api.deepseek.com/beta",
      deepSeekModelMode: "auto",
      prompt: "解释这段代码"
    })).toMatchObject({
      mode: "auto",
      resolvedModel: "deepseek-v4-pro",
      reason: "classifier_required",
      deepSeek: { requiresClassifier: true }
    });
  });

  it("routes explicit Pro intents without requiring the Flash classifier", () => {
    expect(resolveActiveModel({
      provider: "deepseek",
      effectiveProviderConfig: null,
      deepSeekModel: "deepseek-v4-pro",
      deepSeekBaseUrl: "https://api.deepseek.com/beta",
      deepSeekModelMode: "auto",
      prompt: "修改变量名"
    })).toMatchObject({
      mode: "auto",
      resolvedModel: "deepseek-v4-pro",
      reason: "explicit_pro_intent"
    });
  });

  it("returns local route for local answer prompts in auto mode", () => {
    expect(resolveActiveModel({
      provider: "deepseek",
      effectiveProviderConfig: null,
      deepSeekModel: "deepseek-v4-pro",
      deepSeekBaseUrl: "https://api.deepseek.com/beta",
      deepSeekModelMode: "auto",
      prompt: "现在几点"
    })).toMatchObject({
      mode: "auto",
      route: "local",
      resolvedModel: undefined,
      reason: "local_time",
      localResponse: expect.stringContaining("现在是")
    });
  });

  it("honors manual DeepSeek model modes", () => {
    expect(resolveActiveModel({
      provider: "deepseek",
      effectiveProviderConfig: null,
      deepSeekModel: "deepseek-v4-pro",
      deepSeekBaseUrl: "https://api.deepseek.com/beta",
      deepSeekModelMode: "flash",
      prompt: "修复 bug"
    })).toMatchObject({
      mode: "flash",
      resolvedModel: "deepseek-v4-flash"
    });
  });
});
