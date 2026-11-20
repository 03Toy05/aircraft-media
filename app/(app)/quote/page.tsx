import { requireOwner } from "@/lib/session";
import { getDb } from "@/db/client";
import { getCatalogue } from "@/domain/catalogue";
import { and, eq } from "drizzle-orm";
import { organisations } from "@/db/schema";
import { getAircraftCard, getPreferredOperators } from "@/domain/directory";
import { getLineup } from "@/domain/media";
import { getQuoteTemplates } from "@/domain/quoteTemplates";
import { LIBRARY_TENANT_ID, hasLibraryAccess } from "@/domain/library";
import { CLASSIFICATION_LABEL } from "@/domain/constants";
import QuoteBuilder, { type QuoteAircraftOption, type QuoteOperator } from "../../_components/QuoteBuilder";
import { one, type SP } from "../../_components/ui";

/** Build a quotation message for a client: pick aircraft, pick a language, edit the text, then copy or share it with the photos. */
export default async function Quote({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const session = await requireOwner();
  const { actor } = session;
  const db = await getDb();
  const options: QuoteAircraftOption[] = [];
  const operators: QuoteOperator[] = [];
  // The broker's own aircraft, then (when the library is shared with them) the platform library's.
  const sources = [{ tenantId: actor.tenantId, library: false }];
  if (await hasLibraryAccess(db, session)) sources.push({ tenantId: LIBRARY_TENANT_ID, library: true });
  for (const src of sources) {
    const rows = await getCatalogue(db, src.tenantId);
    const mine: QuoteAircraftOption[] = [];
    for (const r of rows) {
      const card = await getAircraftCard(db, r.aircraftId);
      if (!card) continue;
      const lineup = await getLineup(db, { aircraftId: r.aircraftId, aircraftTypeId: r.aircraftTypeId });
      mine.push({
        id: r.aircraftId,
        operatorId: r.operatorId,
        type: card.aircraft,
        tail: card.tailNumber,
        operator: card.operator,
        base: card.base,
        yom: card.yom,
        yor: card.yor,
        capacity: card.capacity,
        wifi: card.wifi,
        wifiDetail: card.wifiDetail,
        smoking: card.smoking,
        pets: card.pets,
        cleaningFee: card.cleaningFee,
        notes: src.library ? null : card.notes,
        photos: lineup.map((l) => ({
          classification: l.classification,
          classificationLabel: CLASSIFICATION_LABEL[l.classification],
          label: l.label,
          url: `/api/media/${l.contentVersionId}`,
          mimeType: l.mimeType,
          representative: l.associationStatus === "representative_type",
        })),
        library: src.library,
      });
    }
    options.push(...mine);
    const orgRows = await db.select().from(organisations).where(and(eq(organisations.tenantId, src.tenantId), eq(organisations.active, true)));
    operators.push(...orgRows.map((o) => ({
      id: o.id, name: o.canonicalName, region: o.region, addedAt: o.createdAt.toISOString(),
      count: mine.filter((a) => a.operatorId === o.id).length, library: src.library,
    })));
  }
  const preferred = await getPreferredOperators(db, actor.tenantId);
  const initial = (one(sp.ids) ?? "").split(",").filter((id) => options.some((o) => o.id === id));
  // From Chocks: the prices it read ({"<aircraftId>": "USD 90,000"}) and the photo kinds asked for ("exterior,cabin" or "none").
  let initialPrices: Record<string, string> = {};
  try {
    const p = JSON.parse(one(sp.prices) ?? "{}") as unknown;
    if (p && typeof p === "object") initialPrices = Object.fromEntries(Object.entries(p).filter(([id, v]) => initial.includes(id) && typeof v === "string").map(([id, v]) => [id, (v as string).slice(0, 80)]));
  } catch { /* ignore a broken link */ }
  const photosParam = one(sp.photos);
  const initialKinds = photosParam === undefined ? undefined : photosParam === "none" ? [] : photosParam.split(",").filter((k) => k in CLASSIFICATION_LABEL);
  return (
    <>
      <h1>Quote</h1>
      <p className="muted">Find the operator, tick the aircraft, then edit and send the message with the photos. Or tap the microphone and say it. <a href="/quote/template">Change the standard wording</a>.</p>
      <QuoteBuilder aircraft={options} operators={operators} preferred={preferred} initialIds={initial} initialPrices={initialPrices} initialKinds={initialKinds} templates={await getQuoteTemplates(db, actor.tenantId)} />
    </>
  );
}
