import { desc, eq, and } from "drizzle-orm";
import { getDb } from "@/db/client";
import { actionExecutions, organisations, users, verifiedWhatsappNumbers } from "@/db/schema";
import { requireOwner } from "@/lib/session";
import { LANGUAGES } from "@/domain/settings";
import { MAX_PREFERRED_OPERATORS, getPreferredOperators } from "@/domain/directory";
import { addNumberAction, changePasswordAction, deactivateNumberAction, saveBrandAction, setLanguageAction, setLibraryOptInAction, setPreferredOperatorsAction } from "../../actions";
import { VERSION_FORMATS, getBrand, logoDataUrl } from "@/domain/branding";
import BrandForm from "../../_components/BrandForm";
import QuoteLayoutCard from "../../_components/QuoteLayoutCard";
import { MIN_PASSWORD, hasPassword } from "@/domain/passwords";
import Choice from "../../_components/Choice";
import { Flash, Key, one, type SP } from "../../_components/ui";
import SearchSelect from "../../_components/SearchSelect";
import { cancelAccountAction, deleteAccountAction, reopenAccountAction } from "../../accountActions";
import { serverT } from "@/lib/uiLang";

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English", "zh-Hant": "繁體中文", "zh-Hans": "简体中文", fr: "Français", ar: "العربية", de: "Deutsch", ru: "Русский",
};

export default async function Settings({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const t = await serverT();
  const { actor, email, isAdmin, viewingAs, cancelled } = await requireOwner();
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
  const configured =(name: string) => (process.env[name] ? t("configured") : t("not configured"));
  return (
    <>
      <h1>{t("Settings")}</h1>
      <Flash error={one(sp.error)} ok={one(sp.ok)} />
      <div className="card" id="branding">
        <h3 style={{ marginTop: 0 }}>{t("Quote branding")}</h3>
        <p className="small muted" style={{ marginTop: 0 }}>{t("Your logo and colour on every quote PDF and client link. Clients see your brand, not Aircraft Media's.")}</p>
        <BrandForm action={saveBrandAction} name={myName} color={brand.color} logo={logoDataUrl(brand)} versionFormat={brand.versionFormat} formats={VERSION_FORMATS} />
      </div>
      <QuoteLayoutCard tenantId={actor.tenantId} open={one(sp.layout) === "1"} />
      <div className="grid g2">
        <div className="card">
          <h3>{t("Password")}</h3>
          <p className="small muted">{havePassword ? t("Change the password you sign in with.") : t("You sign in with Google. Set a password to sign in with your email instead (Google keeps working).")}</p>
          <form action={changePasswordAction} className="login-email">
            <input type="email" name="username" value={email} autoComplete="username" readOnly hidden />
            {havePassword && <><label htmlFor="current" className="small">{t("Current password")}</label>
              <input id="current" name="current" type="password" required autoComplete="current-password" /></>}
            <label htmlFor="newpw" className="small">{t("New password (at least {n} characters)", { n: MIN_PASSWORD })}</label>
            <input id="newpw" name="password" type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" />
            <label htmlFor="again" className="small">{t("Type it again")}</label>
            <input id="again" name="again" type="password" required minLength={MIN_PASSWORD} autoComplete="new-password" />
            <div><button className="secondary" type="submit">{havePassword ? t("Change password") : t("Set password")}</button></div>
          </form>
        </div>
        <div className="card">
          <h3>{t("Owner")}</h3>
          <p>{email}</p>
          <form action={setLanguageAction} className="row">
            <Key />
            <div><label>{t("Reply language default")}</label>
              <SearchSelect name="language" defaultValue={me?.preferredLanguage ?? "en"} options={LANGUAGES.map((l) => ({ value: l, label: LANGUAGE_NAMES[l] ?? l }))} /></div>
            <div style={{ flex: "0 0 auto" }}><button className="secondary" type="submit">{t("Save")}</button></div>
          </form>
        </div>
        <div className="card" id="preferred">
          <h3>{t("Preferred operators")}</h3>
          <p className="muted small">{t("Up to {n}. They are shown first on the Quote page, in this order. You can also tap the star next to an operator there.", { n: MAX_PREFERRED_OPERATORS })}</p>
          <form action={setPreferredOperatorsAction}>
            <Key />
            {Array.from({ length: MAX_PREFERRED_OPERATORS }, (_, i) => (
              <div key={i}><label>{i + 1}.</label>
                <SearchSelect name="organisationId" defaultValue={preferred[i] ?? ""} emptyLabel={t("None")} placeholder={t("Type an operator name")}
                  options={orgs.map((o) => ({ value: o.id, label: o.canonicalName, hint: o.region ?? undefined }))} /></div>
            ))}
            <div style={{ marginTop: 10 }}><button type="submit">{t("Save preferred operators")}</button></div>
          </form>
        </div>
        <div className="card" id="library">
          <h3>{t("Aircraft Media library")}</h3>
          <p className="muted small">
            {t("Help build a shared library of aircraft photos. When this is on, your approved photos are offered to the library: 1 exterior, 2 cabin and 1 floor plan per aircraft, only where the library does not have them yet. The Aircraft Media team reviews each one first. Only the aircraft details and the photos are shared, never your prices, quotes, contacts or notes. Photos you mark as restricted are never shared. Turning it off stops new offers.")}
          </p>
          <form action={setLibraryOptInAction} className="row" style={{ alignItems: "end" }}>
            <div><label>{t("Share my approved photos with the library")}</label>
              <Choice name="libraryOptIn" defaultValue={me?.libraryOptIn ? "yes" : "no"} ariaLabel={t("Share with the library")} options={[{ value: "yes", label: t("Yes, share") }, { value: "no", label: t("No") }]} /></div>
            <div style={{ flex: "0 0 auto" }}><button className="secondary" type="submit">{t("Save")}</button></div>
          </form>
        </div>
        <div className="card">
          <h3>{t("Integrations")}</h3>
          <table><tbody>
            <tr><td>{t("Google sign-in")}</td><td>{configured("AUTH_GOOGLE_ID")}</td></tr>
            <tr><td>Google Drive</td><td>{process.env.GOOGLE_DRIVE_REFRESH_TOKEN && process.env.AUTH_GOOGLE_ID ? t("credentials set") : t("not connected")} · {t("root folder")} {process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID ?? t("not set")} · {t("new files stored in:")} {process.env.STORAGE_KIND === "drive" ? "Google Drive" : t("local disk")}</td></tr>
            <tr><td>WhatsApp Business</td><td>{t("deferred — use Share on an aircraft page instead")}</td></tr>
            <tr><td>{t("Gemini (optional)")}</td><td>{t("disabled — the app works fully without it")}</td></tr>
          </tbody></table>
        </div>
        <div className="card">
          <h3>{t("My WhatsApp number")}</h3>
          <p className="muted small">{t("Only a number recorded here may issue commands or receive protected media once WhatsApp is connected.")}</p>
          <table><tbody>
            {numbers.length === 0 && <tr><td className="muted">{t("No number yet.")}</td></tr>}
            {numbers.map((n) => (
              <tr key={n.id}><td>+{n.phone}</td><td>{n.verificationStatus}</td><td>
                <form action={deactivateNumberAction}><Key /><input type="hidden" name="numberId" value={n.id} /><button className="secondary" type="submit">{t("Remove")}</button></form></td></tr>
            ))}
          </tbody></table>
          <form action={addNumberAction} className="row">
            <Key />
            <div><label>{t("Number with country code")}</label><input name="phone" placeholder="85291234567" required /></div>
            <div style={{ flex: "0 0 auto" }}><button type="submit">{t("Add")}</button></div>
          </form>
        </div>
        <details className="card collapse">
          <summary>{t("Advanced: action history")}</summary>
          <div style={{ maxHeight: 320, overflow: "auto" }}>
            <table>
              <thead><tr><th>{t("When")}</th><th>{t("Action")}</th><th>{t("Result")}</th></tr></thead>
              <tbody>{history.map((h) => (
                <tr key={h.id}><td className="small">{h.createdAt.toISOString().slice(5, 16).replace("T", " ")}</td><td className="small">{h.actionName}</td><td className="small">{h.status}{h.safeError ? ` — ${h.safeError}` : ""}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </details>
        {!isAdmin && !viewingAs && (
          <div className="card" id="account">
            <h3>{t("Your account")}</h3>
            {cancelled ? (
              <>
                <p className="small">{t("You cancelled your account. Your workspace is read-only: you can still look at it, share quotes and download them.")}</p>
                <form action={reopenAccountAction}><button type="submit">{t("Reopen my account")}</button></form>
              </>
            ) : (
              <>
                <p className="small muted">{t("Cancel to stop using Aircraft Media for now. Your workspace becomes read-only and nothing is deleted; you can reopen it here at any time.")}</p>
                <form action={cancelAccountAction}><button type="submit" className="secondary">{t("Cancel my account")}</button></form>
              </>
            )}
            <details className="collapse" style={{ marginTop: 14 }}>
              <summary>{t("Delete my account")}</summary>
              <p className="small">{t("This deletes your workspace and everything in it: aircraft, operators, photos, quotes and requests. Client links you shared stop opening. It can't be undone.")}</p>
              <form action={deleteAccountAction} className="row" style={{ alignItems: "end" }}>
                <label style={{ flex: "1 1 240px" }}>{t("Type your email address to confirm")}
                  <input name="confirmEmail" type="email" autoComplete="off" required placeholder={email} />
                </label>
                <div style={{ flex: "0 0 auto" }}><button type="submit" className="danger">{t("Delete my account")}</button></div>
              </form>
            </details>
          </div>
        )}
      </div>
    </>
  );
}
