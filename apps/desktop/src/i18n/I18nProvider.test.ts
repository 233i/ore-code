import { describe, expect, it } from "vitest";
import { createTranslator } from "./I18nProvider";

describe("i18n translator", () => {
  it("translates known keys by locale", () => {
    expect(createTranslator("zh-CN")("app.action.settings")).toBe("设置");
    expect(createTranslator("en-US")("app.action.settings")).toBe("Settings");
  });

  it("formats simple placeholders", () => {
    expect(createTranslator("en-US")("app.project.sessionCount", { count: 3 })).toBe("3 chats");
    expect(createTranslator("zh-CN")("common.daysAgo", { count: 2 })).toBe("2 天前");
  });
});
