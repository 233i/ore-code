import { describe, expect, it } from "vitest";
import {
  deepSeekThinkingRequestPatch,
  normalizeDeepSeekThinkingLevel,
  parseDeepSeekThinkingLevel
} from "./deepseek-thinking";

describe("DeepSeek thinking levels", () => {
  it("normalizes documented and compatibility aliases", () => {
    expect(normalizeDeepSeekThinkingLevel(undefined)).toBe("auto");
    expect(parseDeepSeekThinkingLevel("disabled")).toBe("off");
    expect(parseDeepSeekThinkingLevel("low")).toBe("high");
    expect(parseDeepSeekThinkingLevel("medium")).toBe("high");
    expect(parseDeepSeekThinkingLevel("xhigh")).toBe("max");
  });

  it("maps UI levels to DeepSeek request fields", () => {
    expect(deepSeekThinkingRequestPatch("auto")).toEqual({});
    expect(deepSeekThinkingRequestPatch("off")).toEqual({ thinking: { type: "disabled" } });
    expect(deepSeekThinkingRequestPatch("high")).toEqual({
      thinking: { type: "enabled" },
      reasoning_effort: "high"
    });
    expect(deepSeekThinkingRequestPatch("max")).toEqual({
      thinking: { type: "enabled" },
      reasoning_effort: "max"
    });
  });
});
