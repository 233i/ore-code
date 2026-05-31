import { describe, expect, it } from "vitest";
import { normalizeUiLocalePreference, resolveUiLocale } from "./uiLocale";

describe("ui locale", () => {
  it("resolves explicit locale preferences", () => {
    expect(resolveUiLocale("zh-CN", ["en-US"])).toBe("zh-CN");
    expect(resolveUiLocale("en-US", ["zh-CN"])).toBe("en-US");
  });

  it("resolves system language from browser languages", () => {
    expect(resolveUiLocale("system", ["en-GB", "zh-CN"])).toBe("en-US");
    expect(resolveUiLocale("system", ["zh-Hans-CN", "en-US"])).toBe("zh-CN");
  });

  it("normalizes persisted language-like values", () => {
    expect(normalizeUiLocalePreference("zh")).toBe("zh-CN");
    expect(normalizeUiLocalePreference("zh_TW")).toBe("zh-CN");
    expect(normalizeUiLocalePreference("en-GB")).toBe("en-US");
    expect(normalizeUiLocalePreference("unknown")).toBe("system");
  });
});
