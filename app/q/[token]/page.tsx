import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { noteOpened, openLink } from "@/domain/quoteLinks";
import { airportsFor } from "@/domain/airports";
import { airportPlace, legTimes, type Leg } from "@/domain/routing";
import { OWNER_APPROVAL, PROPOSAL_TITLE, QUOTE_LANGUAGES, QUOTE_LOCALE, QUOTE_SUBJECT, QUOTE_WORDS, type QuoteLanguage } from "@/domain/quote";
import { needsOwnerApproval } from "@/domain/requests";
import { formatVersion, versionFileName } from "@/domain/branding";
import { pdfSupported, photoSlots } from "@/domain/quotePdf";
import { logoDataUrl, textOn } from "@/domain/branding";
import "./quote.css";

export const dynamic = "force-dynamic";

const langOf = (l: string): QuoteLanguage => ((QUOTE_LANGUAGES as readonly string[]).includes(l) ? (l as QuoteLanguage) : "en");

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const q = await openLink(await getDb(), (await params).token);
  return {
    title: q ? `${PROPOSAL_TITLE[langOf(q.quote.lang)]} · ${formatVersion(q.brand.versionFormat, q.reference, q.version)}` : "Quotation",
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
  const yesNo = (v: string | undefined) => (v === "yes" ? w.wifiYes : v === "no" ? w.wifiNo : v === "tbc" ? w.wifiTbc : "–");
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
          <div className="cq-title">{PROPOSAL_TITLE[lang]}</div>
          <div>{formatVersion(q.brand.versionFormat, q.reference, q.version)}</div>
          {q.quote.label && <div className="cq-muted">{q.quote.label}</div>}
          <div className="cq-muted">{new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(q.savedAt)}</div>
        </div>
      </header>

      {q.quote.greeting && <p className="cq-text cq-lead">{q.quote.greeting}</p>}

      {legs.length > 0 && (
        <section className="cq-card">
          <h2>{w.routing}</h2>
          <div className="cq-table-wrap">
            <table className="cq-table">
              <thead><tr><th>{w.date}</th><th>{w.from}</th><th>{w.to}</th><th>{w.dep}</th><th>{w.arr}</th><th>{w.flightTime}</th><th className="cq-num">{((s) => s.charAt(0).toUpperCase() + s.slice(1))(w.pax(0).replace(/^0\s*/, "") || "Pax")}</th></tr></thead>
              <tbody>
                {legs.map((l, i) => {
                  const t = legTimes(l, airports);
                  return (
                    <tr key={i}>
                      <td>{l.date ? date(l.date) : "–"}</td>
                      <td>{airportPlace(l.from, airports)}</td>
                      <td>{airportPlace(l.to, airports)}</td>
                      <td>{t.depLocal ? <>{t.depLocal.time} {w.lt}{utc && t.depUtc ? <small>{t.depUtc.time} UTC</small> : null}</> : "–"}</td>
                      <td>{t.arrLocal ? <>{t.arrLocal.time} {w.lt}{t.arrDays ? ` +${t.arrDays}` : ""}{utc && t.arrUtc ? <small>{t.arrUtc.time} UTC</small> : null}</> : "–"}</td>
                      <td>{l.flight ? w.duration(Math.floor(l.flight / 60), l.flight % 60) : "–"}</td>
                      <td className="cq-num">{l.pax ?? "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="cq-card">
        <h2>{w.options}</h2>
        <div className="cq-table-wrap">
          <table className="cq-table">
            <thead><tr><th></th><th>{w.aircraft}</th><th>{w.capacity}</th><th>YOM / YOR</th><th>{w.wifi}</th><th>{w.smoking}</th><th>{w.pets}</th><th className="cq-num">{w.price}</th></tr></thead>
            <tbody>
              {q.quote.options.map((o, i) => (
                <tr key={i}>
                  <td><a href={`#option-${i + 1}`}>{i + 1}</a></td>
                  <td><a href={`#option-${i + 1}`}>{o.type}</a>{needsOwnerApproval(o.notes) && <span className="cq-sticker">{OWNER_APPROVAL[lang]}</span>}{o.extra ? <small>{o.extra}</small> : null}</td>
                  <td>{o.capacity ?? "–"}</td>
                  <td>{[o.yom, o.yor].filter(Boolean).join(" / ") || "–"}</td>
                  <td>{yesNo(o.wifi)}</td>
                  <td>{yesNo(o.smoking)}</td>
                  <td>{yesNo(o.pets)}</td>
                  <td className="cq-num cq-price-cell">{o.price || "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {q.quote.options.map((o, i) => {
        const slots = photoSlots(o.photos);
        const img = (p: { id: string; label: string }, cls: string) => (
          <a key={p.id} href={photo(p.id)} target="_blank" rel="noopener" className={cls}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo(p.id)} alt={`${o.type} ${p.label}`} loading={i === 0 && cls === "cq-slot-ext" ? "eager" : "lazy"} />
          </a>
        );
        return (
          <section key={i} id={`option-${i + 1}`} className="cq-card cq-option">
            <div className="cq-band">
              <div><small>{w.option} {i + 1}</small><h2>{o.type}</h2></div>
              {o.price && <div className="cq-price">{o.price}</div>}
            </div>
            {needsOwnerApproval(o.notes) && <div className="cq-sticker cq-sticker-big">{OWNER_APPROVAL[lang]}</div>}
            <div className="cq-facts">
              {inc.operator && fact(w.operator, o.operator)}
              {inc.tail && fact(w.tail, o.tail)}
              {inc.base && fact(w.base, o.base)}
              {fact(w.yom, o.yom)}
              {fact(w.yor, o.yor)}
              {fact(w.capacity, o.capacity ? w.seats(o.capacity) : null)}
            </div>
            <div className="cq-slots">
              {slots.exterior && img(slots.exterior, "cq-slot-ext")}
              {slots.cabins.map((p) => img(p, "cq-slot-cabin"))}
              {slots.floorPlan && img(slots.floorPlan, "cq-slot-plan")}
            </div>
            {o.extra && <p className="cq-text">{o.extra}</p>}
          </section>
        );
      })}

      {q.quote.closing && <p className="cq-text cq-lead">{q.quote.closing}</p>}

      <footer className="cq-foot">
        {pdfSupported(lang) && <a className="cq-btn cq-btn-light" href={`/q/${token}/pdf`} target="_blank" rel="noopener">PDF</a>}
        {q.broker.email && <a className="cq-btn" href={`mailto:${q.broker.email}?subject=${encodeURIComponent(`${q.reference} · ${QUOTE_SUBJECT[lang]}`)}`}>{q.broker.name ? `${q.broker.name} · ` : ""}{q.broker.email}</a>}
      </footer>
    </main>
  );
}
