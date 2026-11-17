import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { organisations } from "@/db/schema";
import { requireOwner } from "@/lib/session";
import { getCatalogue } from "@/domain/catalogue";
import { createOrganisationAction } from "../../actions";
import { Flash, Key, one, type SP } from "../../_components/ui";

export default async function Organisations({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { actor } = await requireOwner();
  const db = await getDb();
  const orgs = await db.select().from(organisations).where(eq(organisations.tenantId, actor.tenantId)).orderBy(asc(organisations.canonicalName));
  const cat = await getCatalogue(db, actor.tenantId);
  return (
    <>
      <h1>Organisations</h1>
      <Flash error={one(sp.error)} ok={one(sp.ok)} />
      <div className="grid g2">
        <div className="card">
          <table>
            <thead><tr><th>Name</th><th>Aircraft</th><th>With full photos</th></tr></thead>
            <tbody>
              {orgs.length === 0 && <tr><td colSpan={3} className="muted">None yet.</td></tr>}
              {orgs.map((o) => {
                const mine = cat.filter((r) => r.operatorId === o.id);
                return <tr key={o.id}><td><Link href={`/organisations/${o.id}`}>{o.canonicalName}</Link></td><td>{mine.length}</td><td>{mine.filter((r) => r.status === "actual_available").length}</td></tr>;
              })}
            </tbody>
          </table>
        </div>
        <form action={createOrganisationAction} className="card">
          <h3>Add organisation</h3><Key />
          <label>Name</label><input name="name" required />
          <label>Roles</label>
          <label><input type="checkbox" name="roles" value="operator" defaultChecked /> Operator</label>
          <label><input type="checkbox" name="roles" value="management_company" /> Management company</label>
          <label>Other names (comma separated, optional)</label><input name="aliases" placeholder="Metro Jet, MJ" />
          <p><button type="submit">Create</button></p>
        </form>
      </div>
    </>
  );
}
