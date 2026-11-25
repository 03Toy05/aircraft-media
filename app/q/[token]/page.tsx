import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { noteOpened, openLink } from "@/domain/quoteLinks";
import { airportsFor } from "@/domain/airports";
import { airportPlace, legTimes, type Leg } from "@/domain/routing";
import { QUOTE_LANGUAGES, QUOTE_LOCALE, QUOTE_SUBJECT, QUOTE_WORDS, type QuoteLanguage } from "@/domain/quote";
import { pdfSupported } from "@/domain/quotePdf";
import { logoDataUrl, textOn } from "@/domain/branding";
import "./quote.css";

export const dynamic = "force-dynamic";

const langOf = (l: string): QuoteLanguage => ((QUOTE_LANGUAGES as readonly string[]).includes(l) ? (l as QuoteLanguage) : "en");

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const q = await openLink(await getDb(), (await params).token);
  return {
    title: q ? `${q.reference} · ${QUOTE_SUBJECT[langOf(q.quote.lang)]}` : "Quotation",
    robots: { index: false, follow: false },
    referrer: "no-referrer",
    // The broker's page, not Aircraft Media's: no Aircraft Media icon in the tab.
    icons: { icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E" },
  };
}

/**
 * What the client sees: the broker's quote for one request, latest version, in the quote's language. No sign-in;
 * only whoever has the link. Photos come through /q/<token>/photo/<id>, and only the photos of this quote.
 */
export default async function ClientQuote({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { token } = await params;
  const sp = await searchParams;
  const db = await getDb();
  const q = await openLink(db, token);
  if (!q) notFound();
  if (sp.preview !== "1") await noteOpened(db, q.link);

  const lang = langOf(q.quote.lang);
  const w = QUOTE_WORDS[lang];
  const locale = QUOTE_LOCALE[lang];
  const legs: Leg[] = q.quote.legs ?? [];
  const airports = airportsFor(legs.flatMap((l) => [l.from, l.to]));
  const inc = (q.quote.builder?.inc ?? {}) as Record<string, boolean>;
  const utc = q.quote.utc !== false;
  const date = (iso: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
  const photo = (id: string) => `/q/${token}/photo/${id}`;
  const fact = (label: string, value: string | number | null | undefined) => (value == null || value === "" ? null : <div className="cq-fact"><span>{label}</span><b>{value}</b></div>);

  return (
    <main className="cq" dir={lang === "ar" ? "rtl" : "ltr"} lang={lang} style={{ ["--cq-accent" as string]: q.brand.color, ["--cq-on-accent" as string]: textOn(q.brand.color) }}>
      <header className="cq-head">
        <div className="cq-from">
          {q.brand.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="cq-logo" src={logoDataUrl(q.brand)!} alt={q.broker.name} />
          ) : (
            <div className="cq-brand">{q.broker.name}</div>
          )}
          {q.broker.email && <a href={`mailto:${q.broker.email}`}>{q.broker.email}</a>}
        </div>
        <div className="cq-ref">
          <div className="cq-title">{QUOTE_SUBJECT[lang]}</div>
          <div>{q.reference} · v{q.version}</div>
          <div className="cq-muted">{new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(q.savedAt)}</div>
        </div>
      </header>

      {q.quote.greeting && <p className="cq-text">{q.quote.greeting}</p>}

      {legs.length > 0 && (
        <section className="cq-card">
          <h2>{w.routing}</h2>
          <div className="cq-legs">
            {legs.map((l, i) => {
              const t = legTimes(l, airports);
              return (
                <div key={i} className="cq-leg">
                  <div className="cq-route">{airportPlace(l.from, airports)} <span aria-hidden>→</span> {airportPlace(l.to, airports)}</div>
                  <div className="cq-leg-facts">
                    {l.date && <span>{date(l.date)}</span>}
                    {t.depLocal && <span>{w.dep} <b>{t.depLocal.time}</b> {w.lt}{utc && t.depUtc ? <em> ({t.depUtc.time} UTC)</em> : null}</span>}
                    {t.arrLocal && <span>{w.arr} <b>{t.arrLocal.time}</b> {w.lt}{t.arrDays ? ` (+${t.arrDays})` : ""}{utc && t.arrUtc ? <em> ({t.arrUtc.time} UTC)</em> : null}</span>}
                    {l.flight ? <span>{w.duration(Math.floor(l.flight / 60), l.flight % 60)}</span> : null}
                    {l.pax ? <span>{w.pax(l.pax)}</span> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {q.quote.options.map((o, i) => (
        <section key={i} className="cq-card cq-option">
          <div className="cq-option-head">
            <h2>{q.quote.options.length > 1 ? `${w.aircraft} ${i + 1}: ` : ""}{o.type}</h2>
            {o.price && <div className="cq-price">{o.price}</div>}
          </div>
          {o.photos.length > 0 && (
            <div className="cq-photos">
              {o.photos.map((p, j) => (
                <a key={p.id} href={photo(p.id)} target="_blank" rel="noopener" className={j === 0 ? "cq-photo-main" : "cq-photo"}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo(p.id)} alt={`${o.type} ${p.label}`} loading={j === 0 ? "eager" : "lazy"} />
                </a>
              ))}
            </div>
          )}
          <div className="cq-facts">
            {inc.operator && fact(w.operator, o.operator)}
            {inc.tail && fact(w.tail, o.tail)}
            {inc.base && fact(w.base, o.base)}
            {fact(w.yom, o.yom)}
            {fact(w.yor, o.yor)}
            {fact(w.capacity, o.capacity ? w.seats(o.capacity) : null)}
          </div>
          {o.extra && <p className="cq-text">{o.extra}</p>}
        </section>
      ))}

      {q.quote.closing && <p className="cq-text">{q.quote.closing}</p>}

      <footer className="cq-foot">
        {pdfSupported(lang) && <a className="cq-btn cq-btn-light" href={`/q/${token}/pdf`} target="_blank" rel="noopener">PDF</a>}
        {q.broker.email && <a className="cq-btn" href={`mailto:${q.broker.email}?subject=${encodeURIComponent(`${q.reference} · ${QUOTE_SUBJECT[lang]}`)}`}>{q.broker.name ? `${q.broker.name} · ` : ""}{q.broker.email}</a>}
      </footer>
    </main>
  );
}
