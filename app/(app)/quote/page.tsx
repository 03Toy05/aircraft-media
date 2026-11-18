import { requireOwner } from "@/lib/session";
import { getDb } from "@/db/client";
import { getCatalogue } from "@/domain/catalogue";
import { getAircraftCard } from "@/domain/directory";
import { getLineup } from "@/domain/media";
import { listContacts } from "@/domain/contacts";
import { getQuoteTemplates } from "@/domain/quoteTemplates";
import { CLASSIFICATION_LABEL } from "@/domain/constants";
import QuoteBuilder, { type QuoteAircraftOption } from "../../_components/QuoteBuilder";
import { one, type SP } from "../../_components/ui";

/** Build a quotation message for a client: pick aircraft, pick a language, edit the text, then copy or share it with the photos. */
export default async function Quote({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { actor } = await requireOwner();
  const db = await getDb();
  const rows = await getCatalogue(db, actor.tenantId);
  const options: QuoteAircraftOption[] = [];
  for (const r of rows) {
    const card = await getAircraftCard(db, r.aircraftId);
    if (!card) continue;
    const lineup = await getLineup(db, { aircraftId: r.aircraftId, aircraftTypeId: r.aircraftTypeId });
    options.push({
      id: r.aircraftId,
      type: card.aircraft,
      tail: card.tailNumber,
      operator: card.operator,
      base: card.base,
      yom: card.yom,
      yor: card.yor,
      capacity: card.capacity,
      wifi: card.wifi,
      wifiDetail: card.wifiDetail,
      notes: card.notes,
      photos: lineup.map((l) => ({
        classification: l.classification,
        classificationLabel: CLASSIFICATION_LABEL[l.classification],
        label: l.label,
        url: `/api/media/${l.contentVersionId}`,
        mimeType: l.mimeType,
        representative: l.associationStatus === "representative_type",
      })),
    });
  }
  const contacts = (await listContacts(db, actor.tenantId)).map((c) => ({ id: c.id, name: c.name, app: c.app, handle: c.handle }));
  const initial = (one(sp.ids) ?? "").split(",").filter((id) => options.some((o) => o.id === id));
  return (
    <>
      <h1>Quote</h1>
      <p className="muted">Pick the aircraft, choose a language, edit the message, then copy it or share it with the photos. <a href="/quote/template">Change the standard wording</a>.</p>
      <QuoteBuilder aircraft={options} contacts={contacts} initialIds={initial} templates={await getQuoteTemplates(db, actor.tenantId)} />
    </>
  );
}
