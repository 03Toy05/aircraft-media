import { desc, eq, and } from "drizzle-orm";
import { getDb } from "@/db/client";
import { actionExecutions, organisations, users, verifiedWhatsappNumbers } from "@/db/schema";
import { requireOwner } from "@/lib/session";
import { LANGUAGES } from "@/domain/settings";
import { MAX_PREFERRED_OPERATORS, getPreferredOperators } from "@/domain/directory";
import { addNumberAction, changePasswordAction, deactivateNumberAction, saveBrandAction, setLanguageAction, setLibraryOptInAction, setPreferredOperatorsAction } from "../../actions";
import { getBrand, logoDataUrl } from "@/domain/branding";
import BrandForm from "../../_components/BrandForm";
import { MIN_PASSWORD, hasPassword } from "@/domain/passwords";
import Choice from "../../_components/Choice";
import { Flash, Key, one, type SP } from "../../_components/ui";
import SearchSelect from "../../_components/SearchSelect";

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English", "zh-Hant": "繁體中文", "zh-Hans": "简体中文", fr: "Français", ar: "العربية", de: "Deutsch", ru: "Русский",
};

export default async function Settings({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { actor, email } = await requireOwner();
  const brandDb = await getDb();
  const brand = await getBrand(brandDb, actor.tenantId);
  const [meName] = await brandDb.select({ name: users.displayName }).from(users).where(eq(users.id, actor.id));
  const myName = meName?.name ?? email;
  const db = await getDb();
  const [me] = await db.select().from(users).where(eq(users.id, actor.id));
  const numbers = await db.select().from(verifiedWhatsappNumbers).where(and(eq(verifiedWhatsappNumbers.tenantId, actor.tenantId), eq(verifiedWhatsappNumbers.active, true)));
  const history = await db.select().from(actionExecutions).where(eq(actionExecutions.tenantId, actor.tenantId)).orderBy(desc(actionExecutions.createdAt)).limit(60);
  const orgs = (await db.select().from(organisations).where(and(eq(organisations.tenantId, actor.tenantId), eq(organisations.active, true)))).sort((a, b) => a.canonicalName.localeCompare(b.canonicalName));
  const preferred = await getPreferredOperators(db, actor.tenantId);
  const havePassword = await hasPassword(db, email);
  const configured =(name: string) => (process.env[name] ? "configured" : "not configured");
  return (
    <>
      <h1>Settings</h1>
      <Flash error={one(sp.error)} ok={one(sp.ok)} />
      <div className="card" id="branding">
        <h3 style={{ marginTop: 0 }}>Quote branding</h3>
        <p className="small muted" style={{ marginTop: 0 }}>Your logo and colour on every quote PDF and client link. Clients see your brand, not Aircraft Media&apos;s.</p>
        <BrandForm action={saveBrandAction} name={myName} color={brand.color} logo={logoDataUrl(brand)} />
      </div>
      <div className="grid g2">
        <div className="card">
          <h3>Password</h3>
          <p className="small muted">{havePassword ? "Change the password you sign in with." : "You sign in with Google. Set a password to sign in with your email instead (Google keeps working)."}</p>
          <form action={changePasswordAction} className="login-email">
            <input type="email" name="username" value={email} autoComplete="username" readOnly hidden />
            {havePassword && <><label htmlFor="current" className="small">Current password</label>
              <input id="current" name="current" type="password" required autoComplete="current-password" /></>}
            <label htmlFor="newpw" className="small">New password (at least {MIN_PASSWORD} characters)</label>
            <input id="newpw" name="password" type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" />
            <label htmlFor="again" className="small">Type it again</label>
            <input id="again" name="again" type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" />
            <div><button className="secondary" type="submit">{havePassword ? "Change password" : "Set password"}</button></div>
          </form>
        </div>
        <div className="card">
          <h3>Owner</h3>
          <p>{email}</p>
          <form action={setLanguageAction} className="row">
            <Key />
            <div><label>Reply language default</label>
              <SearchSelect name="language" defaultValue={me?.preferredLanguage ?? "en"} options={LANGUAGES.map((l) => ({ value: l, label: LANGUAGE_NAMES[l] ?? l }))} /></div>
            <div style={{ flex: "0 0 auto" }}><button className="secondary" type="submit">Save</button></div>
          </form>
        </div>
        <div className="card" id="preferred">
          <h3>Preferred operators</h3>
          <p className="muted small">Up to {MAX_PREFERRED_OPERATORS}. They are shown first on the Quote page, in this order. You can also tap the star next to an operator there.</p>
          <form action={setPreferredOperatorsAction}>
            <Key />
            {Array.from({ length: MAX_PREFERRED_OPERATORS }, (_, i) => (
              <div key={i}><label>{i + 1}.</label>
                <SearchSelect name="organisationId" defaultValue={preferred[i] ?? ""} emptyLabel="None" placeholder="Type an operator name"
                  options={orgs.map((o) => ({ value: o.id, label: o.canonicalName, hint: o.region ?? undefined }))} /></div>
            ))}
            <div style={{ marginTop: 10 }}><button type="submit">Save preferred operators</button></div>
          </form>
        </div>
        <div className="card" id="library">
          <h3>Aircraft Media library</h3>
          <p className="muted small">
            Help build a shared library of aircraft photos. When this is on, your approved photos are offered to the library:
            1 exterior, 2 cabin and 1 floor plan per aircraft, only where the library does not have them yet. The Aircraft Media
            team reviews each one first. Only the aircraft details and the photos are shared, never your prices, quotes,
            contacts or notes. Photos you mark as restricted are never shared. Turning it off stops new offers.
          </p>
          <form action={setLibraryOptInAction} className="row" style={{ alignItems: "end" }}>
            <div><label>Share my approved photos with the library</label>
              <Choice name="libraryOptIn" defaultValue={me?.libraryOptIn ? "yes" : "no"} ariaLabel="Share with the library" options={[{ value: "yes", label: "Yes, share" }, { value: "no", label: "No" }]} /></div>
            <div style={{ flex: "0 0 auto" }}><button className="secondary" type="submit">Save</button></div>
          </form>
        </div>
        <div className="card">
          <h3>Integrations</h3>
          <table><tbody>
            <tr><td>Google sign-in</td><td>{configured("AUTH_GOOGLE_ID")}</td></tr>
            <tr><td>Google Drive</td><td>{process.env.GOOGLE_DRIVE_REFRESH_TOKEN && process.env.AUTH_GOOGLE_ID ? "credentials set" : "not connected"} · root folder {process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID ?? "not set"} · new files stored in: {process.env.STORAGE_KIND === "drive" ? "Google Drive" : "local disk"}</td></tr>
            <tr><td>WhatsApp Business</td><td>deferred — use Share on an aircraft page instead</td></tr>
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
        <details className="card collapse">
          <summary>Advanced: action history</summary>
          <div style={{ maxHeight: 320, overflow: "auto" }}>
            <table>
              <thead><tr><th>When</th><th>Action</th><th>Result</th></tr></thead>
              <tbody>{history.map((h) => (
                <tr key={h.id}><td className="small">{h.createdAt.toISOString().slice(5, 16).replace("T", " ")}</td><td className="small">{h.actionName}</td><td className="small">{h.status}{h.safeError ? ` — ${h.safeError}` : ""}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </details>
      </div>
    </>
  );
}
