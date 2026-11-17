import { desc, eq, and } from "drizzle-orm";
import { getDb } from "@/db/client";
import { actionExecutions, users, verifiedWhatsappNumbers } from "@/db/schema";
import { requireOwner } from "@/lib/session";
import { LANGUAGES } from "@/domain/settings";
import { addNumberAction, deactivateNumberAction, setLanguageAction } from "../../actions";
import { Flash, Key, one, type SP } from "../../_components/ui";

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English", "zh-Hant": "繁體中文", "zh-Hans": "简体中文", fr: "Français", ar: "العربية", de: "Deutsch", ru: "Русский",
};

export default async function Settings({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { actor, email } = await requireOwner();
  const db = await getDb();
  const [me] = await db.select().from(users).where(eq(users.id, actor.id));
  const numbers = await db.select().from(verifiedWhatsappNumbers).where(and(eq(verifiedWhatsappNumbers.tenantId, actor.tenantId), eq(verifiedWhatsappNumbers.active, true)));
  const history = await db.select().from(actionExecutions).where(eq(actionExecutions.tenantId, actor.tenantId)).orderBy(desc(actionExecutions.createdAt)).limit(60);
  const configured = (name: string) => (process.env[name] ? "configured" : "not configured");
  return (
    <>
      <h1>Settings</h1>
      <Flash error={one(sp.error)} ok={one(sp.ok)} />
      <div className="grid g2">
        <div className="card">
          <h3>Owner</h3>
          <p>{email}</p>
          <form action={setLanguageAction} className="row">
            <Key />
            <div><label>Reply language default</label>
              <select name="language" defaultValue={me?.preferredLanguage ?? "en"}>{LANGUAGES.map((l) => <option key={l} value={l}>{LANGUAGE_NAMES[l]}</option>)}</select></div>
            <div style={{ flex: "0 0 auto" }}><button className="secondary" type="submit">Save</button></div>
          </form>
        </div>
        <div className="card">
          <h3>Integrations</h3>
          <table><tbody>
            <tr><td>Google sign-in</td><td>{configured("AUTH_GOOGLE_ID")}</td></tr>
            <tr><td>Google Drive</td><td>not connected (phase 2) — root folder {process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID ?? "not set"}</td></tr>
            <tr><td>WhatsApp Business</td><td>not connected (phase 3)</td></tr>
            <tr><td>Gemini (optional)</td><td>disabled — the app works fully without it</td></tr>
          </tbody></table>
        </div>
        <div className="card">
          <h3>My WhatsApp number</h3>
          <p className="muted small">Only a number recorded here may issue commands or receive protected media once WhatsApp is connected.</p>
          <table><tbody>
            {numbers.length === 0 && <tr><td className="muted">No number yet.</td></tr>}
            {numbers.map((n) => (
              <tr key={n.id}><td>+{n.phone}</td><td>{n.verificationStatus}</td><td>
                <form action={deactivateNumberAction}><Key /><input type="hidden" name="numberId" value={n.id} /><button className="secondary" type="submit">Remove</button></form></td></tr>
            ))}
          </tbody></table>
          <form action={addNumberAction} className="row">
            <Key />
            <div><label>Number with country code</label><input name="phone" placeholder="85291234567" required /></div>
            <div style={{ flex: "0 0 auto" }}><button type="submit">Add</button></div>
          </form>
        </div>
        <div className="card">
          <h3>Action history</h3>
          <div style={{ maxHeight: 320, overflow: "auto" }}>
            <table>
              <thead><tr><th>When</th><th>Action</th><th>Result</th></tr></thead>
              <tbody>{history.map((h) => (
                <tr key={h.id}><td className="small">{h.createdAt.toISOString().slice(5, 16).replace("T", " ")}</td><td className="small">{h.actionName}</td><td className="small">{h.status}{h.safeError ? ` — ${h.safeError}` : ""}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
