import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setup, key, makeImage } from "./helpers";
import { aircraftMedia } from "../src/db/schema";
import { createAircraft, createAircraftType } from "../src/domain/directory";
import { approveMedia, ingestUpload, rejectMedia, setMediaAssociation, updateMediaMetadata } from "../src/domain/media";
import { bringBackForReview } from "../src/domain/intake";

describe("Sending photos again", () => {
  it("brings a removed photo back to Review and reports an approved one with its aircraft", async () => {
    const t = await setup();
    const ver = async (id: string) => (await t.db.select({ v: aircraftMedia.version }).from(aircraftMedia).where(eq(aircraftMedia.id, id)))[0].v;
    const removed = (await ingestUpload(t.db, t.store, t.actor, { filename: "a.png", bytes: await makeImage(400, 300, 1201) })).result;
    await rejectMedia(t.db, t.actor, key(), { mediaId: removed.mediaId, expectedVersion: await ver(removed.mediaId), reason: "Removed in Review" });

    const type = (await createAircraftType(t.db, t.actor, key(), { manufacturer: "Gulfstream", model: "G550", category: "ultra_long_range_jet" })).result.aircraftTypeId;
    const ac = (await createAircraft(t.db, t.actor, key(), { aircraftTypeId: type, registration: "N818CJ" })).result.aircraftId;
    const done = (await ingestUpload(t.db, t.store, t.actor, { filename: "b.png", bytes: await makeImage(400, 300, 1202) })).result;
    await updateMediaMetadata(t.db, t.actor, key(), { mediaId: done.mediaId, expectedVersion: await ver(done.mediaId), classification: "exterior" });
    await setMediaAssociation(t.db, t.actor, key(), { mediaId: done.mediaId, expectedVersion: await ver(done.mediaId), status: "actual_aircraft", aircraftId: ac });
    await approveMedia(t.db, t.actor, { mediaId: done.mediaId, contentVersionId: done.contentVersionId, expectedVersion: await ver(done.mediaId) });
    const waiting = (await ingestUpload(t.db, t.store, t.actor, { filename: "c.png", bytes: await makeImage(400, 300, 1203) })).result;

    // The same three files sent again: reused, not copied.
    const again = await Promise.all([1201, 1202, 1203].map(async (s, i) => (await ingestUpload(t.db, t.store, t.actor, { filename: `${i}.png`, bytes: await makeImage(400, 300, s) }))));
    expect(again.every((r) => r.replayed)).toBe(true);
    const st = await bringBackForReview(t.db, t.actor, again.map((r) => r.result.mediaId));
    expect(st.reopened).toEqual([removed.mediaId]);
    expect(st.waiting).toEqual([waiting.mediaId]);
    expect(st.approved).toEqual([{ mediaId: done.mediaId, aircraftId: ac }]);
    const [m] = await t.db.select().from(aircraftMedia).where(eq(aircraftMedia.id, removed.mediaId));
    expect(m.reviewState).toBe("needs_review");
  });
});
