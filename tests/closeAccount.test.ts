import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { setup, key, makeImage } from "./helpers";
import { accessFor } from "../src/domain/accounts";
import { cancelAccount, deleteAccount, reopenAccount } from "../src/domain/closeAccount";
import { createAircraft, createAircraftType, createOrganisation } from "../src/domain/directory";
import { approveMedia, getMediaDetail, ingestUpload, setMediaAssociation, updateMediaMetadata } from "../src/domain/media";
import { cleanSnapshot, saveQuoteVersion } from "../src/domain/requests";
import { ensureLink, openLink } from "../src/domain/quoteLinks";
import { saveConversation } from "../src/domain/toyMemory";
import { users } from "../src/db/schema";
import type { Actor } from "../src/domain/action";

const legs = [{ from: "VHHH", to: "EGLF", date: "2026-12-12", time: "16:30", flight: 765, pax: 4 }];

/** Rows left anywhere in the database for this workspace. */
async function leftFor(db: Awaited<ReturnType<typeof setup>>["db"], tenantId: string) {
  const rows = <R,>(r: unknown) => (r as { rows: R[] }).rows;
  const tables = rows<{ table_name: string }>(await db.execute(sql`select table_name from information_schema.columns where column_name = 'tenant_id' and table_schema = 'public'`));
  const left: Record<string, number> = {};
  for (const { table_name } of tables) {
    const r = rows<{ n: number }>(await db.execute(sql.raw(`select count(*)::int as n from "${table_name}" where tenant_id = '${tenantId}'`)));
    if (r[0].n) left[table_name] = r[0].n;
  }
  return left;
}

async function fullWorkspace(t: Awaited<ReturnType<typeof setup>>, me: Actor) {
  const org = (await createOrganisation(t.db, me, key(), { name: "Metrojet", aliases: ["MJ"] })).result.organisationId;
  const typeId = (await createAircraftType(t.db, me, key(), { manufacturer: "Gulfstream", model: "G280" })).result.aircraftTypeId;
  const acId = (await createAircraft(t.db, me, key(), { aircraftTypeId: typeId, registration: "B-KXX", operatorId: org, info: { yom: 2018, yor: null, capacity: 12, wifiStatus: "yes", notes: null } })).result.aircraftId;
  const r = (await ingestUpload(t.db, t.store, me, { filename: "IMG_1.png", bytes: await makeImage(400, 300, 5) })).result;
  let v = (await getMediaDetail(t.db, me.tenantId, r.mediaId))!.media.version;
  await updateMediaMetadata(t.db, me, key(), { mediaId: r.mediaId, expectedVersion: v, classification: "exterior" });
  v++;
  await setMediaAssociation(t.db, me, key(), { mediaId: r.mediaId, expectedVersion: v, status: "actual_aircraft", aircraftId: acId });
  const d = (await getMediaDetail(t.db, me.tenantId, r.mediaId))!;
  await approveMedia(t.db, me, { mediaId: r.mediaId, contentVersionId: d.media.currentContentVersionId!, expectedVersion: d.media.version });
  const snap = cleanSnapshot({ lang: "en", text: "Price: USD 95,000", greeting: "Hello", closing: "Thanks", options: [{ aircraftId: acId, type: "Gulfstream G280", price: "USD 95,000", photos: [] }], builder: { inc: { operator: false } } });
  const { requestId } = await saveQuoteVersion(t.db, me, null, legs, snap);
  const link = await ensureLink(t.db, me, requestId);
  await saveConversation(t.db, me.id, me.tenantId, { step: "x" }, [{ id: "m1", role: "user", text: "hello" }]);
  return { link };
}

describe("Closing an account", () => {
  it("cancel makes it read-only; they can reopen it", async () => {
    const t = await setup();
    const u = await cancelAccount(t.db, t.actor.id);
    expect(u.status).toBe("cancelled");
    expect(accessFor(u).readOnly).toBe(true);
    expect((await reopenAccount(t.db, t.actor.id)).status).toBe("active");
  });

  it("delete removes the whole workspace (and nobody else's), and its client links stop opening", async () => {
    const t = await setup();
    const mine: Actor = t.actor;
    const otherTenant = randomUUID();
    const [o] = await t.db.insert(users).values({ tenantId: otherTenant, email: "other@example.test", displayName: "Other" }).returning();
    const other: Actor = { id: o.id, tenantId: otherTenant };
    const { link } = await fullWorkspace(t, mine);
    await fullWorkspace(t, other);
    const before = await leftFor(t.db, mine.tenantId);
    expect(Object.keys(before).length).toBeGreaterThan(5);

    await expect(deleteAccount(t.db, mine.id, "wrong@example.test")).rejects.toThrow();
    const done = await deleteAccount(t.db, mine.id, " Owner@Example.test ");
    expect(done).toMatchObject({ workspace: true, aircraft: 1, photos: 1, quotes: 1 });
    expect(await leftFor(t.db, mine.tenantId)).toEqual({});
    expect(await openLink(t.db, link.token)).toBeNull();
    // The other workspace is untouched.
    expect(Object.keys(await leftFor(t.db, otherTenant)).length).toBe(Object.keys(before).length);
  });

  it("someone sharing a workspace leaves it; the workspace stays", async () => {
    const t = await setup();
    const [helper] = await t.db.insert(users).values({ tenantId: t.actor.tenantId, email: "helper@example.test", displayName: "Helper" }).returning();
    await fullWorkspace(t, t.actor);
    const done = await deleteAccount(t.db, helper.id, "helper@example.test");
    expect(done.workspace).toBe(false);
    expect(await t.db.select().from(users).where(eq(users.id, helper.id))).toHaveLength(0);
    expect((await leftFor(t.db, t.actor.tenantId)).aircraft).toBe(1);
  });
});
