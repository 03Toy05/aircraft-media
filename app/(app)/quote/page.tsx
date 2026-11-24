import { requireOwner } from "@/lib/session";
import { getDb } from "@/db/client";
import { getCatalogue, operatorAliasesByName } from "@/domain/catalogue";
import { and, eq } from "drizzle-orm";
import { organisations } from "@/db/schema";
import { getAircraftCard, getPreferredOperators } from "@/domain/directory";
import { getLineup } from "@/domain/media";
import { getQuoteTemplates } from "@/domain/quoteTemplates";
import { LIBRARY_TENANT_ID, copiedLibraryAircraft, libraryScope, scopeHasAircraft, scopeHasOperator } from "@/domain/library";
import { normalizeKey, normalizeRegistration } from "@/domain/constants";
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
  const scope = await libraryScope(db, session);
  if (scope) sources.push({ tenantId: LIBRARY_TENANT_ID, library: true });
  // The same aircraft once: a library aircraft the broker already has (added from the library, or their own with
  // the same operator, type and tail, or YOM when there is no tail) is left out of the library's list.
  const sameKey = (o: { operator: string | null; type: string; tail: string | null; yom: number | null }) =>
    `${normalizeKey(o.operator ?? "")}|${normalizeKey(o.type)}|${o.tail ? `t:${normalizeRegistration(o.tail)}` : `y:${o.yom ?? ""}`}`;
  const ownKeys = new Set<string>();
  const copied = await copiedLibraryAircraft(db, actor.tenantId);
  // An operator the broker has under the same name is one operator: library aircraft go under the broker's own.
  const ownOrgByName = new Map<string, QuoteOperator>();
  for (const src of sources) {
    const rows = await getCatalogue(db, src.tenantId);
    const mine: QuoteAircraftOption[] = [];
    for (const r of rows) {
      if (src.library && (copied.has(r.aircraftId) || !scopeHasOperator(scope, r.operatorId) || !scopeHasAircraft(scope, r.aircraftId))) continue;
      const card = await getAircraftCard(db, r.aircraftId);
      if (!card) continue;
      const k = sameKey({ operator: card.operator, type: card.aircraft, tail: card.tailNumber, yom: card.yom });
      if (!src.library) ownKeys.add(k);
      else if (ownKeys.has(k)) continue;
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
        notes: card.notes, // a library aircraft's notes are the admin's, from packs
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
    const orgRows = await db.select().from(organisations).where(and(eq(organisations.tenantId, src.tenantId), eq(organisations.active, true)));
    for (const o of orgRows) {
      const count = mine.filter((a) => a.operatorId === o.id).length;
      const own = src.library ? ownOrgByName.get(normalizeKey(o.canonicalName)) : undefined;
      if (own) {
        // Merged: its library aircraft are listed under the broker's operator, still marked Library.
        for (const a of mine) if (a.operatorId === o.id) a.operatorId = own.id;
        own.libraryCount = (own.libraryCount ?? 0) + count;
        if (count) own.alsoLibrary = true;
        continue;
      }
      const op: QuoteOperator = { id: o.id, name: o.canonicalName, region: o.region, addedAt: o.createdAt.toISOString(), count, library: src.library };
      if (!src.library) ownOrgByName.set(normalizeKey(o.canonicalName), op);
      operators.push(op);
    }
    options.push(...mine);
  }
  // Operators' other names ("VJ"), so typed commands like "add VJ 605" find them.
  const aliases = await operatorAliasesByName(db, sources.map((x) => x.tenantId));
  for (const o of options) if (o.operator) o.aliases = aliases.get(normalizeKey(o.operator));
  const preferred = await getPreferredOperators(db, actor.tenantId);
  const initial = (one(sp.ids) ?? "").split(",").filter((id) => options.some((o) => o.id === id));
  // From Toy: the prices it read ({"<aircraftId>": "USD 90,000"}) and the photo kinds asked for ("exterior,cabin" or "none").
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
      <p className="muted">Find the operator, tick the aircraft, then edit and send the message with the photos. <a href="/quote/template">Change the standard wording</a>.</p>
      <QuoteBuilder aircraft={options} operators={operators} preferred={preferred} initialIds={initial} initialPrices={initialPrices} initialKinds={initialKinds} templates={await getQuoteTemplates(db, actor.tenantId)} />
    </>
  );
}
