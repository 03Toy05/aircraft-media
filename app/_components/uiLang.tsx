"use client";

import { createContext, useContext, useEffect, useMemo, useRef } from "react";
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

const LANG_SHORT: Record<UiLang, string> = { en: "EN", "zh-Hant": "繁", "zh-Hans": "简" };
const LANG_NAME: Record<UiLang, string> = { en: "English", "zh-Hant": "繁體中文", "zh-Hans": "简体中文" };

/**
 * The language switch, as on the front page: a globe with the current language's short code opens a small menu of
 * the three languages. Choosing one switches the whole site and redraws the page (what was typed stays).
 */
export function LangSwitch({ className }: { className?: string }) {
  const lang = useUiLang();
  const router = useRouter();
  const t = useT();
  const ref = useRef<HTMLDetailsElement>(null);
  // Closes when a choice is made or a click lands elsewhere.
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false; };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  return (
    <details ref={ref} className={`ui-lang-menu${className ? ` ${className}` : ""}`}>
      <summary aria-label={`${t("Language")}: ${LANG_NAME[lang]}`}>
        <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18" />
        </svg>
        <span>{LANG_SHORT[lang]}</span>
      </summary>
      <ul>
        {UI_LANGS.map((l) => (
          <li key={l}>
            <button type="button" lang={l === "en" ? "en" : l} aria-current={l === lang ? "true" : undefined}
              onClick={() => { if (ref.current) ref.current.open = false; if (l !== lang) { rememberUiLang(l); router.refresh(); } }}>
              {LANG_NAME[l]}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
