import { requireOwner } from "@/lib/session";
import { getDb } from "@/db/client";
import { getCatalogue } from "@/domain/catalogue";
import { and, eq } from "drizzle-orm";
import { organisations } from "@/db/schema";
import { getAircraftCard, getPreferredOperators } from "@/domain/directory";
import { getLineup } from "@/domain/media";
import { listContacts } from "@/domain/contacts";
import { getQuoteTemplates } from "@/domain/quoteTemplates";
import { CLASSIFICATION_LABEL } from "@/domain/constants";
import QuoteBuilder, { type QuoteAircraftOption, type QuoteOperator } from "../../_components/QuoteBuilder";
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
  const orgRows = await db.select().from(organisations).where(and(eq(organisations.tenantId, actor.tenantId), eq(organisations.active, true)));
  const operators: QuoteOperator[] = orgRows.map((o) => ({
    id: o.id, name: o.canonicalName, region: o.region, addedAt: o.createdAt.toISOString(),
    count: options.filter((a) => a.operatorId === o.id).length,
  }));
  const preferred = await getPreferredOperators(db, actor.tenantId);
  const initial = (one(sp.ids) ?? "").split(",").filter((id) => options.some((o) => o.id === id));
  return (
    <>
      <h1>Quote</h1>
      <p className="muted">Find the operator, tick the aircraft, then edit and send the message with the photos. Or tap the microphone and say it. <a href="/quote/template">Change the standard wording</a>.</p>
      <QuoteBuilder aircraft={options} operators={operators} preferred={preferred} contacts={contacts} initialIds={initial} templates={await getQuoteTemplates(db, actor.tenantId)} />
    </>
  );
}
