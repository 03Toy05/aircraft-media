import { cookies } from "next/headers";
import { UI_LANG_COOKIE, parseUiLang, ui, type UiLang, type UiParams } from "@/domain/uiText";

/** The screen language chosen on this browser (English until one is picked). */
export async function getUiLang(): Promise<UiLang> {
  try {
    return parseUiLang((await cookies()).get(UI_LANG_COOKIE)?.value);
  } catch {
    return "en"; // outside a request (tests, scripts)
  }
}

/** t(English label) in the screen language, for server pages and actions. */
export async function serverT(): Promise<((en: string, params?: UiParams) => string) & { lang: UiLang }> {
  const lang = await getUiLang();
  return Object.assign((en: string, params?: UiParams) => ui(lang, en, params), { lang });
}
