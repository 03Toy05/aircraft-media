import { randomUUID } from "node:crypto";
import Link from "next/link";
import { requireOwner } from "@/lib/session";
import { getDb } from "@/db/client";
import { getQuoteTemplates } from "@/domain/quoteTemplates";
import { QUOTE_LANGUAGES, QUOTE_WORDS, defaultQuoteTemplate, type QuoteLanguage } from "@/domain/quote";
import QuoteTemplateEditor from "../../../_components/QuoteTemplateEditor";
import { Flash, one, type SP } from "../../../_components/ui";

/** The owner's own wording for the quotation message, per language. */
export default async function QuoteTemplatePage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { actor } = await requireOwner();
  const db = await getDb();
  const saved = await getQuoteTemplates(db, actor.tenantId);
  const lang = (QUOTE_LANGUAGES as readonly string[]).includes(one(sp.lang) ?? "") ? (one(sp.lang) as QuoteLanguage) : "en";
  const defaults = defaultQuoteTemplate(lang);
  return (
    <>
      <p className="small"><Link href="/quote">← Quote</Link></p>
      <h1>Quote wording</h1>
      <p className="muted">
        Set how your quotation message looks, once per language. Every quote starts from this wording and fills in the aircraft you choose.
        You can still edit any single message before you send it, without changing what is saved here.
      </p>
      <Flash error={one(sp.error)} ok={one(sp.ok)} />
      <div className="row" style={{ marginBottom: 12 }}>
        {QUOTE_LANGUAGES.map((l) => (
          <div key={l} style={{ flex: "0 0 auto" }}>
            <Link className={l === lang ? "btn" : "btn secondary"} style={l === lang ? undefined : { background: "transparent", color: "var(--accent)" }} href={`/quote/template?lang=${l}`}>
              {QUOTE_WORDS[l].name}{saved[l] ? " ●" : ""}
            </Link>
          </div>
        ))}
      </div>
      <p className="small muted">● = you have changed the wording for that language.</p>
      <QuoteTemplateEditor key={lang} submitKey={randomUUID()} language={lang} defaults={defaults} saved={saved[lang] ?? null} />
    </>
  );
}
