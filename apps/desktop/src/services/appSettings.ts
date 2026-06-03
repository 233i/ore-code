import { invoke } from "@tauri-apps/api/core";
import {
  DEEPSEEK_MODEL_MODES,
  DEEPSEEK_THINKING_LEVELS,
  normalizeDeepSeekModelMode,
  normalizeDeepSeekThinkingLevel
} from "@ore-code/agent-core";
import { z } from "zod";
import { isTauriRuntime } from "./fileHost";
import { normalizeUiLocalePreference, type UiLocalePreference } from "./uiLocale";

const APP_SETTINGS_STORAGE_KEY = "ore-code.app-settings";
export const DEFAULT_PROVIDER = "deepseek";
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-pro";
export const DEFAULT_DEEPSEEK_MODEL_MODE = "auto";
export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com/beta";
export const DEFAULT_DEEPSEEK_THINKING_LEVEL = "auto";
const DEVELOPER_HARNESS_ENABLED = import.meta.env.DEV || import.meta.env.MODE === "test";
export type ThemePreference = "system" | "light" | "dark";

export const AppSettingsSchema = z.object({
  provider: z.string().trim().min(1).default(DEFAULT_PROVIDER),
  mode: z.enum(["plan", "agent", "yolo"]).default("agent"),
  permissionPreset: z.enum(["default", "autoReview", "fullAccess"]).default("default"),
  includeIdeContext: z.boolean().default(false),
  enableCacheWarmup: z.boolean().default(false),
  themePreference: z.enum(["system", "light", "dark"]).default("system"),
  localePreference: z.enum(["system", "zh-CN", "en-US"]).default("system"),
  deepSeekModel: z.string().trim().min(1).default(DEFAULT_DEEPSEEK_MODEL),
  deepSeekModelMode: z.preprocess(
    (value) => normalizeDeepSeekModelMode(value),
    z.enum(DEEPSEEK_MODEL_MODES)
  ).default(DEFAULT_DEEPSEEK_MODEL_MODE),
  deepSeekBaseUrl: z.string().trim().min(1).default(DEFAULT_DEEPSEEK_BASE_URL),
  deepSeekThinkingLevel: z.preprocess(
    (value) => normalizeDeepSeekThinkingLevel(value),
    z.enum(DEEPSEEK_THINKING_LEVELS)
  ).default(DEFAULT_DEEPSEEK_THINKING_LEVEL),
  workspacePath: z.string().trim().min(1).default("."),
  workspacePaths: z.array(z.string().trim().min(1)).default([]),
  disabledSkillIds: z.array(z.string().trim().min(1)).default([])
});

export type AppSettings = z.infer<typeof AppSettingsSchema>;

export const defaultAppSettings: AppSettings = normalizeAppSettings(AppSettingsSchema.parse({}));

export async function loadAppSettings(): Promise<AppSettings> {
  if (isTauriRuntime()) {
    const raw = await invoke<unknown>("app_settings_read");
    return normalizeAppSettings(AppSettingsSchema.parse(raw));
  }

  const raw = window.localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
  if (!raw) {
    return defaultAppSettings;
  }

  return normalizeAppSettings(AppSettingsSchema.parse(JSON.parse(raw)));
}

export async function saveAppSettings(settings: AppSettings): Promise<AppSettings> {
  const sanitized = normalizeAppSettings(AppSettingsSchema.parse(settings));

  if (isTauriRuntime()) {
    const raw = await invoke<unknown>("app_settings_write", { settings: sanitized });
    return normalizeAppSettings(AppSettingsSchema.parse(raw));
  }

  window.localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(sanitized));
  return sanitized;
}

export function normalizeAppSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    provider: normalizeProviderId(settings.provider),
    localePreference: normalizeUiLocalePreference(settings.localePreference) as UiLocalePreference,
    deepSeekModel: normalizeDeepSeekModel(settings.deepSeekModel),
    deepSeekModelMode: normalizeDeepSeekModelMode(settings.deepSeekModelMode),
    deepSeekBaseUrl: normalizeDeepSeekBaseUrl(settings.deepSeekBaseUrl),
    deepSeekThinkingLevel: normalizeDeepSeekThinkingLevel(settings.deepSeekThinkingLevel),
    workspacePaths: normalizeWorkspacePaths(settings.workspacePath, settings.workspacePaths)
  };
}

function normalizeProviderId(provider: string) {
  const normalized = provider.trim() || DEFAULT_PROVIDER;
  return normalized === "mock" && !DEVELOPER_HARNESS_ENABLED ? DEFAULT_PROVIDER : normalized;
}

function normalizeWorkspacePaths(activeWorkspacePath: string, workspacePaths: string[]) {
  const normalizedPaths = [
    ...new Set(workspacePaths.map((path) => path.trim()).filter((path) => path && path !== "."))
  ];
  const activePath = activeWorkspacePath.trim();
  return activePath && activePath !== "." && !normalizedPaths.includes(activePath)
    ? [...normalizedPaths, activePath]
    : normalizedPaths;
}

function normalizeDeepSeekModel(model: string) {
  return model.trim();
}

function normalizeDeepSeekBaseUrl(baseUrl: string) {
  return baseUrl.trim();
}
