import { useEffect, useState } from "react";
import type { DeepSeekModelMode, DeepSeekThinkingLevel } from "@ore-code/agent-core";
import type { ResolvedOreCodeConfig } from "../services/oreCodeConfig";
import { loadAppSettings, saveAppSettings, type ThemePreference } from "../services/appSettings";
import { resolveUiLocale, type UiLocalePreference } from "../services/uiLocale";
import { addWorkspacePathPreservingOrder } from "../hooks/useWorkspaceProjects";
import {
  type AppMode,
  modeFromPermissionPreset,
  presetFromMode,
  type PermissionPreset
} from "../ui/permissionPreset";
import type { Provider } from "../hooks/useProviderConfig";

type AppSettingsControllerInput = {
  deepSeekBaseUrl: string;
  deepSeekModel: string;
  deepSeekModelMode: DeepSeekModelMode;
  deepSeekThinkingLevel: DeepSeekThinkingLevel;
  disabledSkillIds: string[];
  onDisabledSkillIdsLoaded: (ids: string[]) => void;
  onWorkspaceSettingsLoaded: (path: string, paths: string[]) => Promise<void>;
  provider: Provider;
  recentWorkspacePaths: string[];
  refreshOreCodeConfig: (workspacePath: string) => Promise<ResolvedOreCodeConfig>;
  setDeepSeekBaseUrl: (value: string) => void;
  setDeepSeekModel: (value: string) => void;
  setDeepSeekModelMode: (value: DeepSeekModelMode) => void;
  setDeepSeekThinkingLevel: (value: DeepSeekThinkingLevel) => void;
  setProvider: (provider: Provider) => void;
  workspacePath: string;
};

export function useAppSettingsController({
  deepSeekBaseUrl,
  deepSeekModel,
  deepSeekModelMode,
  deepSeekThinkingLevel,
  disabledSkillIds,
  onDisabledSkillIdsLoaded,
  onWorkspaceSettingsLoaded,
  provider,
  recentWorkspacePaths,
  refreshOreCodeConfig,
  setDeepSeekBaseUrl,
  setDeepSeekModel,
  setDeepSeekModelMode,
  setDeepSeekThinkingLevel,
  setProvider,
  workspacePath
}: AppSettingsControllerInput) {
  const [mode, setMode] = useState<AppMode>("agent");
  const [permissionPreset, setPermissionPresetState] = useState<PermissionPreset>("default");
  const [includeIdeContext, setIncludeIdeContext] = useState(false);
  const [enableCacheWarmup, setEnableCacheWarmup] = useState(false);
  const [themePreference, setThemePreference] = useState<ThemePreference>("system");
  const [localePreference, setLocalePreference] = useState<UiLocalePreference>("system");
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light");
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const resolvedLocale = resolveUiLocale(localePreference);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const nextResolvedTheme = themePreference === "system"
        ? media.matches ? "dark" : "light"
        : themePreference;
      setResolvedTheme(nextResolvedTheme);
      document.documentElement.dataset.theme = nextResolvedTheme;
      document.documentElement.dataset.themePreference = themePreference;
      document.documentElement.style.colorScheme = nextResolvedTheme;
    };

    applyTheme();
    if (themePreference === "system") {
      media.addEventListener("change", applyTheme);
      return () => media.removeEventListener("change", applyTheme);
    }

    return undefined;
  }, [themePreference]);

  useEffect(() => {
    document.documentElement.lang = resolvedLocale;
    document.documentElement.dataset.locale = resolvedLocale;
    document.documentElement.dataset.localePreference = localePreference;
  }, [localePreference, resolvedLocale]);

  useEffect(() => {
    if (!settingsLoaded) {
      return;
    }

    const timer = window.setTimeout(() => {
      void persistAppSettings();
    }, 300);

    return () => window.clearTimeout(timer);
  }, [settingsLoaded, provider, mode, permissionPreset, includeIdeContext, enableCacheWarmup, themePreference, localePreference, deepSeekModel, deepSeekModelMode, deepSeekBaseUrl, deepSeekThinkingLevel, workspacePath, recentWorkspacePaths, disabledSkillIds]);

  function setPermissionPreset(nextPreset: PermissionPreset) {
    setPermissionPresetState(nextPreset);
    if (mode !== "plan") {
      setMode(modeFromPermissionPreset(nextPreset));
    }
  }

  function togglePlanMode(enabled: boolean) {
    setMode(enabled ? "plan" : modeFromPermissionPreset(permissionPreset));
  }

  async function loadSavedSettings() {
    try {
      const settings = await loadAppSettings();
      setProvider(settings.provider);
      setMode(settings.mode);
      setPermissionPresetState(settings.permissionPreset ?? presetFromMode(settings.mode));
      setIncludeIdeContext(settings.includeIdeContext);
      setEnableCacheWarmup(settings.enableCacheWarmup);
      setThemePreference(settings.themePreference);
      setLocalePreference(settings.localePreference);
      setDeepSeekModel(settings.deepSeekModel);
      setDeepSeekModelMode(settings.deepSeekModelMode);
      setDeepSeekBaseUrl(settings.deepSeekBaseUrl);
      setDeepSeekThinkingLevel(settings.deepSeekThinkingLevel);
      onDisabledSkillIdsLoaded(settings.disabledSkillIds);
      setSettingsLoaded(true);
      setSettingsMessage("设置已加载。");
      await onWorkspaceSettingsLoaded(settings.workspacePath, settings.workspacePaths);
      const config = await refreshOreCodeConfig(settings.workspacePath);
      if (settings.provider === "mock" && config.providerId && config.providerId !== "mock") {
        setProvider(config.providerId);
      }
    } catch (error) {
      setSettingsLoaded(true);
      setSettingsMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function persistAppSettings() {
    try {
      await saveAppSettings({
        provider,
        mode,
        permissionPreset,
        includeIdeContext,
        enableCacheWarmup,
        themePreference,
        localePreference,
        deepSeekModel,
        deepSeekModelMode,
        deepSeekBaseUrl,
        deepSeekThinkingLevel,
        workspacePath,
        workspacePaths: addWorkspacePathPreservingOrder(recentWorkspacePaths, workspacePath),
        disabledSkillIds
      });
      setSettingsMessage("设置已保存。");
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    enableCacheWarmup,
    includeIdeContext,
    loadSavedSettings,
    localePreference,
    mode,
    permissionPreset,
    persistAppSettings,
    resolvedLocale,
    resolvedTheme,
    setEnableCacheWarmup,
    setIncludeIdeContext,
    setLocalePreference,
    setMode,
    setPermissionPreset,
    setSettingsMessage,
    setThemePreference,
    settingsLoaded,
    settingsMessage,
    themePreference,
    togglePlanMode
  };
}
