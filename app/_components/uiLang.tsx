"use client";

import { createContext, useContext, useMemo } from "react";
import { useRouter } from "next/navigation";
import { UI_LANGS, UI_LANG_COOKIE, errorText, ui, type UiLang, type UiParams } from "@/domain/uiText";

const LangContext = createContext<UiLang>("en");

/** The screen language for everything inside (set once in the layouts, from the language cookie). */
export function UiLangProvider({ lang, children }: { lang: UiLang; children: React.ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export const useUiLang = () => useContext(LangContext);

export type T = ((en: string, params?: UiParams) => string) & { lang: UiLang; error: (e: unknown, fallback?: string) => string };

/** t(English label) in the chosen screen language. */
export function useT(): T {
  const lang = useUiLang();
  return useMemo(() => Object.assign((en: string, params?: UiParams) => ui(lang, en, params), { lang, error: (e: unknown, fallback?: string) => errorText(lang, e, fallback) }), [lang]);
}

/** Remember the screen language on this browser (a year). Toy's chat follows it too. */
export function rememberUiLang(l: UiLang) {
  document.cookie = `${UI_LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
  try { window.localStorage.setItem("toyLang", l); } catch { /* ignore */ }
}

/** Whether a screen language was ever chosen on this browser. */
export const uiLangChosen = () => document.cookie.split(/;\s*/).some((c) => c.startsWith(`${UI_LANG_COOKIE}=`));

/** EN / 繁 / 简: switches the whole site's language and redraws the page (what was typed stays). */
export function LangSwitch({ className }: { className?: string }) {
  const lang = useUiLang();
  const router = useRouter();
  const t = useT();
  return (
    <span className={`seg lang-switch${className ? ` ${className}` : ""}`} role="radiogroup" aria-label={t("Language")}>
      {UI_LANGS.map((l) => (
        <button key={l} type="button" role="radio" aria-checked={lang === l} className={lang === l ? "on" : ""} lang={l === "en" ? "en" : l}
          title={l === "en" ? "English" : l === "zh-Hant" ? "繁體中文" : "简体中文"}
          onClick={() => { if (l !== lang) { rememberUiLang(l); router.refresh(); } }}>
          {l === "en" ? "EN" : l === "zh-Hant" ? "繁" : "简"}
        </button>
      ))}
    </span>
  );
}
