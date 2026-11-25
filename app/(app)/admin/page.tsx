import Link from "next/link";
import { headers } from "next/headers";
import InviteCopy from "../../_components/InviteCopy";
import { and, asc, count, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { aircraft, aircraftMedia, organisations, users } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { serverT } from "@/lib/uiLang";
import { TRIAL_DAYS, accessFor } from "@/domain/accounts";
import { LIBRARY_TENANT_ID } from "@/domain/library";
import { quoteShareStats, type QuoteShareStats } from "@/domain/quoteShares";
import {
  extendTrialAction, inviteUserAction, setBlockedAction, setLibraryAccessAction, setLibraryOperatorsAction, setPlanAction, viewAsAction, withdrawInviteAction,
} from "../../actions";
import { Flash, Key, one, type SP } from "../../_components/ui";
import Choice from "../../_components/Choice";

type T = Awaited<ReturnType<typeof serverT>>;

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "–");
const quotesLine = (t: T, q: QuoteShareStats | undefined) => {
  const n = q?.quotes ?? 0;
  const shared = n === 1 ? t("{n} quote shared", { n }) : t("{n} quotes shared", { n });
  return q?.last30 ? `${shared} ${t("({n} in the last 30 days)", { n: q.last30 })}` : shared;
};

/** Platform admin: invite people, see how their trials stand and how much they use it, extend or turn off access, and look at a workspace. */
export default async function Admin({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const me = await requireAdmin();
  const t = await serverT();
  // The address people open: this site, as the admin reached it.
  const h = await headers();
  const appLink = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "aircraft-media.onrender.com"}`;
  const db = await getDb();
  const people = (await db.select().from(users).orderBy(asc(users.createdAt))).filter((u) => u.id !== me.actor.id && u.email !== me.email);
  const toMap = (rows: { t: string; n: number }[]) => new Map(rows.map((r) => [r.t, Number(r.n)]));
  const photos = toMap(await db.select({ t: aircraftMedia.tenantId, n: count() }).from(aircraftMedia).where(eq(aircraftMedia.lifecycleState, "active")).groupBy(aircraftMedia.tenantId));
  const planes = toMap(await db.select({ t: aircraft.tenantId, n: count() }).from(aircraft).where(eq(aircraft.active, true)).groupBy(aircraft.tenantId));
  const ops = toMap(await db.select({ t: organisations.tenantId, n: count() }).from(organisations).where(eq(organisations.active, true)).groupBy(organisations.tenantId));
  const shares = await quoteShareStats(db);
  // The library's operators, to choose which ones each person may see.
  const libOps = await db.select({ id: organisations.id, name: organisations.canonicalName }).from(organisations)
    .where(and(eq(organisations.tenantId, LIBRARY_TENANT_ID), eq(organisations.active, true))).orderBy(asc(organisations.canonicalName));
  const mine = me.viewingAs ? undefined : shares.get(me.actor.tenantId);

  return (
    <>
      <div className="people-head"><h1 style={{ margin: 0 }}>{t("Users")}</h1><Link href="/admin/speed" className="btn secondary small-btn">{t("Speed")}</Link></div>
      <Flash error={one(sp.error)} ok={one(sp.ok)} />
      <div className="card">
        <div className="people-head">
          <h3 style={{ margin: 0 }}>{t("People ({n})", { n: people.length })}</h3>
          {!me.viewingAs && <span className="small muted">{t("Your own workspace: {line}", { line: quotesLine(t, mine) })}</span>}
        </div>
        <p className="small muted" style={{ margin: "4px 0 6px" }}>
          {t("A quote counts as shared when the phone's share sheet hands it to an app, or its message is copied. Sharing the same quote again, or option by option, counts once. The phone cannot tell whether it was then sent.")}
        </p>
        {people.length === 0 ? <p className="muted">{t("Nobody invited yet.")}</p> : people.map((u) => {
          const a = accessFor(u);
          const status =
            u.status === "blocked" ? { label: t("Turned off"), tone: "off" }
            : !u.firstSignInAt ? { label: t("Invited, not signed in yet"), tone: "wait" }
            : u.plan === "full" ? { label: t("Full access"), tone: "ok" }
            : a.expired ? { label: t("Trial ended (read-only)"), tone: "off" }
            : { label: a.daysLeft === 1 ? t("Trial · {n} day left", { n: a.daysLeft }) : t("Trial · {n} days left", { n: a.daysLeft ?? 0 }), tone: a.daysLeft != null && a.daysLeft <= 3 ? "warn" : "ok" };
          const trialNote = u.plan !== "trial" ? null
            : u.trialEndsAt ? (a.expired ? t("trial ended {date}", { date: day(u.trialEndsAt) }) : t("trial ends {date}", { date: day(u.trialEndsAt) }))
            : t("{n}-day trial starts at first sign-in", { n: TRIAL_DAYS });
          const q = shares.get(u.tenantId);
          return (
            <div key={u.id} className="person">
              <div className="person-head">
                <div style={{ minWidth: 0 }}>
                  <b>{u.displayName}</b> <span className={`pill ${status.tone}`}>{status.label}</span>
                  <div className="small muted">{u.email}</div>
                </div>
                {u.firstSignInAt ? (
                  <form action={viewAsAction}><input type="hidden" name="userId" value={u.id} /><button className="secondary small-btn" type="submit">{t("Look")}</button></form>
                ) : (
                  <InviteCopy name={u.displayName} email={u.email} link={appLink} days={u.plan === "trial" ? TRIAL_DAYS : null} />
                )}
              </div>
              <div className="stats">
                <div className="stat"><span className="stat-n">{q?.quotes ?? 0}</span><span className="stat-l">{t("quotes shared")}{q?.last30 ? ` · ${t("{n} in 30 days", { n: q.last30 })}` : ""}</span></div>
                <div className="stat"><span className="stat-n">{photos.get(u.tenantId) ?? 0}</span><span className="stat-l">{t("photos")}</span></div>
                <div className="stat"><span className="stat-n">{planes.get(u.tenantId) ?? 0}</span><span className="stat-l">{t("aircraft")}</span></div>
                <div className="stat"><span className="stat-n">{ops.get(u.tenantId) ?? 0}</span><span className="stat-l">{t("operators")}</span></div>
              </div>
              <div className="small muted">
                {u.firstSignInAt ? t("Signed in first {first}, last {last}", { first: day(u.firstSignInAt), last: day(u.lastSignInAt) }) : t("Has not signed in yet")}
                {q?.lastAt ? ` · ${t("last quote shared {date}", { date: day(q.lastAt) })}` : ""}
                {trialNote ? ` · ${trialNote}` : ""}
                {u.libraryOptIn ? ` · ${t("shares photos with the library")}` : ""}
                {!u.libraryAccess ? ` · ${t("no library access")}`
                  : u.libraryOperators == null ? ` · ${t("can use the library (all operators)")}`
                  : ` · ${t("can use the library ({n} of {total} operators)", { n: u.libraryOperators.filter((id) => libOps.some((o) => o.id === id)).length, total: libOps.length })}`}
              </div>
              <div className="person-actions">
                {u.plan === "trial" && (
                  <form action={extendTrialAction} className="inline-form">
                    <Key /><input type="hidden" name="userId" value={u.id} />
                    <Choice name="days" defaultValue="14" ariaLabel={t("Days to add")} options={[{ value: "7", label: "+7" }, { value: "14", label: "+14" }, { value: "30", label: t("+30 days") }]} />
                    <button className="secondary small-btn" type="submit">{t("Extend trial")}</button>
                  </form>
                )}
                <form action={setLibraryAccessAction}><input type="hidden" name="userId" value={u.id} /><input type="hidden" name="on" value={u.libraryAccess ? "0" : "1"} />
                  <button className="secondary small-btn" type="submit">{u.libraryAccess ? t("Stop sharing the library") : t("Share the library")}</button></form>
                <form action={setPlanAction}><Key /><input type="hidden" name="userId" value={u.id} /><input type="hidden" name="plan" value={u.plan === "full" ? "trial" : "full"} />
                  <button className="secondary small-btn" type="submit">{u.plan === "full" ? t("Make trial") : t("Make full")}</button></form>
                <span className="spacer" />
                {u.firstSignInAt ? (
                  <form action={setBlockedAction}><Key /><input type="hidden" name="userId" value={u.id} /><input type="hidden" name="blocked" value={u.status === "blocked" ? "0" : "1"} />
                    <button className={`${u.status === "blocked" ? "secondary" : "danger"} small-btn`} type="submit">{u.status === "blocked" ? t("Turn on") : t("Turn off")}</button></form>
                ) : (
                  <form action={withdrawInviteAction}><Key /><input type="hidden" name="userId" value={u.id} /><button className="danger small-btn" type="submit">{t("Withdraw invite")}</button></form>
                )}
              </div>
              {u.libraryAccess && libOps.length > 0 && (
                <details className="lib-ops">
                  <summary className="small">{t("Choose which library operators they see")}</summary>
                  <form action={setLibraryOperatorsAction}>
                    <input type="hidden" name="userId" value={u.id} />
                    <div className="lib-ops-mode small">
                      <label><input type="radio" name="mode" value="all" defaultChecked={u.libraryOperators == null} /> {t("All operators (new ones too)")}</label>
                      <label><input type="radio" name="mode" value="chosen" defaultChecked={u.libraryOperators != null} /> {t("Only the ones ticked below")}</label>
                    </div>
                    <div className="lib-ops-list">
                      {libOps.map((o) => (
                        <label key={o.id} className="small"><input type="checkbox" name="op" value={o.id} defaultChecked={u.libraryOperators == null || u.libraryOperators.includes(o.id)} /> {o.name}</label>
                      ))}
                    </div>
                    <button className="secondary small-btn" type="submit">{t("Save")}</button>
                  </form>
                </details>
              )}
            </div>
          );
        })}
      </div>
      <div className="grid g2">
        <form action={inviteUserAction} className="card">
          <h3>{t("Invite someone")}</h3>
          <p className="muted small">{t("They sign in with this Google account and get their own empty workspace. Their {n} days start at their first sign-in. Their uploads go to the same Google Drive as yours.", { n: TRIAL_DAYS })}</p>
          <Key />
          <label htmlFor="inv-email">{t("Google email")}</label>
          <input id="inv-email" name="email" type="email" required placeholder="name@company.com" />
          <label htmlFor="inv-name">{t("Name (optional)")}</label>
          <input id="inv-name" name="name" />
          <label>{t("Access")}</label>
          <Choice name="plan" defaultValue="trial" ariaLabel={t("Access")} options={[{ value: "trial", label: t("{n}-day trial", { n: TRIAL_DAYS }) }, { value: "full", label: t("Full (no time limit)") }]} />
          <div style={{ marginTop: 10 }}><button type="submit">{t("Invite")}</button></div>
        </form>
        <div className="card">
          <h3>{t("How access works")}</h3>
          <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
            <li>{t("Each person sees only their own operators, aircraft, photos, contacts and quotes.")}</li>
            <li>{t("When a trial ends their workspace becomes read-only: they can still look and share, but not upload or change anything, until you extend it.")}</li>
            <li>{t("Turning access off keeps their work; turning it back on restores it.")}</li>
            <li>{t("“Look” opens their workspace read-only for you. Use “Back to my workspace” at the top to return.")}</li>
          </ul>
        </div>
      </div>
    </>
  );
}
