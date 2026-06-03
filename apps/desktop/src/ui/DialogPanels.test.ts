import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "@ore-code/protocol";
import {
  buildInteractionDecision,
  CUSTOM_INTERACTION_OPTION_LABEL
} from "./DialogPanels";

describe("InteractionDialog helpers", () => {
  it("builds option decisions and keeps the custom fallback label available", () => {
    expect(CUSTOM_INTERACTION_OPTION_LABEL).toBe("以上都不满足，我补充信息");
    expect(buildInteractionDecision({
      request: interactionRequest(),
      customMode: false,
      customText: "",
      selectedOptionId: "ore-code"
    })).toEqual({
      decision: { type: "option", optionId: "ore-code", value: "/repo/Ore Code" }
    });
  });

  it("requires custom text for custom decisions", () => {
    expect(buildInteractionDecision({
      request: interactionRequest(),
      customMode: true,
      customText: "  ",
      selectedOptionId: "ore-code"
    })).toEqual({ error: "请补充信息后再继续。" });

    expect(buildInteractionDecision({
      request: interactionRequest(),
      customMode: true,
      customText: " 使用 /tmp/custom ",
      selectedOptionId: "ore-code"
    })).toEqual({
      decision: { type: "custom", customText: "使用 /tmp/custom" }
    });
  });
});

function interactionRequest(): Extract<RuntimeEvent, { type: "interaction_requested" }> {
  return {
    id: "event-1",
    seq: 0,
    threadId: "thread-1",
    turnId: "turn-1",
    createdAt: "2026-05-19T00:00:00.000Z",
    type: "interaction_requested",
    requestId: "request-1",
    title: "选择项目",
    message: "请选择项目。",
    recommendedOptionId: "ore-code",
    options: [
      { id: "ore-code", label: "Ore Code", value: "/repo/Ore Code" }
    ]
  };
}
