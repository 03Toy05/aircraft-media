import { requireOwner } from "@/lib/session";
import { getDb } from "@/db/client";
import { CONTACT_APPS, assignMissingPersonReferences, contactApp, listContacts } from "@/domain/contacts";
import { createContactAction, retireContactAction, updateContactAction } from "../../actions";
import { Flash, Key, one, type SP } from "../../_components/ui";
import Icon from "../../_components/Icon";
import SearchSelect from "../../_components/SearchSelect";

/** People you send aircraft to, and the messenger each one prefers. Toy reads this list for "send the G280 to Mr Chan". */
export default async function Contacts({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { actor, readOnly } = await requireOwner();
  const db = await getDb();
  if (!readOnly) await assignMissingPersonReferences(db, actor.tenantId); // contacts saved before Person IDs existed
  const list = await listContacts(db, actor.tenantId);
  const AppSelect = ({ value }: { value?: string }) => (
    <SearchSelect name="app" defaultValue={value ?? "whatsapp"} ariaLabel="Messenger" options={CONTACT_APPS.map((a) => ({ value: a.id, label: a.label }))} />
  );
  return (
    <>
      <h1>Contacts</h1>
      <p className="muted">Save who you send aircraft to and the messenger each person prefers. Then tell Toy, for example <i>“send the G280 to Mr Chan”</i>. Toy opens their chat with the card ready and you press Send.</p>
      <Flash error={one(sp.error)} ok={one(sp.ok)} />

      <details className="card" open={list.length === 0 || !!one(sp.error)}>
        <summary><Icon name="plus" /><b>Add contact</b></summary>
        <form action={createContactAction}>
          <Key />
          <div className="row">
            <div><label>Name</label><input name="name" required placeholder="Mr Chan Tai Man" /></div>
            <div><label>Prefers</label><AppSelect /></div>
          </div>
          <label>English name (only if the name above is not in English)</label>
          <input name="englishName" placeholder="Chan Tai Man" />
          <p className="muted small">Each contact gets a Person ID such as PER-CTM-001 (CBOS format), from the initials of the English name. It never changes, even if you rename the contact.</p>
          <label>Phone number with country code, or username</label>
          <input name="handle" placeholder="+852 9123 4567" />
          <p className="muted small">WhatsApp and iMessage/SMS need the number to open the right person. Telegram uses the username (or leave it blank to pick the person yourself). LINE, WeChat, KakaoTalk and Signal cannot open a person from a link, so the ID is only for your reference.</p>
          <label>Notes (optional)</label>
          <input name="notes" placeholder="e.g. Broker, Middle East" />
          <p><button type="submit">Add contact</button></p>
        </form>
      </details>

      {list.length === 0 && <div className="card muted">No contacts yet.</div>}
      {list.map((c) => {
        const app = contactApp(c.app);
        return (
          <details className="card" key={c.id}>
            <summary>
              {app && <span className="dot" style={{ background: app.colour, display: "inline-flex", width: 20, height: 20, borderRadius: "50%", color: "#fff", fontSize: 11, fontWeight: 700, alignItems: "center", justifyContent: "center", marginRight: 8 }}>{app.mark}</span>}
              <b>{c.name}</b> {c.reference ? <code className="ref">{c.reference}</code> : <span className="badge s-needs_review">needs English name for ID</span>} <span className="muted small">· {app?.label ?? c.app}{c.handle ? ` · ${c.handle}` : ""}{c.notes ? ` · ${c.notes}` : ""}</span>
            </summary>
            <form action={updateContactAction}>
              <Key /><input type="hidden" name="contactId" value={c.id} />
              <div className="row">
                <div><label>Name</label><input name="name" defaultValue={c.name} required /></div>
                <div><label>Prefers</label><AppSelect value={c.app} /></div>
              </div>
              {c.reference ? (
                <p className="muted small">Person ID {c.reference}{c.englishName ? ` (from “${c.englishName}”)` : ""}. It stays the same when you rename the contact.</p>
              ) : (
                <><label>English name (for the Person ID)</label><input name="englishName" defaultValue={c.englishName ?? ""} placeholder="Chan Tai Man" /></>
              )}
              <label>Number or username</label><input name="handle" defaultValue={c.handle ?? ""} />
              <label>Notes</label><input name="notes" defaultValue={c.notes ?? ""} />
              <p><button type="submit" className="secondary">Save</button></p>
            </form>
            <form action={retireContactAction}>
              <Key /><input type="hidden" name="contactId" value={c.id} />
              <button type="submit" className="danger">Remove contact</button>
            </form>
          </details>
        );
      })}
    </>
  );
}
