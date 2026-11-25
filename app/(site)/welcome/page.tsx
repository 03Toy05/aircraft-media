import Link from "next/link";
import type { Metadata } from "next";
import Toy from "../../_components/Toy";
import { COPY, HTML_LANG, LANGS, LANG_NAMES, QUESTIONS, parseLang, parseQuestion, type QuestionKey, type SiteLang } from "./copy";

// Preview path: kept out of search engines until the owner approves the launch (move to "/" and drop this line then).
export const metadata: Metadata = {
  title: "Aircraft Media — A little help for aviation",
  description: "Toy is the personal assistant for aviation charter brokers: aircraft photos, aircraft information and quotations in one place.",
  icons: { icon: "/toy.svg" },
  robots: { index: false, follow: false },
};

/** Where "Make Toy yours" and "Contact" go. Set NEXT_PUBLIC_CONTACT_EMAIL once the support address is confirmed; until then they open the privacy page, which says who to ask. */
function contactHref(): string {
  const email = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim();
  return email ? `mailto:${email}` : "/privacy";
}

/** One address per state: ?q= is the question, ?lang= the language. Plain links, so Back, deep links and no-JavaScript all work. */
function href(lang: SiteLang, q: QuestionKey | null): string {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (lang !== "en") p.set("lang", lang);
  const s = p.toString();
  return s ? `/welcome?${s}` : "/welcome";
}

export default async function WelcomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const lang = parseLang(sp.lang);
  const q = parseQuestion(sp.q);
  const t = COPY[lang];
  const mail = contactHref();

  return (
    <div className="toy-site" lang={HTML_LANG[lang]}>
      <header className="site-head">
        <Link className="site-brand" href={href(lang, null)}>
          <span className="site-brand-name">aircraftmedia.my</span>
          <span className="site-brand-tag"> — {t.tagline}</span>
        </Link>
        <div className="site-head-end">
          <nav aria-label={t.languageLabel} className="site-langs">
            {LANGS.map((l) => (
              <Link key={l} href={href(l, q)} lang={HTML_LANG[l]} aria-current={l === lang ? "true" : undefined}>
                {LANG_NAMES[l]}
              </Link>
            ))}
          </nav>
          <Link className="site-btn site-btn-ink" href="/login">{t.signIn}</Link>
        </div>
      </header>

      <main className="site-main">
        <div className="site-hero">
          <Link href={href(lang, null)} className="site-toy" aria-label={t.backToStart} scroll={false}>
            <Toy scene size={272} state={q === null ? "greeting" : "ready"} />
          </Link>
          <h1>{t.greeting}</h1>
          <p className="site-promise">{t.promise}</p>
        </div>

        <section className="site-answer" id="answer" aria-live="polite" aria-label={t.answerLabel} tabIndex={0}>
          {q === null && (
            <>
              <h2>{t.initial.title}</h2>
              <p>{t.initial.body}</p>
            </>
          )}
          {q === "what" && (
            <>
              <h2>{t.what.headline}</h2>
              <ul>{t.what.items.map((i) => <li key={i}>{i}</li>)}</ul>
              <p className="site-next">{t.what.next}</p>
            </>
          )}
          {q === "show" && (
            <>
              <h2>{t.show.headline}</h2>
              <div className="site-demo" role="img" aria-label={t.show.soon}>
                <span>{t.show.soon}</span>
              </div>
              <p className="site-next">{t.show.caption}</p>
            </>
          )}
          {q === "begins" && (
            <>
              <h2>{t.begins.headline}</h2>
              {t.begins.paragraphs.map((p) => <p key={p}>{p}</p>)}
              <p className="site-vision">{t.begins.vision}</p>
            </>
          )}
          {q === "price" && (
            <>
              <h2>{t.price.headline}</h2>
              <p>{t.price.body}</p>
              <p className="site-next">{t.price.soon}</p>
            </>
          )}
        </section>

        <nav className="site-questions" aria-label={t.questionsLabel}>
          {QUESTIONS.map((k) => (
            <Link key={k} href={href(lang, k)} scroll={false} aria-current={q === k ? "true" : undefined}>
              {t.questions[k]}
            </Link>
          ))}
        </nav>

        <a className="site-btn site-btn-sage" href={mail}>{t.cta}</a>
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
