import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { aircraftTypes, organisationAliases, organisations } from "@/db/schema";
import { requireOwner } from "@/lib/session";
import { getCatalogue } from "@/domain/catalogue";
import { getAircraftCard } from "@/domain/directory";
import { getLineup } from "@/domain/media";
import { AIRCRAFT_CATEGORY_LABEL, type AircraftCategory } from "@/domain/constants";
import { addOrgAliasAction, renameOrgAction, setOrgContactsAction, setOrgRegionAction } from "../../../actions";
import OperatorContacts from "../../../_components/OperatorContacts";
import { Flash, Key, one, type SP } from "../../../_components/ui";
import PlacePicker from "../../../_components/PlacePicker";

export default async function OrganisationDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  const { actor } = await requireOwner();
  const db = await getDb();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [org] = await db.select().from(organisations).where(and(eq(organisations.id, id), eq(organisations.tenantId, actor.tenantId)));
  if (!org) notFound();
  const aliases = await db.select().from(organisationAliases).where(eq(organisationAliases.organisationId, id));
  const rows = await getCatalogue(db, actor.tenantId, { operatorId: id });
  const types = await db.select().from(aircraftTypes).where(eq(aircraftTypes.tenantId, actor.tenantId));

  // One card per aircraft: its description and its approved photos.
  const cards = await Promise.all(
    rows.map(async (r) => ({
      row: r,
      card: await getAircraftCard(db, r.aircraftId),
      photos: await getLineup(db, { aircraftId: r.aircraftId, aircraftTypeId: r.aircraftTypeId }),
      category: types.find((t) => t.id === r.aircraftTypeId)?.category ?? null,
    })),
  );

  return (
    <>
      <p className="small"><Link href="/fleet">← Operators &amp; aircraft</Link></p>
      <h1>{org.canonicalName}</h1>
      <Flash error={one(sp.error)} ok={one(sp.ok)} />
      <details className="card">
        <summary><b>Change the name</b> <span className="muted small">(for example a spelling fix or a new company name)</span></summary>
        <form action={renameOrgAction}>
          <Key /><input type="hidden" name="organisationId" value={id} />
          <label>Name</label>
          <input name="name" defaultValue={org.canonicalName} required />
          <label><input type="checkbox" name="keepOld" defaultChecked /> Keep the old name as another name, so cards that still use it keep matching</label>
          <p><button type="submit" className="secondary">Save name</button></p>
        </form>
      </details>
      <form action={setOrgRegionAction} className="row" style={{ marginBottom: 12, alignItems: "end" }}>
        <Key /><input type="hidden" name="organisationId" value={id} /><input type="hidden" name="returnTo" value={`/organisations/${id}`} />
        <div style={{ maxWidth: 320 }}><label>Region</label><PlacePicker name="region" kind="region" defaultValue={org.region ?? ""} /></div>
        <div style={{ maxWidth: 320 }}><label>Base</label><PlacePicker name="base" kind="base" multiple defaultValue={org.base ?? ""} /></div>
        <div style={{ flex: "0 0 auto" }}><button className="secondary" type="submit">Save</button></div>
      </form>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Contact</h3>
        <OperatorContacts o={org} empty="No contact details yet." />
        <details style={{ marginTop: 8 }}>
          <summary className="small">Edit contact details</summary>
          <form action={setOrgContactsAction} className="login-email" style={{ maxWidth: 520 }}>
            <Key /><input type="hidden" name="organisationId" value={id} />
            <label htmlFor="website" className="small">Website</label>
            <input id="website" name="website" type="text" inputMode="url" autoComplete="url" placeholder="https://operator.com" defaultValue={org.website ?? ""} />
            <label htmlFor="email" className="small">Email</label>
            <input id="email" name="email" type="email" placeholder="info@operator.com" defaultValue={org.email ?? ""} />
            <label htmlFor="sales" className="small">Sales contact (name, email, phone)</label>
            <textarea id="sales" name="salesContact" rows={3} defaultValue={org.salesContact ?? ""} />
            <div><button className="secondary" type="submit">Save contact details</button></div>
          </form>
        </details>
      </div>

      {cards.length === 0 && <div className="card muted">No aircraft yet for this operator. Add one with Toy or from the Aircraft page.</div>}
      {cards.map(({ row, card, photos, category }) => (
        <div className="card" key={row.aircraftId}>
          <h3 style={{ marginBottom: 2 }}>
            <Link href={`/aircraft/${row.aircraftId}`}>{row.aircraft}</Link>
            <span className="muted" style={{ fontWeight: 400 }}> · {row.tail ?? "no tail number yet"}</span>
          </h3>
          <p className="small muted" style={{ marginTop: 0 }}>{category ? AIRCRAFT_CATEGORY_LABEL[category as AircraftCategory] ?? category : ""}</p>
          <table style={{ width: "auto" }}>
            <tbody>
              {card?.yom != null && <tr><td className="muted">YOM</td><td>{card.yom}</td></tr>}
              {card?.yor != null && <tr><td className="muted">YOR</td><td>{card.yor}</td></tr>}
              {card?.capacity != null && <tr><td className="muted">Capacity</td><td>{card.capacity}</td></tr>}
              <tr><td className="muted">Base</td><td>{row.base ?? "–"}</td></tr>
              {card && card.wifi !== "unknown" && <tr><td className="muted">WIFI</td><td>{card.wifi === "yes" ? "Yes" : card.wifi === "no" ? "No" : "TBC"}</td></tr>}
              {card?.notes && <tr><td className="muted">Notes</td><td>{card.notes}</td></tr>}
            </tbody>
          </table>
          {photos.length === 0 ? (
            <p className="muted small">No approved photos yet.</p>
          ) : (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              {photos.map((p) => (
                <a key={p.contentVersionId} href={`/api/media/${p.contentVersionId}`} target="_blank" style={{ width: 150, textDecoration: "none" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/media/${p.contentVersionId}`} alt={p.label} style={{ width: 150, height: 104, objectFit: "cover", borderRadius: 6, display: "block" }} />
                  <span className="small muted">{p.label}{p.associationStatus === "representative_type" ? " (representative)" : ""}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      ))}

      <details className="card">
        <summary><b>Other names</b> <span className="muted small">(other ways this operator's name is written)</span></summary>
        <p>{aliases.length ? aliases.map((a) => a.alias).join(", ") : <span className="muted">None</span>}</p>
        <form action={addOrgAliasAction} className="row">
          <Key /><input type="hidden" name="organisationId" value={id} />
          <div><input name="alias" placeholder="Add another name" required /></div>
          <div style={{ flex: "0 0 auto" }}><button className="secondary" type="submit">Add name</button></div>
        </form>
      </details>
    </>
  );
}
