import Link from "next/link";
import type { Metadata } from "next";
import Toy from "../../_components/Toy";
import BrandSignature from "../../_components/BrandSignature";
import LanguageMenu from "../LanguageMenu";
import PhoneDemo from "../PhoneDemo";
import FounderClip from "../FounderClip";
import { SiteTracker } from "../track";
import { LetMeTry, TimeCalculator, WatchDemoButton } from "../HomeWidgets";
import { demoTranscript, demoVideo, shortDemoVideo, letMeTryLive, trySample, founderPhoto, founderVideo } from "../siteMedia";
import { COPY, HTML_LANG, QUESTIONS, parseLang, parseQuestion, type QuestionKey, type SiteLang } from "./copy";

// The front page: shown at "/" to visitors who are not signed in (see proxy.ts), and at /welcome.
export const metadata: Metadata = {
  title: "Aircraft Media — A little help for aviation",
  description: "Toy prepares a text, weblink or PDF quotation with aircraft photos in just a few clicks: the assistant for aviation charter brokers.",
  icons: { icon: "/toy.svg" },
  alternates: { canonical: process.env.APP_URL ? new URL("/", process.env.APP_URL).toString() : "/" },
};

/** Where "Contact" goes. Set NEXT_PUBLIC_CONTACT_EMAIL once the support address is confirmed; until then they open the privacy page, which says who to ask. */
function contactHref(): string {
  const email = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim();
  return email ? `mailto:${email}` : "/privacy";
}

/** One address per state: ?q= is the question, ?lang= the language. Plain links, so Back, deep links and no-JavaScript all work. */
function href(lang: SiteLang, q: QuestionKey | null, hash = ""): string {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (lang !== "en") p.set("lang", lang);
  const s = p.toString();
  return (s ? `/welcome?${s}` : "/welcome") + hash;
}

export default async function WelcomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const lang = parseLang(sp.lang);
  const q = parseQuestion(sp.q);
  const t = COPY[lang];
  const mail = contactHref();
  const video = demoVideo(lang);
  const shortFilm = video ? shortDemoVideo(lang) : null;
  const words = video ? demoTranscript(lang) : null;
  const founder = founderPhoto();
  const founderFilm = founderVideo();
  const tryOn = letMeTryLive();
  const sample = tryOn ? trySample(lang) : null;

  return (
    <div className="toy-site" lang={HTML_LANG[lang]}>
      <SiteTracker lang={lang} pricing={q === "price"} />
      <header className="site-head">
        <Link className="site-brand" href={href(lang, null)}>
          <span className="site-brand-name">aircraftmedia.my</span>
          <span className="site-brand-tag"> — {t.tagline}</span>
        </Link>
        <div className="site-head-end">
          <LanguageMenu lang={lang} label={t.languageLabel} hrefFor={(l) => href(l, q)} />
          <Link className="site-btn site-btn-ink" href="/login">{t.signIn}</Link>
        </div>
      </header>

      <main className="home">
        <div className="site-hero">
          <Link href={href(lang, null)} className="site-toy" aria-label={t.backToStart} scroll={false}>
            <Toy scene size={272} state={q === null ? "greeting" : "ready"} />
          </Link>
          {/* "Hi, I'm Toy." with the airplane as its full stop (TOY-14); still, no takeoff. */}
          <BrandSignature as="h1" lead={t.greeting.lead} tail="Toy" plain={t.greeting.plain} />
          <p className="site-promise">{t.promise}</p>
          <p className="hero-does">{t.hero.does}</p>
          <p className="hero-benefit">{t.hero.benefit}</p>
          {video && <WatchDemoButton label={t.hero.watch} sub={t.hero.watchSub} />}
          <p className="hero-built">{t.hero.builtBy}</p>
        </div>

        <section className="home-stage" id="film" aria-label={t.demo.intro}>
          <p className="home-film-intro">{t.demo.intro}</p>
          <div className="stage-row">
            {/* The phone: Toy's notes on its screen until the demo plays (keyed by question, so a new question stops the film). */}
            <PhoneDemo key={q ?? "start"} video={video} short={shortFilm} lang={lang}
              hidePlay={q === "begins" && !!founderFilm}
              labels={{ watch: t.demo.watch, close: t.demo.close, soon: t.demo.soon, screen: t.demo.screen, draft: t.demo.draft, again: t.demo.again, start: t.cta }}
              startHref={lang === "en" ? "/start" : `/start?lang=${lang}`}
              draftHref={lang === "en" ? "/start" : `/start?lang=${lang}`}>
              <div aria-live="polite">
                {q === null && (
                  <>
                    <h2>{t.demo.painTitle}</h2>
                    <ul className="phone-bubbles">
                      {t.demo.pains.map((p) => <li key={p}>{p}</li>)}
                    </ul>
                    <p className="demo-claim">{t.demo.claim}</p>
                    <h2>{t.initial.title}</h2>
                    <p>{t.initial.body}</p>
                    <Link className="phone-next" href={href(lang, "what", "#film")} scroll={false}>{t.next.start} →</Link>
                  </>
                )}
                {q === "what" && (
                  <>
                    <h2>{t.what.headline}</h2>
                    <ul>{t.what.items.map((i) => <li key={i}>{i}</li>)}</ul>
                    <p className="site-next">{t.what.next}</p>
                    <Link className="phone-next" href={href(lang, "try", "#film")} scroll={false}>{t.next.what} →</Link>
                  </>
                )}
                {q === "try" && (
                  <>
                    {/* Live: "coming soon" until the owner releases it; the local preview (SHOW_LET_ME_TRY=1) shows it working. */}
                    {tryOn ? <LetMeTry copy={t.tryIt} lang={lang} sample={sample} /> : (
                      <>
                        <h2>{t.tryIt.headline}</h2>
                        <p className="site-next">{t.tryIt.soon}</p>
                      </>
                    )}
                    <Link className="phone-next" href={href(lang, "price", "#film")} scroll={false}>{t.next.tryIt} →</Link>
                  </>
                )}
                {q === "begins" && (
                  <>
                    <BrandSignature key={lang} lead={t.begins.lead} tail={t.begins.tail} plain={t.begins.plain} takeoff />
                    {founderFilm ? (
                      <FounderClip video={founderFilm} lang={lang} label={t.begins.founderVideo} cta={t.begins.founderCta} hasDemo={!!video} />
                    ) : founder && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="home-founder" src={founder} alt="" width={72} height={72} />
                    )}
                    {t.begins.paragraphs.map((p) => <p key={p}>{p}</p>)}
                    <p className="site-vision">{t.begins.vision}</p>
                    <Link className="phone-next" href={href(lang, "try", "#film")} scroll={false}>{t.next.begins} →</Link>
                  </>
                )}
                {q === "price" && (
                  <>
                    <h2>{t.price.headline}</h2>
                    <p>{t.price.body}</p>
                    <p className="site-next">{t.price.soon}</p>
                    <TimeCalculator copy={t.calc} />
                    <Link className="phone-next is-cta" href={lang === "en" ? "/start" : `/start?lang=${lang}`}>{t.cta} →</Link>
                  </>
                )}
              </div>
            </PhoneDemo>

            <aside className="stage-side">
              <nav className="stage-questions" aria-label={t.questionsLabel}>
                {QUESTIONS.map((k, i) => (
                  <Link key={k} href={href(lang, k, "#film")} scroll={false} aria-current={q === k ? "true" : undefined}>
                    <span className="home-q-n" aria-hidden="true">{i + 1}</span>{t.questions[k]}
                  </Link>
                ))}
              </nav>
              {/* "Make Toy yours" starts the 14-day free trial (/start). */}
              <Link className="site-btn site-btn-sage home-cta" href={lang === "en" ? "/start" : `/start?lang=${lang}`}>{t.cta}</Link>
            </aside>
          </div>
          {words && (
            <details className="demo-transcript">
              <summary>{t.demo.transcript}</summary>
              <p>{words}</p>
            </details>
          )}
        </section>

        {/* "Before you ask": the usual hesitations, answered plainly (fact-checked; no promises about price). */}
        <section className="home-faq" aria-labelledby="faq-title">
          <h2 id="faq-title">{t.faq.title}</h2>
          {t.faq.items.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </section>
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
