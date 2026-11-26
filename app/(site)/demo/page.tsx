import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import type { Metadata } from "next";
import Toy from "../../_components/Toy";
import { COPY, HTML_LANG, LANGS, LANG_NAMES, parseLang, type SiteLang } from "../welcome/copy";

/*
 * The demo page. The video turns up by itself once its files are in public/demo/ (nothing else to change):
 *   toy-demo.mp4                     the film (H.264/AAC MP4)            required for the player
 *   toy-demo-poster.jpg              still shown before playing         optional
 *   captions-en.vtt, captions-zh-hant.vtt, captions-zh-hans.vtt       optional caption tracks
 *   transcript-en.txt, transcript-zh-hant.txt, transcript-zh-hans.txt optional written transcript
 * The player never autoplays; captions in the page's language are on by default.
 */
const DIR = path.join(process.cwd(), "public", "demo");
const has = (f: string) => fs.existsSync(path.join(DIR, f));
const CAPTION_LANGS: { lang: SiteLang; srclang: string; label: string }[] = [
  { lang: "en", srclang: "en", label: "English" },
  { lang: "zh-hant", srclang: "zh-Hant", label: "繁體中文" },
  { lang: "zh-hans", srclang: "zh-Hans", label: "简体中文" },
];

function video() {
  if (!has("toy-demo.mp4")) return null;
  return {
    src: "/demo/toy-demo.mp4",
    poster: has("toy-demo-poster.jpg") ? "/demo/toy-demo-poster.jpg" : undefined,
    captions: CAPTION_LANGS.filter((c) => has(`captions-${c.lang}.vtt`)),
  };
}

function transcript(lang: SiteLang): string | null {
  const own = path.join(DIR, `transcript-${lang}.txt`), en = path.join(DIR, "transcript-en.txt");
  const file = fs.existsSync(own) ? own : fs.existsSync(en) ? en : null;
  return file ? fs.readFileSync(file, "utf8").trim() : null;
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Toy's first creation — Aircraft Media",
    description: "Generate a text, weblink or PDF quotation with photos in just a few clicks.",
    icons: { icon: "/toy.svg" },
    // Kept out of search engines until there is a video to find.
    ...(video() ? {} : { robots: { index: false, follow: false } }),
  };
}

const demoHref = (lang: SiteLang) => (lang === "en" ? "/demo" : `/demo?lang=${lang}`);
const homeHref = (lang: SiteLang, q?: string) => {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (lang !== "en") p.set("lang", lang);
  const s = p.toString();
  return s ? `/welcome?${s}` : "/welcome";
};

export default async function DemoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const lang = parseLang((await searchParams).lang);
  const t = COPY[lang];
  const v = video();
  const words = v ? transcript(lang) : null;
  const email = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim();
  const mail = email ? `mailto:${email}` : "/privacy";

  return (
    <div className="toy-site" lang={HTML_LANG[lang]}>
      <header className="site-head">
        <Link className="site-brand" href={homeHref(lang)}>
          <span className="site-brand-name">aircraftmedia.my</span>
          <span className="site-brand-tag"> — {t.tagline}</span>
        </Link>
        <div className="site-head-end">
          <nav aria-label={t.languageLabel} className="site-langs">
            {LANGS.map((l) => (
              <Link key={l} href={demoHref(l)} lang={HTML_LANG[l]} aria-current={l === lang ? "true" : undefined}>
                {LANG_NAMES[l]}
              </Link>
            ))}
          </nav>
          <Link className="site-btn site-btn-ink" href="/login">{t.signIn}</Link>
        </div>
      </header>

      <main className="demo-page">
        <div className="demo-head">
          <Toy state={v ? "ready" : "greeting"} size={56} shadow />
          <div>
            <h1>{t.demo.title}</h1>
            <p>{t.demo.intro}</p>
          </div>
        </div>

        {v ? (
          <video className="demo-video" controls preload="metadata" playsInline poster={v.poster}>
            <source src={v.src} type="video/mp4" />
            {v.captions.map((c) => (
              // Captions on by default: the page's language, or English when that language has none yet.
              <track key={c.lang} kind="captions" src={`/demo/captions-${c.lang}.vtt`} srcLang={c.srclang} label={c.label}
                default={c.lang === lang || (c.lang === "en" && !v.captions.some((x) => x.lang === lang))} />
            ))}
          </video>
        ) : (
          <div className="demo-soon" role="status">
            <Toy scene size={180} state="ready" />
            <p className="demo-soon-title">{t.show.soon}</p>
            <p>{t.demo.soonNote}</p>
          </div>
        )}

        <section className="demo-pains" aria-labelledby="demo-pains-title">
          <h2 id="demo-pains-title">{t.demo.painTitle}</h2>
          <ul>
            {t.demo.pains.map((p) => <li key={p}>{p}</li>)}
          </ul>
          <p className="demo-claim">{t.demo.claim}</p>
        </section>

        <ol className="demo-steps" aria-label={t.show.caption}>
          {t.demo.steps.map((s, i) => (
            <li key={s}>
              <span className="demo-step-n" aria-hidden="true">{i + 1}</span>
              <b>{s}</b>
            </li>
          ))}
        </ol>

        {words && (
          <details className="demo-transcript">
            <summary>{t.demo.transcript}</summary>
            <p>{words}</p>
          </details>
        )}

        <div className="demo-actions">
          <Link className="site-btn site-btn-sage" href={homeHref(lang, "price")}>{t.cta}</Link>
          <Link className="demo-back" href={homeHref(lang)}>← {t.demo.back}</Link>
        </div>
      </main>

      <footer className="site-foot">
        <span>{t.footer.rights}</span>
        <Link href="/privacy">{t.footer.privacy}</Link>
        <Link href="/terms">{t.footer.terms}</Link>
        <a href={mail}>{t.footer.contact}</a>
      </footer>
    </div>
  );
}
