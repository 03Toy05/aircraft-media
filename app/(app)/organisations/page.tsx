import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { organisationAliases, organisationRoles, organisations } from "@/db/schema";
import { requireOwner } from "@/lib/session";
import { getCatalogue } from "@/domain/catalogue";
import { addOrgAliasAction, createOrganisationAction } from "../../actions";
import { Flash, Key, one, type SP } from "../../_components/ui";

export default async function Organisations({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { actor } = await requireOwner();
  const db = await getDb();
  const orgs = await db.select().from(organisations).where(eq(organisations.tenantId, actor.tenantId)).orderBy(asc(organisations.canonicalName));
  const roles = await db.select().from(organisationRoles);
  const aliases = await db.select().from(organisationAliases);
  const cat = await getCatalogue(db, actor.tenantId);
  const rolesOf = (id: string) => roles.filter((r) => r.organisationId === id && r.active !== false).map((r) => r.role.replace(/_/g, " "));
  const aliasesOf = (id: string) => aliases.filter((a) => a.organisationId === id).map((a) => a.alias);

  return (
    <>
      <h1>Operators</h1>
      <p className="muted small">Operators and management companies. The aircraft list on each shows who currently operates it.</p>
      <Flash error={one(sp.error)} ok={one(sp.ok)} />
      <div className="card" style={{ overflowX: "auto" }}>
        <table>
          <thead><tr><th>Name</th><th>Role</th><th>Other names</th><th>Aircraft</th><th>With full photos</th></tr></thead>
          <tbody>
            {orgs.length === 0 && <tr><td colSpan={5} className="muted">No operators yet.</td></tr>}
            {orgs.map((o) => {
              const mine = cat.filter((r) => r.operatorId === o.id);
              return (
                <tr key={o.id}>
                  <td><Link href={`/organisations/${o.id}`}>{o.canonicalName}</Link></td>
                  <td className="small">{rolesOf(o.id).join(", ") || "–"}</td>
                  <td className="small">{aliasesOf(o.id).join(", ") || "–"}</td>
                  <td>{mine.length}</td>
                  <td>{mine.filter((r) => r.status === "actual_available").length}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid g2">
        <form action={createOrganisationAction} className="card" id="create">
          <h3>Add operator</h3>
          <Key />
          <label>Name</label>
          <input name="name" required defaultValue={one(sp.name)} placeholder="e.g. Metrojet" />
          <label>Type of organisation</label>
          <label><input type="checkbox" name="roles" value="operator" defaultChecked /> Operator (flies the aircraft)</label>
          <label><input type="checkbox" name="roles" value="management_company" /> Management company</label>
          <label>Other names (comma separated, optional)</label>
          <input name="aliases" placeholder="Metro Jet, MJ" />
          <p className="muted small">An “other name” (alias) is another way the same company gets written. When a card says “Metro Jet”, the app finds “Metrojet”. Both names point to one operator, so nothing is duplicated.</p>
          <p><button type="submit">Create operator</button></p>
        </form>

        <div className="card">
          <h3>Add other names</h3>
          {orgs.length === 0 ? <p className="muted">Add an operator first.</p> : orgs.map((o) => (
            <form key={o.id} action={addOrgAliasAction} className="row" style={{ marginBottom: 6 }}>
              <Key /><input type="hidden" name="organisationId" value={o.id} />
              <div style={{ flex: "1 1 140px" }}>{o.canonicalName}</div>
              <div><input name="alias" placeholder="add another name" required /></div>
              <div style={{ flex: "0 0 auto" }}><button className="secondary" type="submit">Add name</button></div>
            </form>
          ))}
        </div>
      </div>
    </>
  );
}
