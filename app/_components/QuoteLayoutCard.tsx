import { getDb } from "@/db/client";
import { serverT } from "@/lib/uiLang";
import { getQuoteLayout } from "@/domain/quoteLayout";
import { removeQuoteLayoutAction, saveQuoteLayoutAction, setQuoteLayoutEnabledAction } from "../layoutActions";
import { PendingButton } from "./PendingButton";
import LocalTime from "./LocalTime";

/** Settings: the broker's own quote layout, read by Toy from a past quote (Word), used for quote PDFs. */
export default async function QuoteLayoutCard({ tenantId, open: forceOpen }: { tenantId: string; open?: boolean }) {
  const t = await serverT();
  const l = await getQuoteLayout(await getDb(), tenantId);
  const names: Record<string, string> = {
    reference: t("reference"), date: t("date"), greeting: t("greeting"), route: t("route"), pax: t("passengers"),
    routing: t("routing lines"), "routing table": t("routing table"), "options list": t("list of options"), number: t("option number"),
    aircraft: t("aircraft"), operator: t("operator"), tail: t("tail number"), base: t("base"), yom: t("year of manufacture"), yor: t("year of refurbishment"),
    seats: t("seats"), wifi: "Wi-Fi", smoking: t("smoking"), pets: t("pets"), price: t("price"),
  };
  const f = l?.found;
  const missing = f
    ? ([
        !f.fields.includes("aircraft") && !f.fields.includes("options list") && t("aircraft"),
        !f.fields.includes("price") && !f.fields.includes("options list") && t("price"),
        !f.fields.some((x) => x === "routing" || x === "routing table" || x === "route") && t("routing"),
      ].filter(Boolean) as string[])
    : [];
  return (
    <details className="card" id="layout" open={!!l || !!forceOpen}>
      <summary><b>{t("Your own quote layout")}</b>{l ? <span className="muted small"> · {l.enabled ? t("in use") : t("off")}</span> : null}</summary>
      <p className="muted">{t("Upload one of your past quotes as a Word file (.docx). Toy reads its layout (headings, wording, fonts, colours, tables) and finds where the aircraft, prices, routing and photos go. Your quote PDFs are then made in that layout, with each new quote's details. The client's name in the file is never reused, and the logo place is left blank.")}</p>
      {l && f && (
        <div className="card" style={{ background: "var(--tint, #f6f7f9)" }}>
          <p className="small" style={{ marginTop: 0 }}>{t("Read from")} <a href="/api/quote/layout-file">{l.fileName}</a> · <LocalTime iso={l.updatedAt.toISOString()} /></p>
          <p className="small">
            <b>{t("Toy found:")}</b> {f.fields.map((x) => names[x] ?? x).join(", ") || "–"}
            {f.photos ? ` · ${t("{n} photo places", { n: f.photos })}` : ""}
            {f.section ? ` · ${t("repeated for each aircraft")}` : ""}
            {f.clientBlanked ? ` · ${t("client name left blank")}` : ""}
            {f.logo ? ` · ${t("logo place left blank")}` : ""}
          </p>
          {missing.length > 0 && (
            <p className="small" style={{ color: "var(--warn)" }}>
              {t("Not found: {list}. Put a label before it in your Word file (for example “Price: USD 100,000”), or type a tag such as {tag}, and upload it again.", { list: missing.join(", "), tag: "{price}" })}
            </p>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <a className="btn secondary small-btn" href="/api/quote/layout-preview" target="_blank" rel="noopener">{t("See a sample PDF")}</a>
            <form action={setQuoteLayoutEnabledAction}>
              <input type="hidden" name="enabled" value={l.enabled ? "0" : "1"} />
              <button type="submit" className="secondary small-btn">{l.enabled ? t("Use the standard layout instead") : t("Use my layout for quote PDFs")}</button>
            </form>
            <form action={removeQuoteLayoutAction}><button type="submit" className="secondary small-btn">{t("Remove")}</button></form>
          </div>
        </div>
      )}
      <form action={saveQuoteLayoutAction}>
        <label>{l ? t("Upload a different quote") : t("Your past quote (.docx)")}</label>
        <input type="file" name="docx" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required />
        <PendingButton pending={t("Toy is reading it…")}>{t("Upload")}</PendingButton>
      </form>
      <details>
        <summary className="small">{t("How Toy reads it, and tags for exact places")}</summary>
        <ul className="small">
          <li>{t("Values after a label are replaced: Aircraft, Price, Seats, Year of manufacture, Refurbished, Wi-Fi, Smoking, Pets, Operator, Tail, Base, Quotation No., Date (in English or Chinese).")}</li>
          <li>{t("A table with From / To / Date / Departure columns becomes the routing, one row per leg. A table with one aircraft and its price per row becomes the list of options.")}</li>
          <li>{t("The part about the first aircraft is repeated for every aircraft; copies of it for other aircraft are dropped. Pictures in that part become the exterior, cabin and floor plan photos.")}</li>
          <li>{t("Everything else (terms, bank details, signature) stays exactly as written.")}</li>
          <li>
            {t("For an exact place, type a tag instead: {tags}.", { tags: "{aircraft} {price} {seats} {routing} {greeting} {photo_exterior} {photo_cabin}" })}{" "}
            <a href="/api/quote/word-sample">{t("Download a sample with tags")}</a>
          </li>
        </ul>
      </details>
    </details>
  );
}
