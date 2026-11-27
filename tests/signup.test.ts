import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setup } from "./helpers";
import { TRIAL_DAYS, accessFor, approveApplication, declineApplication, recordSignIn } from "../src/domain/accounts";
import { startTrial } from "../src/domain/signup";
import { mayUseApp } from "../src/domain/signInLinks";
import { audienceOf, checkUnsubscribe, sendAnnouncement, sendDueEmails, setEmailOptOut, unsubscribeSig } from "../src/domain/userEmails";
import { activityByTenant, userOverview } from "../src/domain/adminStats";
import { announcements, users } from "../src/db/schema";
import type { Mail } from "../src/lib/mail";

const DAY = 86_400_000;
const SITE = "https://www.aircraftmedia.my";
let t: Awaited<ReturnType<typeof setup>>;
let outbox: Mail[];
const send = async (m: Mail) => { outbox.push(m); };
const to = (m: Mail) => (Array.isArray(m.to) ? m.to[0] : m.to);

beforeEach(async () => {
  t = await setup();
  outbox = [];
});

describe("Free trial sign-up", () => {
  it("makes an application, which can sign in once approved; the clock starts at first sign-in", async () => {
    const now = new Date("2026-12-01T00:00:00Z");
    const r = await startTrial(t.db, "  New.Broker@Example.com ", "New Broker", now);
    expect(r?.created).toBe(true);
    expect(r?.user).toMatchObject({ email: "new.broker@example.com", plan: "trial", status: "applied", libraryAccess: true, displayName: "New Broker", signupVia: "email" });
    expect(r?.user.trialEndsAt).toBeNull();
    expect(await mayUseApp(t.db, "new.broker@example.com")).toBe("pending"); // waiting for approval
    const approved = await approveApplication(t.db, "owner@example.test", r!.user.id);
    expect(approved.status).toBe("invited");
    expect(await mayUseApp(t.db, "new.broker@example.com")).toBe("ok");
    await expect(approveApplication(t.db, "owner@example.test", r!.user.id)).rejects.toThrow(/already handled/);
    const signedIn = await recordSignIn(t.db, approved, now);
    expect(signedIn.trialEndsAt?.getTime()).toBe(now.getTime() + TRIAL_DAYS * DAY);
    expect(accessFor(signedIn, new Date(now.getTime() + 15 * DAY)).readOnly).toBe(true); // look-only after day 14
  });

  it("does not make a second account, or one for a bad email", async () => {
    await startTrial(t.db, "a@example.com");
    expect((await startTrial(t.db, "A@example.com"))?.created).toBe(false);
    expect(await startTrial(t.db, "not an email")).toBeNull();
    expect((await t.db.select().from(users).where(eq(users.email, "a@example.com"))).length).toBe(1);
  });
});

describe("Declining an application", () => {
  it("removes it, so they can apply again", async () => {
    const r = await startTrial(t.db, "no@example.com", null, new Date(), "google");
    expect(r?.user.signupVia).toBe("google");
    await declineApplication(t.db, "owner@example.test", r!.user.id);
    expect(await mayUseApp(t.db, "no@example.com")).toBe("not_invited");
    expect((await startTrial(t.db, "no@example.com"))?.created).toBe(true);
  });
});

describe("Automatic emails", () => {
  it("welcomes a self sign-up once, after they sign in", async () => {
    const now = new Date("2026-12-01T00:00:00Z");
    const r = await startTrial(t.db, "w@example.com", "Wing", now);
    await sendDueEmails(t.db, SITE, send, now);
    expect(outbox).toHaveLength(0); // not signed in yet
    await recordSignIn(t.db, r!.user, now);
    await sendDueEmails(t.db, SITE, send, now);
    await sendDueEmails(t.db, SITE, send, now);
    expect(outbox.map((m) => m.subject)).toEqual(["Welcome to Aircraft Media: your 14-day trial has started"]);
    expect(outbox[0].text).toContain("Hi Wing,");
  });

  it("reminds 3 days before the end and on the day, once each, and retries a failed send", async () => {
    const start = new Date("2026-12-01T00:00:00Z");
    const r = await startTrial(t.db, "r@example.com", "Rae", start);
    await recordSignIn(t.db, r!.user, start);
    await t.db.update(users).set({ welcomedAt: start }).where(eq(users.id, r!.user.id));
    await sendDueEmails(t.db, SITE, send, new Date(start.getTime() + 5 * DAY));
    expect(outbox).toHaveLength(0);
    let fail = true;
    await sendDueEmails(t.db, SITE, async (m) => { if (fail) throw new Error("down"); outbox.push(m); }, new Date(start.getTime() + 11.5 * DAY));
    expect(outbox).toHaveLength(0);
    fail = false;
    await sendDueEmails(t.db, SITE, send, new Date(start.getTime() + 11.5 * DAY));
    await sendDueEmails(t.db, SITE, send, new Date(start.getTime() + 12 * DAY));
    expect(outbox.map((m) => m.subject)).toEqual(["Your Aircraft Media trial ends in 3 days"]);
    await sendDueEmails(t.db, SITE, send, new Date(start.getTime() + 14.2 * DAY));
    await sendDueEmails(t.db, SITE, send, new Date(start.getTime() + 15 * DAY));
    expect(outbox.map((m) => m.subject)).toEqual(["Your Aircraft Media trial ends in 3 days", "Your Aircraft Media trial has ended"]);
  });

  it("uses the payment link when there is one", async () => {
    const start = new Date("2026-12-01T00:00:00Z");
    const r = await startTrial(t.db, "p@example.com", "Pat", start);
    await recordSignIn(t.db, r!.user, start);
    process.env.PAYMENT_LINK = "https://buy.stripe.com/test_123";
    try {
      await sendDueEmails(t.db, SITE, send, new Date(start.getTime() + 13 * DAY));
    } finally {
      delete process.env.PAYMENT_LINK;
    }
    expect(outbox.find((m) => m.subject.includes("ends"))?.text).toContain("Choose a plan: https://buy.stripe.com/test_123");
  });
});

describe("Announcements", () => {
  it("goes to signed-in users who didn't opt out, with a working unsubscribe link", async () => {
    const now = new Date();
    const a = (await startTrial(t.db, "a@example.com", "A"))!.user;
    const b = (await startTrial(t.db, "b@example.com", "B"))!.user;
    await startTrial(t.db, "c@example.com", "C"); // never signed in
    await recordSignIn(t.db, a, now);
    await recordSignIn(t.db, b, now);
    await setEmailOptOut(t.db, b.id, true);
    expect((await audienceOf(t.db, "all", "owner@example.test")).map((u) => u.email)).toEqual(["a@example.com"]);
    await sendAnnouncement(t.db, SITE, send, { subject: "New: your own quote layout", body: "Upload a past quote.\n\nToy reads it.", audience: "all", adminId: a.id, adminEmail: "owner@example.test" }, 0);
    expect(outbox.map(to)).toEqual(["a@example.com"]);
    expect(outbox[0].text).toContain("Upload a past quote.\n\nToy reads it.");
    expect(outbox[0].text).toContain(`${SITE}/unsubscribe?u=${a.id}&s=${unsubscribeSig(a.id)}`);
    expect(checkUnsubscribe(a.id, unsubscribeSig(a.id))).toBe(true);
    expect(checkUnsubscribe(a.id, unsubscribeSig(b.id))).toBe(false);
    const [rec] = await t.db.select().from(announcements);
    expect(rec).toMatchObject({ recipients: 1, sent: 1, failed: 0 });
  });
});

describe("The admin's numbers", () => {
  it("counts people by state and new sign-ups", async () => {
    const now = new Date();
    await startTrial(t.db, "waiting@example.com", "W", now); // an application: not counted yet
    const a = await approveApplication(t.db, "owner@example.test", (await startTrial(t.db, "a@example.com", "A", now))!.user.id);
    await recordSignIn(t.db, a, now);
    const o = await userOverview(t.db, "owner@example.test", now);
    expect(o).toMatchObject({ trial: 1, signups7: 1, active30: 1 });
    expect((await activityByTenant(t.db)).get(a.tenantId)).toBeUndefined(); // nothing done yet
  });
});
