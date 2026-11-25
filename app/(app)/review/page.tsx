import Link from "next/link";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { aircraftMedia, aircraftTypes, organisations } from "@/db/schema";
import { requireOwner } from "@/lib/session";
import { AIRCRAFT_CATEGORIES, AIRCRAFT_CATEGORY_LABEL, CLASSIFICATION_LABEL } from "@/domain/constants";
import { listWaitingGroups } from "@/domain/media";
import { getCatalogue } from "@/domain/catalogue";
import { assignDefaults } from "@/domain/reviewDefaults";
import { Flash, one, type SP } from "../../_components/ui";
import ReviewSheet, { type SheetGroup } from "../../_components/ReviewSheet";
import { serverT } from "@/lib/uiLang";

/** Sets shown at once; the rest follow as these are saved. */
const PAGE = 12;
const num = (v: number | null | undefined) => (v == null ? "" : String(v));

export default async function ReviewQueue({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const t = await serverT();
  const { actor, readOnly } = await requireOwner();
  const db = await getDb();
  const allGroups = await listWaitingGroups(db, actor.tenantId);
  const groups = allGroups.slice(0, PAGE);
  const catalogue = await getCatalogue(db, actor.tenantId);
  const orgs = await db.select().from(organisations).where(and(eq(organisations.tenantId, actor.tenantId), eq(organisations.active, true))).orderBy(asc(organisations.canonicalName));
  const types = await db.select().from(aircraftTypes).where(and(eq(aircraftTypes.tenantId, actor.tenantId), eq(aircraftTypes.active, true))).orderBy(asc(aircraftTypes.model));
  const typeLabel = new Map(types.map((ty) => [ty.id, `${ty.manufacturer} ${ty.model}`]));
  const typeGroups = [...AIRCRAFT_CATEGORIES, "none" as const]
    .map((k) => ({
      key: k,
      label: k === "none" ? t("No category") : t(AIRCRAFT_CATEGORY_LABEL[k]),
      items: types
        .filter((ty) => (k === "none" ? !ty.category || !(AIRCRAFT_CATEGORIES as readonly string[]).includes(ty.category) : ty.category === k))
        .map((ty) => ({ id: ty.id, label: `${ty.manufacturer} ${ty.model}` })),
    }))
    .filter((g) => g.items.length > 0);

  const sheet: SheetGroup[] = [];
  for (const g of groups) {
    const d = await assignDefaults(db, actor.tenantId, { cardText: g.evidenceText, catalogue, associatedAircraftId: g.associatedAircraftId });
    const p = d.parsed;
    sheet.push({
      key: g.key,
      receivedAt: g.photos[0].receivedAt.toISOString().slice(0, 16).replace("T", " "),
      label: g.label,
      photos: g.photos.map((x) => ({ mediaId: x.mediaId, src: x.contentVersionId ? `/api/media/${x.contentVersionId}` : null, filename: x.filename, classification: x.classification, autoReason: x.autoReason })),
      cardText: g.evidenceText,
      notes: d.notes,
      defaults: {
        operator: d.operator, newOperatorName: d.newOperatorName, aircraft: d.aircraft, type: d.type,
        tail: p?.tail ?? "", yom: num(p?.yom), yor: num(p?.yor), capacity: num(p?.capacity), wifi: p?.wifi ?? "unknown", wifiDetail: p?.wifiDetail ?? "", smoking: p?.smoking ?? "unknown", pets: p?.pets ?? "unknown", notes: p?.notes ?? "",
        baseMode: p?.base?.mode ?? "", baseLocations: p?.base?.locations.join(", ") ?? "",
      },
    });
  }

  const others = await db
    .select()
    .from(aircraftMedia)
    .where(and(eq(aircraftMedia.tenantId, actor.tenantId), inArray(aircraftMedia.reviewState, ["rejected", "failed", "partially_processed", "processing"])))
    .orderBy(desc(aircraftMedia.createdAt));
  const waitingPhotos = allGroups.reduce((n, g) => n + g.photos.length, 0);

  return (
    <>
      <h1>{t("Review")}</h1>
      <Flash error={one(sp.error)} ok={one(sp.ok)} />
      {allGroups.length === 0 ? (
        <div className="card muted">{t("Nothing waiting for review.")} <Link href="/intake">{t("Upload photos")}</Link></div>
      ) : (
        <>
          <p className="muted small">
            {allGroups.length === 1
              ? t("{text}, in {n} set sent together.", { n: 1, text: waitingPhotos === 1 ? t("{n} photo waiting", { n: 1 }) : t("{n} photos waiting", { n: waitingPhotos }) })
              : t("{text}, in {n} sets sent together.", { n: allGroups.length, text: waitingPhotos === 1 ? t("{n} photo waiting", { n: 1 }) : t("{n} photos waiting", { n: waitingPhotos }) })}
            {" "}{t("Fill in each set and press its Save button; you stay on this page.")}
            {allGroups.length > PAGE ? ` ${t("Showing the newest {n}; the rest appear as you save.", { n: PAGE })}` : ""}
          </p>
          <ReviewSheet
            groups={sheet}
            readOnly={readOnly}
            operators={orgs.map((o) => ({ id: o.id, name: o.canonicalName }))}
            aircraft={catalogue.map((r) => ({ id: r.aircraftId, label: `${r.tail ?? t("no tail yet")} —${r.aircraft}${r.operator ? ` — ${r.operator}` : ""}`, aircraftTypeId: r.aircraftTypeId, typeLabel: typeLabel.get(r.aircraftTypeId) ?? r.aircraft, operatorId: r.operatorId }))}
            typeGroups={typeGroups}
          />
        </>
      )}
      {others.length > 0 && (
        <details className="card collapse">
          <summary>{t("Rejected or not processed ({n})", { n: others.length })}</summary>
          <div className="thumbs" style={{ marginTop: 8 }}>
            {others.map((m) => (
              <Link key={m.id} href={`/review/${m.id}`} title={`${m.reviewState.replace(/_/g, " ")} · ${t(CLASSIFICATION_LABEL[m.primaryClassification])}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/media/${m.currentContentVersionId}`} alt={m.reviewState.replace(/_/g, " ")} />
              </Link>
            ))}
          </div>
          <p className="muted small">{t("Open a photo to reopen it for review.")}</p>
        </details>
      )}
    </>
  );
}
