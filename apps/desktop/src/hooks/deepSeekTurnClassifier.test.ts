import { describe, expect, it } from "vitest";
import { MockLlmClient, type LlmClient } from "@seekforge/agent-core";
import {
  classifyDeepSeekTurnWithFlash,
  classifyDeepSeekTurnWithFlashCached,
  parseDeepSeekTurnClassifierResult
} from "./deepSeekTurnClassifier";

describe("deepSeekTurnClassifier", () => {
  it("parses compact classifier JSON", () => {
    expect(parseDeepSeekTurnClassifierResult(
      "{\"intent\":\"readonly\",\"sideEffectRisk\":\"none\",\"confidence\":0.91,\"reason\":\"inspection\"}"
    )).toEqual({
      confidence: 0.91,
      intent: "readonly",
      reason: "inspection",
      sideEffectRisk: "none"
    });
  });

  it("extracts fenced JSON and clamps confidence", () => {
    expect(parseDeepSeekTurnClassifierResult(
      "```json\n{\"intent\":\"side_effect\",\"sideEffectRisk\":\"required\",\"confidence\":2,\"reason\":\"edit\"}\n```"
    )).toMatchObject({
      confidence: 1,
      intent: "side_effect",
      sideEffectRisk: "required"
    });
  });

  it("rejects malformed classifier output", () => {
    expect(parseDeepSeekTurnClassifierResult("readonly")).toBeNull();
    expect(parseDeepSeekTurnClassifierResult("{\"intent\":\"readonly\",\"confidence\":0.8}")).toBeNull();
  });

  it("uses the Flash model override when classifying a turn", async () => {
    const calls: Array<{ modelOverride?: string; reason: string }> = [];
    const result = await classifyDeepSeekTurnWithFlash({
      createConfiguredProviderClient: async (reason, options) => {
        calls.push({ reason, modelOverride: options?.modelOverride });
        return new MockLlmClient([
          { type: "assistant_delta", text: "{\"intent\":\"readonly\",\"sideEffectRisk\":\"none\",\"confidence\":0.9}" },
          { type: "done" }
        ]) as LlmClient;
      },
      prompt: "总结项目结构"
    });

    expect(calls).toEqual([{ reason: "DeepSeek auto model classifier", modelOverride: "deepseek-v4-flash" }]);
    expect(result).toMatchObject({
      confidence: 0.9,
      intent: "readonly",
      sideEffectRisk: "none"
    });
  });

  it("caches classifier results for identical inputs until TTL expiry", async () => {
    const cache = new Map();
    let calls = 0;
    const createConfiguredProviderClient = async () => {
      calls += 1;
      return new MockLlmClient([
        { type: "assistant_delta", text: "{\"intent\":\"readonly\",\"sideEffectRisk\":\"none\",\"confidence\":0.9}" },
        { type: "done" }
      ]) as LlmClient;
    };

    await classifyDeepSeekTurnWithFlashCached({
      cache,
      contextTextChars: 20,
      createConfiguredProviderClient,
      nowMs: 1_000,
      prompt: "总结项目结构",
      ttlMs: 1_000
    });
    await classifyDeepSeekTurnWithFlashCached({
      cache,
      contextTextChars: 20,
      createConfiguredProviderClient,
      nowMs: 1_500,
      prompt: "总结项目结构",
      ttlMs: 1_000
    });
    await classifyDeepSeekTurnWithFlashCached({
      cache,
      contextTextChars: 20,
      createConfiguredProviderClient,
      nowMs: 2_100,
      prompt: "总结项目结构",
      ttlMs: 1_000
    });

    expect(calls).toBe(2);
  });
});
