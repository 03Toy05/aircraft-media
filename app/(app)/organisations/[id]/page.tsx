import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { organisationAliases, organisationRoles, organisations } from "@/db/schema";
import { requireOwner } from "@/lib/session";
import { getCatalogue } from "@/domain/catalogue";
import { addOrgAliasAction } from "../../../actions";
import { Badge, Flash, Key, one, type SP } from "../../../_components/ui";

export default async function OrganisationDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  const { actor } = await requireOwner();
  const db = await getDb();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [org] = await db.select().from(organisations).where(and(eq(organisations.id, id), eq(organisations.tenantId, actor.tenantId)));
  if (!org) notFound();
  const roles = await db.select().from(organisationRoles).where(eq(organisationRoles.organisationId, id));
  const aliases = await db.select().from(organisationAliases).where(eq(organisationAliases.organisationId, id));
  const rows = await getCatalogue(db, actor.tenantId, { operatorId: id });
  return (
    <>
      <p className="small"><Link href="/organisations">← Organisations</Link></p>
      <h1>{org.canonicalName}</h1>
      <Flash error={one(sp.error)} ok={one(sp.ok)} />
      <div className="grid g2">
        <div className="card">
          <h3>Roles</h3>
          <p>{roles.map((r) => r.role.replace("_", " ")).join(", ")}</p>
          <p className="muted small">A role does not by itself prove any aircraft relationship.</p>
          <h3>Other names</h3>
          <p>{aliases.length ? aliases.map((a) => a.alias).join(", ") : <span className="muted">None</span>}</p>
          <form action={addOrgAliasAction} className="row">
            <Key /><input type="hidden" name="organisationId" value={id} />
            <div><input name="alias" placeholder="Add alias" required /></div>
            <div style={{ flex: "0 0 auto" }}><button className="secondary" type="submit">Add</button></div>
          </form>
        </div>
        <div className="card">
          <h3>Aircraft and photo coverage</h3>
          <table>
            <thead><tr><th>Tail</th><th>Aircraft</th><th>Availability</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={3} className="muted">No aircraft linked as operator yet.</td></tr>}
              {rows.map((r) => <tr key={r.aircraftId}><td><Link href={`/aircraft/${r.aircraftId}`}>{r.tail ?? "(no tail yet)"}</Link></td><td>{r.aircraft}</td><td><Badge status={r.status} /></td></tr>)}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
