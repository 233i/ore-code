import { describe, expect, it } from "vitest";
import {
  deepSeekThinkingRequestPatch,
  mimoThinkingRequestPatch,
  normalizeDeepSeekThinkingLevel,
  normalizeMimoThinkingLevel,
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

  it("maps Mimo thinking controls without DeepSeek reasoning effort", () => {
    expect(normalizeMimoThinkingLevel(undefined)).toBe("auto");
    expect(normalizeMimoThinkingLevel("enabled")).toBe("on");
    expect(mimoThinkingRequestPatch("auto")).toEqual({});
    expect(mimoThinkingRequestPatch("off")).toEqual({ thinking: { type: "disabled" } });
    expect(mimoThinkingRequestPatch("on")).toEqual({ thinking: { type: "enabled" } });
    expect(mimoThinkingRequestPatch("max")).toEqual({ thinking: { type: "enabled" } });
  });
});
