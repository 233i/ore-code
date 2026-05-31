import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "@seekforge/protocol";
import { detectPreferredLanguage } from "./preferredLanguage";

describe("detectPreferredLanguage", () => {
  it("detects Chinese from recent user messages", () => {
    expect(detectPreferredLanguage([
      event("user_message", "帮我优化 diff 页面"),
      event("assistant_message", "ok")
    ])).toBe("zh");
  });

  it("falls back to English for Latin-only user messages", () => {
    expect(detectPreferredLanguage([
      event("user_message", "please generate a commit message")
    ])).toBe("en");
  });

  it("honors explicit English commit-message preference over Chinese context", () => {
    expect(detectPreferredLanguage([
      event("user_message", "这个功能改好了"),
      event("user_message", "用英文提交信息")
    ])).toBe("en");
  });

  it("uses the configured fallback when there are no user messages", () => {
    expect(detectPreferredLanguage([
      event("assistant_message", "hello")
    ], "zh")).toBe("zh");
  });

  it("keeps Japanese and Korean extensible", () => {
    expect(detectPreferredLanguage([event("user_message", "コミットメッセージを作って")])).toBe("ja");
    expect(detectPreferredLanguage([event("user_message", "커밋 메시지를 만들어줘")])).toBe("ko");
  });
});

function event(type: "user_message" | "assistant_message", text: string): RuntimeEvent {
  return {
    id: `${type}:${text}`,
    seq: 0,
    threadId: "thread-1",
    turnId: "turn-1",
    createdAt: new Date(0).toISOString(),
    type,
    text
  };
}
