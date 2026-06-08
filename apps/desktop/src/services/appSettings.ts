import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import { isTauriRuntime } from "./fileHost";
import { normalizeUiLocalePreference, type UiLocalePreference } from "./uiLocale";

const APP_SETTINGS_STORAGE_KEY = "ore-code.app-settings";
export const DEFAULT_PROVIDER = "deepseek";
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-pro";
export const DEFAULT_DEEPSEEK_MODEL_MODE = "auto";
export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com/beta";
export const DEFAULT_PROVIDER_THINKING_LEVEL = "auto";
export const DEFAULT_MIMO_MODEL = "mimo-v2.5-pro";
export const DEFAULT_MIMO_BASE_URL = "https://api.xiaomimimo.com/v1";
export type ThemePreference = "system" | "light" | "dark";

export const AppSettingsSchema = z.object({
  mode: z.enum(["plan", "agent", "yolo"]).default("agent"),
  permissionPreset: z.enum(["default", "autoReview", "fullAccess"]).default("default"),
  includeIdeContext: z.boolean().default(false),
  enableCacheWarmup: z.boolean().default(false),
  themePreference: z.enum(["system", "light", "dark"]).default("system"),
  localePreference: z.enum(["system", "zh-CN", "en-US"]).default("system"),
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
    localePreference: normalizeUiLocalePreference(settings.localePreference) as UiLocalePreference,
    workspacePaths: normalizeWorkspacePaths(settings.workspacePath, settings.workspacePaths)
  };
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
