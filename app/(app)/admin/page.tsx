import { asc, count, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { aircraft, aircraftMedia, organisations, users } from "@/db/schema";
import { requireAdmin } from "@/lib/session";
import { TRIAL_DAYS, accessFor } from "@/domain/accounts";
import { quoteShareStats, type QuoteShareStats } from "@/domain/quoteShares";
import {
  extendTrialAction, inviteUserAction, setBlockedAction, setPlanAction, viewAsAction, withdrawInviteAction,
} from "../../actions";
import { Flash, Key, one, type SP } from "../../_components/ui";
import Choice from "../../_components/Choice";

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "–");
const quotesLine = (q: QuoteShareStats | undefined) =>
  `${q?.quotes ?? 0} quote${q?.quotes === 1 ? "" : "s"} shared${q?.last30 ? ` (${q.last30} in the last 30 days)` : ""}`;

/** Platform admin: invite people, see how their trials stand and how much they use it, extend or turn off access, and look at a workspace. */
export default async function Admin({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const me = await requireAdmin();
  const db = await getDb();
  const people = (await db.select().from(users).orderBy(asc(users.createdAt))).filter((u) => u.id !== me.actor.id && u.email !== me.email);
  const toMap = (rows: { t: string; n: number }[]) => new Map(rows.map((r) => [r.t, Number(r.n)]));
  const photos = toMap(await db.select({ t: aircraftMedia.tenantId, n: count() }).from(aircraftMedia).where(eq(aircraftMedia.lifecycleState, "active")).groupBy(aircraftMedia.tenantId));
  const planes = toMap(await db.select({ t: aircraft.tenantId, n: count() }).from(aircraft).where(eq(aircraft.active, true)).groupBy(aircraft.tenantId));
  const ops = toMap(await db.select({ t: organisations.tenantId, n: count() }).from(organisations).where(eq(organisations.active, true)).groupBy(organisations.tenantId));
  const shares = await quoteShareStats(db);
  const mine = me.viewingAs ? undefined : shares.get(me.actor.tenantId);

  return (
    <>
      <h1>Users</h1>
      <Flash error={one(sp.error)} ok={one(sp.ok)} />
      <div className="card">
        <div className="people-head">
          <h3 style={{ margin: 0 }}>People ({people.length})</h3>
          {!me.viewingAs && <span className="small muted">Your own workspace: {quotesLine(mine)}</span>}
        </div>
        <p className="small muted" style={{ margin: "4px 0 6px" }}>
          A quote counts as shared when the phone&apos;s share sheet hands it to an app, or its message is copied. Sharing the same quote again, or option by option, counts once. The phone cannot tell whether it was then sent.
        </p>
        {people.length === 0 ? <p className="muted">Nobody invited yet.</p> : people.map((u) => {
          const a = accessFor(u);
          const status =
            u.status === "blocked" ? { label: "Turned off", tone: "off" }
            : !u.firstSignInAt ? { label: "Invited, not signed in yet", tone: "wait" }
            : u.plan === "full" ? { label: "Full access", tone: "ok" }
            : a.expired ? { label: "Trial ended (read-only)", tone: "off" }
            : { label: `Trial · ${a.daysLeft} day${a.daysLeft === 1 ? "" : "s"} left`, tone: a.daysLeft != null && a.daysLeft <= 3 ? "warn" : "ok" };
          const trialNote = u.plan !== "trial" ? null
            : u.trialEndsAt ? `trial ${a.expired ? "ended" : "ends"} ${day(u.trialEndsAt)}`
            : `${TRIAL_DAYS}-day trial starts at first sign-in`;
          const q = shares.get(u.tenantId);
          return (
            <div key={u.id} className="person">
              <div className="person-head">
                <div style={{ minWidth: 0 }}>
                  <b>{u.displayName}</b> <span className={`pill ${status.tone}`}>{status.label}</span>
                  <div className="small muted">{u.email}</div>
                </div>
                {u.firstSignInAt && (
                  <form action={viewAsAction}><input type="hidden" name="userId" value={u.id} /><button className="secondary small-btn" type="submit">Look</button></form>
                )}
              </div>
              <div className="stats">
                <div className="stat"><span className="stat-n">{q?.quotes ?? 0}</span><span className="stat-l">quotes shared{q?.last30 ? ` · ${q.last30} in 30 days` : ""}</span></div>
                <div className="stat"><span className="stat-n">{photos.get(u.tenantId) ?? 0}</span><span className="stat-l">photos</span></div>
                <div className="stat"><span className="stat-n">{planes.get(u.tenantId) ?? 0}</span><span className="stat-l">aircraft</span></div>
                <div className="stat"><span className="stat-n">{ops.get(u.tenantId) ?? 0}</span><span className="stat-l">operators</span></div>
              </div>
              <div className="small muted">
                {u.firstSignInAt ? `Signed in first ${day(u.firstSignInAt)}, last ${day(u.lastSignInAt)}` : "Has not signed in yet"}
                {q?.lastAt ? ` · last quote shared ${day(q.lastAt)}` : ""}
                {trialNote ? ` · ${trialNote}` : ""}
                {u.libraryOptIn ? " · shares photos with the library" : ""}
              </div>
              <div className="person-actions">
                {u.plan === "trial" && (
                  <form action={extendTrialAction} className="inline-form">
                    <Key /><input type="hidden" name="userId" value={u.id} />
                    <Choice name="days" defaultValue="14" ariaLabel="Days to add" options={[{ value: "7", label: "+7" }, { value: "14", label: "+14" }, { value: "30", label: "+30 days" }]} />
                    <button className="secondary small-btn" type="submit">Extend trial</button>
                  </form>
                )}
                <form action={setPlanAction}><Key /><input type="hidden" name="userId" value={u.id} /><input type="hidden" name="plan" value={u.plan === "full" ? "trial" : "full"} />
                  <button className="secondary small-btn" type="submit">{u.plan === "full" ? "Make trial" : "Make full"}</button></form>
                <span className="spacer" />
                {u.firstSignInAt ? (
                  <form action={setBlockedAction}><Key /><input type="hidden" name="userId" value={u.id} /><input type="hidden" name="blocked" value={u.status === "blocked" ? "0" : "1"} />
                    <button className={`${u.status === "blocked" ? "secondary" : "danger"} small-btn`} type="submit">{u.status === "blocked" ? "Turn on" : "Turn off"}</button></form>
                ) : (
                  <form action={withdrawInviteAction}><Key /><input type="hidden" name="userId" value={u.id} /><button className="danger small-btn" type="submit">Withdraw invite</button></form>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="grid g2">
        <form action={inviteUserAction} className="card">
          <h3>Invite someone</h3>
          <p className="muted small">They sign in with this Google account and get their own empty workspace. Their {TRIAL_DAYS} days start at their first sign-in. Their uploads go to the same Google Drive as yours.</p>
          <Key />
          <label htmlFor="inv-email">Google email</label>
          <input id="inv-email" name="email" type="email" required placeholder="name@company.com" />
          <label htmlFor="inv-name">Name (optional)</label>
          <input id="inv-name" name="name" />
          <label>Access</label>
          <Choice name="plan" defaultValue="trial" ariaLabel="Access" options={[{ value: "trial", label: `${TRIAL_DAYS}-day trial` }, { value: "full", label: "Full (no time limit)" }]} />
          <div style={{ marginTop: 10 }}><button type="submit">Invite</button></div>
        </form>
        <div className="card">
          <h3>How access works</h3>
          <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
            <li>Each person sees only their own operators, aircraft, photos, contacts and quotes.</li>
            <li>When a trial ends their workspace becomes read-only: they can still look and share, but not upload or change anything, until you extend it.</li>
            <li>Turning access off keeps their work; turning it back on restores it.</li>
            <li>“Look” opens their workspace read-only for you. Use “Back to my workspace” at the top to return.</li>
          </ul>
        </div>
      </div>
    </>
  );
}
