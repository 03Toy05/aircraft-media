import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/session";
import { getDb } from "@/db/client";
import { getRequest, listVersions } from "@/domain/requests";
import { airportsFor } from "@/domain/airports";
import { requestLabel, routingLines } from "@/domain/routing";
import { QUOTE_WORDS } from "@/domain/quote";
import { archiveRequestAction, clientLinkSettingsAction } from "../../../requestActions";
import { linkFor } from "@/domain/quoteLinks";
import { pdfSupported } from "@/domain/quotePdf";
import { siteAddress } from "@/lib/site";
import { serverT } from "@/lib/uiLang";
import ClientLinkButtons from "../../../_components/ClientLinkButtons";
import { Flash, one, type SP } from "../../../_components/ui";
import LocalTime from "../../../_components/LocalTime";

/** One request: its routing, and every quote saved for it (open one to change it and save the next version). */
export default async function RequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  const { actor } = await requireOwner();
  const t = await serverT();
  const db = await getDb();
  const r = await getRequest(db, actor.tenantId, id);
  if (!r) notFound();
  const versions = await listVersions(db, actor.tenantId, id);
  const airports = airportsFor(r.legs.flatMap((l) => [l.from, l.to]));
  const link = await linkFor(db, actor.tenantId, id);
  const site = await siteAddress();
  const linkUrl = link && site ? `${site}/q/${link.token}` : null;
  const expired = !!link?.expiresAt && link.expiresAt <= new Date();
  return (
    <>
      <p className="small"><Link href="/requests">← {t("Requests")}</Link></p>
      <h1 style={{ marginBottom: 2 }}>{r.reference}</h1>
      <p className="muted" style={{ marginTop: 0 }}>{requestLabel(r.legs, airports)}{r.archived ? ` · ${t("archived")}` : ""}</p>
      <Flash error={one(sp.error)} ok={one(sp.ok)} />

      <div className="card">
        <pre className="cardtext" style={{ margin: "0 0 8px" }}>{routingLines(r.legs, airports, QUOTE_WORDS.en, "en-GB")}</pre>
        {r.notes && <p className="small muted" style={{ margin: "0 0 8px" }}>{t("Notes:")} {r.notes}</p>}
        <div className="row" style={{ gap: 6 }}>
          <div style={{ flex: "0 0 auto" }}><Link className="btn" href={`/quote?request=${r.id}${versions.length ? `&version=${versions[0].version}` : ""}`}>{versions.length ? t("Edit the latest quote (v{n})", { n: versions[0].version }) : t("Build the quote →")}</Link></div>
        </div>
        <p className="small muted" style={{ margin: "8px 0 0" }}>
          {t("Every version keeps its own routing: legs, times and passengers can change from one version to the next. This shows the latest.")}
        </p>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("Client link")}</h3>
        {!link ? (
          <>
            <p className="small muted" style={{ marginTop: 0 }}>{t("A private page for the client with this request's latest quote: routing, aircraft, prices and photos. A new version reaches them through the same link.")}</p>
            <form action={clientLinkSettingsAction}>
              <input type="hidden" name="requestId" value={r.id} /><input type="hidden" name="op" value="create" />
              <button type="submit" disabled={!versions.length}>{t("Make the client link")}</button>
              {!versions.length && <span className="small muted"> {t("Save a quote first.")}</span>}
            </form>
          </>
        ) : (
          <>
            <p className="small" style={{ marginTop: 0 }}>
              {!link.active ? <b>{t("Switched off: it doesn't open.")}</b> : expired ? <b>{t("Expired: it doesn't open.")}</b> : <>{t("Shows version {n} (always the latest).", { n: versions[0]?.version ?? "–" })}</>}
              {" "}{link.firstViewedAt ? <>{t("First opened")} <LocalTime iso={link.firstViewedAt.toISOString()} />{link.lastViewedAt && link.lastViewedAt.getTime() !== link.firstViewedAt.getTime() ? <>{t(", last")} <LocalTime iso={link.lastViewedAt.toISOString()} /></> : null}{t(".")}</> : <span className="muted">{t("Not opened yet.")}</span>}
            </p>
            {linkUrl && <input readOnly value={linkUrl} aria-label={t("Client link")} className="small" style={{ width: "100%", marginBottom: 8 }} />}
            {linkUrl && link.active && <ClientLinkButtons requestId={r.id} url={linkUrl} />}
            <details style={{ marginTop: 10 }}>
              <summary className="small">{t("End date, switch off, new link")}</summary>
              <form action={clientLinkSettingsAction} className="row" style={{ alignItems: "end", marginTop: 8 }}>
                <input type="hidden" name="requestId" value={r.id} /><input type="hidden" name="op" value="expiry" />
                <div style={{ maxWidth: 220 }}><label className="small">{t("Stops working after")}</label><input type="date" name="expires" defaultValue={link.expiresAt ? link.expiresAt.toISOString().slice(0, 10) : ""} /></div>
                <div style={{ flex: "0 0 auto" }}><button type="submit" className="secondary">{t("Save end date")}</button></div>
              </form>
              <div className="row" style={{ gap: 6, marginTop: 8 }}>
                <form action={clientLinkSettingsAction} style={{ flex: "0 0 auto" }}>
                  <input type="hidden" name="requestId" value={r.id} /><input type="hidden" name="op" value={link.active ? "off" : "on"} />
                  <button type="submit" className="secondary">{link.active ? t("Switch the link off") : t("Switch it on again")}</button>
                </form>
                <form action={clientLinkSettingsAction} style={{ flex: "0 0 auto" }}>
                  <input type="hidden" name="requestId" value={r.id} /><input type="hidden" name="op" value="replace" />
                  <button type="submit" className="secondary">{t("Make a new link (the old one stops)")}</button>
                </form>
              </div>
            </details>
          </>
        )}
      </div>

      <h3>{t("Saved quotes")}</h3>
      {versions.length === 0 && <div className="card muted">{t("No quote saved yet.")}</div>}
      {versions.map((v) => (
        <div key={v.id} className="card">
          <div className="people-head">
            <span><b>{t("Version {n}", { n: v.version })}</b>{v.content.label ? <> · <b>{v.content.label}</b></> : null} <span className="muted small">· {t("saved")} <LocalTime iso={v.createdAt.toISOString()} /></span></span>
            <span style={{ display: "flex", gap: 6 }}>
              {pdfSupported(v.content.lang)
                ? <a className="btn secondary small-btn" href={`/api/requests/${r.id}/pdf?version=${v.version}`} target="_blank" rel="noopener">PDF</a>
                : <span className="small muted" title={t("Simplified Chinese, Korean, Thai and Arabic: send the client link")}>{t("No PDF in this language yet")}</span>}
              <Link className="btn secondary small-btn" href={`/quote?request=${r.id}&version=${v.version}`}>{t("Open and edit")}</Link>
            </span>
          </div>
          <ul className="small" style={{ margin: "6px 0" }}>
            {v.content.options.map((o, i) => (
              <li key={i}>{o.type}{o.operator ? ` · ${o.operator}` : ""}{o.tail ? ` · ${o.tail}` : ""}{o.price ? ` — ${o.price}` : ""} <span className="muted">({o.photos.length === 1 ? t("{n} photo", { n: 1 }) : t("{n} photos", { n: o.photos.length })})</span></li>
            ))}
          </ul>
          <details><summary className="small">{t("The message")}</summary><pre className="cardtext">{v.content.text}</pre></details>
        </div>
      ))}

      <form action={archiveRequestAction} style={{ marginTop: 16 }}>
        <input type="hidden" name="requestId" value={r.id} />
        <input type="hidden" name="archived" value={r.archived ? "0" : "1"} />
        <button type="submit" className="secondary">{r.archived ? t("Move back to open requests") : t("Archive this request")}</button>
      </form>
    </>
  );
}
