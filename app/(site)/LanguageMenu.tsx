import Link from "next/link";
import { HTML_LANG, LANGS, LANG_NAMES, type SiteLang } from "./welcome/copy";

const SHORT: Record<SiteLang, string> = { en: "EN", "zh-hant": "繁", "zh-hans": "简" };

/**
 * The language switch as a globe: the globe plus the current language's short code opens a small menu of the three
 * languages. A native <details>, so it works without JavaScript and with the keyboard; each choice is a plain link.
 */
export default function LanguageMenu({ lang, label, hrefFor }: { lang: SiteLang; label: string; hrefFor: (l: SiteLang) => string }) {
  return (
    <details className="lang-menu">
      <summary aria-label={`${label}: ${LANG_NAMES[lang]}`}>
        <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18" />
        </svg>
        <span>{SHORT[lang]}</span>
      </summary>
      <ul>
        {LANGS.map((l) => (
          <li key={l}>
            <Link href={hrefFor(l)} lang={HTML_LANG[l]} aria-current={l === lang ? "true" : undefined}>{LANG_NAMES[l]}</Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
