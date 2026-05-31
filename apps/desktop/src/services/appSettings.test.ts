import { describe, expect, it } from "vitest";
import {
  AppSettingsSchema,
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_DEEPSEEK_MODEL_MODE,
  DEFAULT_DEEPSEEK_THINKING_LEVEL,
  DEFAULT_PROVIDER,
  defaultAppSettings,
  normalizeAppSettings
} from "./appSettings";

describe("AppSettingsSchema", () => {
  it("fills stable desktop defaults", () => {
    expect(defaultAppSettings).toEqual({
      provider: DEFAULT_PROVIDER,
      mode: "agent",
      permissionPreset: "default",
      includeIdeContext: false,
      enableCacheWarmup: false,
      themePreference: "system",
      localePreference: "system",
      deepSeekModel: DEFAULT_DEEPSEEK_MODEL,
      deepSeekModelMode: DEFAULT_DEEPSEEK_MODEL_MODE,
      deepSeekBaseUrl: DEFAULT_DEEPSEEK_BASE_URL,
      deepSeekThinkingLevel: DEFAULT_DEEPSEEK_THINKING_LEVEL,
      workspacePath: ".",
      workspacePaths: [],
      disabledSkillIds: []
    });
  });

  it("does not preserve api keys in app settings", () => {
    const settings = AppSettingsSchema.parse({
      provider: "deepseek",
      deepSeekApiKey: "sk-test"
    });

    expect(settings).not.toHaveProperty("deepSeekApiKey");
  });

  it("migrates legacy DeepSeek defaults to the V4 Pro endpoint", () => {
    const settings = normalizeAppSettings(AppSettingsSchema.parse({
      provider: "deepseek",
      deepSeekModel: "deepseek-chat",
      deepSeekBaseUrl: "https://api.deepseek.com/v1"
    }));

    expect(settings.deepSeekModel).toBe(DEFAULT_DEEPSEEK_MODEL);
    expect(settings.deepSeekBaseUrl).toBe(DEFAULT_DEEPSEEK_BASE_URL);
  });

  it("normalizes persisted UI locale preferences", () => {
    const settings = normalizeAppSettings(AppSettingsSchema.parse({
      localePreference: "en-US"
    }));

    expect(settings.localePreference).toBe("en-US");
  });

  it("normalizes persisted DeepSeek thinking levels", () => {
    const settings = normalizeAppSettings(AppSettingsSchema.parse({
      deepSeekThinkingLevel: "xhigh"
    }));

    expect(settings.deepSeekThinkingLevel).toBe("max");
  });

  it("defaults and normalizes persisted DeepSeek model modes", () => {
    expect(AppSettingsSchema.parse({}).deepSeekModelMode).toBe("auto");

    const flashSettings = normalizeAppSettings(AppSettingsSchema.parse({
      deepSeekModelMode: "deepseek-v4-flash"
    }));
    expect(flashSettings.deepSeekModelMode).toBe("flash");

    const invalidSettings = normalizeAppSettings(AppSettingsSchema.parse({
      deepSeekModelMode: "unknown"
    }));
    expect(invalidSettings.deepSeekModelMode).toBe("auto");
  });
});
