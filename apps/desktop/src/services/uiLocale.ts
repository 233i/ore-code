export const UI_LOCALES = ["zh-CN", "en-US"] as const;
export type UiLocale = typeof UI_LOCALES[number];

export const UI_LOCALE_PREFERENCES = ["system", ...UI_LOCALES] as const;
export type UiLocalePreference = typeof UI_LOCALE_PREFERENCES[number];

export const DEFAULT_UI_LOCALE: UiLocale = "zh-CN";

export function resolveUiLocale(
  preference: UiLocalePreference,
  languages: readonly string[] = browserLanguages()
): UiLocale {
  if (preference !== "system") {
    return preference;
  }

  for (const language of languages) {
    const normalized = normalizeLanguageTag(language);
    if (normalized.startsWith("zh")) {
      return "zh-CN";
    }
    if (normalized.startsWith("en")) {
      return "en-US";
    }
  }

  return DEFAULT_UI_LOCALE;
}

export function normalizeUiLocalePreference(value: string | undefined): UiLocalePreference {
  const normalized = normalizeLanguageTag(value ?? "");
  if (normalized === "system") {
    return "system";
  }
  if (normalized.startsWith("zh")) {
    return "zh-CN";
  }
  if (normalized.startsWith("en")) {
    return "en-US";
  }
  return "system";
}

function browserLanguages() {
  if (typeof navigator === "undefined") {
    return [];
  }
  return navigator.languages?.length ? navigator.languages : [navigator.language].filter(Boolean);
}

function normalizeLanguageTag(language: string) {
  return language.trim().replace("_", "-").toLowerCase();
}
