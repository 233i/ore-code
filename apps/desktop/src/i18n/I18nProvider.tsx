import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { UiLocale } from "../services/uiLocale";
import { DEFAULT_UI_LOCALE } from "../services/uiLocale";
import { messages, type TranslationKey } from "./messages";

export type TranslationParams = Record<string, string | number>;
export type TranslateFunction = (key: TranslationKey, params?: TranslationParams) => string;

export type I18nContextValue = {
  locale: UiLocale;
  t: TranslateFunction;
};

const I18nContext = createContext<I18nContextValue>({
  locale: DEFAULT_UI_LOCALE,
  t: createTranslator(DEFAULT_UI_LOCALE)
});

export function I18nProvider({ children, locale }: { children: ReactNode; locale: UiLocale }) {
  const value = useMemo<I18nContextValue>(() => ({
    locale,
    t: createTranslator(locale)
  }), [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

export function createTranslator(locale: UiLocale): TranslateFunction {
  const dictionary = messages[locale] ?? messages[DEFAULT_UI_LOCALE];
  const fallback = messages[DEFAULT_UI_LOCALE];

  return (key, params) => {
    const template = dictionary[key] ?? fallback[key] ?? key;
    return formatTemplate(template, params);
  };
}

function formatTemplate(template: string, params?: TranslationParams) {
  if (!params) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (match, name) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}
