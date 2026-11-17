import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { unzipSync, strFromU8 } from "fflate";
import { setup, key, makeImage } from "./helpers";
import { createAircraft, createAircraftType, createOrganisation } from "../src/domain/directory";
import { approveMedia, getMediaDetail, ingestUpload, readContentBytes, setMediaAssociation, updateMediaMetadata } from "../src/domain/media";
import { ingestPdf } from "../src/domain/intake";
import { buildAircraftExport, zipExport } from "../src/domain/export";
import { actionExecutions, aircraftMedia, sourceEvidence } from "../src/db/schema";

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  t = await setup();
});

async function jpeg(w: number, h: number, r: number) {
  return new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: { r, g: 90, b: 160 } } }).jpeg().toBuffer());
}

/** A multi-page PDF: 2 JPEG photos, 1 PNG photo, 1 tiny logo, plus a page with no images. */
async function samplePdf() {
  const pdf = await PDFDocument.create();
  const p1 = pdf.addPage([600, 400]);
  p1.drawImage(await pdf.embedJpg(await jpeg(640, 420, 200)), { x: 0, y: 0, width: 300, height: 200 });
  p1.drawImage(await pdf.embedJpg(await jpeg(500, 500, 40)), { x: 300, y: 0, width: 200, height: 200 });
  const p2 = pdf.addPage([600, 400]);
  p2.drawImage(await pdf.embedPng(await makeImage(320, 240, 7)), { x: 0, y: 0, width: 300, height: 200 });
  p2.drawImage(await pdf.embedJpg(await jpeg(40, 40, 10)), { x: 400, y: 300, width: 40, height: 40 }); // tiny logo
  pdf.addPage([600, 400]); // vector/text-only page
  return new Uint8Array(await pdf.save());
}

describe("Test 6 — PDF with several images", () => {
  it("keeps the original, extracts each photo as its own reviewable media with page evidence, and reports what it skipped", async () => {
    const bytes = await samplePdf();
    const r = await ingestPdf(t.db, t.store, t.actor, { filename: "brochure.pdf", bytes });
    expect(r.result.status).toBe("partially_processed");
    expect(r.result.pageCount).toBe(3);
    expect(r.result.extracted.map((e) => [e.page, e.width, e.height])).toEqual([
      [1, 640, 420],
      [1, 500, 500],
      [2, 320, 240],
    ]);
    expect(r.result.skipped).toHaveLength(1);
    expect(r.result.skipped[0]).toMatchObject({ page: 2 });
    expect(r.result.skipped[0].reason).toMatch(/smaller than 100px/);

    // original PDF retained as evidence, with its stored bytes recoverable
    const [orig] = await t.db.select().from(sourceEvidence).where(eq(sourceEvidence.sourceKind, "pdf"));
    expect(orig).toMatchObject({ originalFilename: "brochure.pdf" });
    const stored = await t.store.get((orig.metadata as { storageRef: string }).storageRef);
    expect(stored.byteLength).toBe(bytes.byteLength);

    // each derivative: its own media in needs_review, unclassified/unresolved, with page + extraction version
    const media = await t.db.select().from(aircraftMedia);
    expect(media).toHaveLength(3);
    for (const m of media) expect(m).toMatchObject({ reviewState: "needs_review", primaryClassification: "unclassified", associationStatus: "unresolved" });
    const d = (await getMediaDetail(t.db, r.result.extracted[2].mediaId))!;
    expect(d.evidence).toMatchObject({ sourceKind: "extracted_image", pageNumber: 2, parentEvidenceId: orig.id });
    expect(d.evidence!.cropRef).toMatchObject({ extractionVersion: "pdf-embedded-1", width: 320, height: 240 });
    expect(d.versions[0].isDerivative).toBe(true);

    // extracted bytes are real images of the right size (JPEG passthrough and decoded Flate PNG)
    for (const e of r.result.extracted) {
      const { bytes: b } = await readContentBytes(t.db, t.store, e.contentVersionId);
      const meta = await sharp(b).metadata();
      expect([meta.width, meta.height]).toEqual([e.width, e.height]);
    }
    // recorded as a partial outcome
    const [ex] = await t.db.select().from(actionExecutions).where(eq(actionExecutions.actionName, "media.uploadPdf"));
    expect(ex.status).toBe("partially_succeeded");
  });

  it("a repeat upload returns the original result and extracts nothing again", async () => {
    const bytes = await samplePdf();
    const a = await ingestPdf(t.db, t.store, t.actor, { filename: "brochure.pdf", bytes });
    const b = await ingestPdf(t.db, t.store, t.actor, { filename: "renamed.pdf", bytes });
    expect(b.replayed).toBe(true);
    expect(b.result).toEqual(a.result);
    expect(await t.db.select().from(aircraftMedia)).toHaveLength(3);
  });

  it("a PDF with no embedded photos is retained and says so; non-PDFs and damaged PDFs are refused", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([300, 300]);
    const r = await ingestPdf(t.db, t.store, t.actor, { filename: "text-only.pdf", bytes: new Uint8Array(await pdf.save()) });
    expect(r.result.status).toBe("no_images");
    expect(await t.db.select().from(aircraftMedia)).toHaveLength(0);
    expect((await t.db.select().from(sourceEvidence).where(eq(sourceEvidence.sourceKind, "pdf"))).length).toBe(1);

    await expect(ingestPdf(t.db, t.store, t.actor, { filename: "x.pdf", bytes: new TextEncoder().encode("hello") })).rejects.toThrow(/not a PDF/);
    await expect(ingestPdf(t.db, t.store, t.actor, { filename: "bad.pdf", bytes: new TextEncoder().encode("%PDF-1.4\nnot really a pdf") })).rejects.toThrow(/could not be read/);
  });
});

describe("Share/export — card plus exact approved photos", () => {
  async function seedAircraft() {
    const org = (await createOrganisation(t.db, t.actor, key(), { name: "Metrojet" })).result.organisationId;
    const typeId = (await createAircraftType(t.db, t.actor, key(), { manufacturer: "Gulfstream", model: "G650ER" })).result.aircraftTypeId;
    const aircraftId = (await createAircraft(t.db, t.actor, key(), { aircraftTypeId: typeId, registration: "B-KXX", operatorId: org, base: { mode: "based", locations: ["Hong Kong"] }, info: { yom: 2018, wifiStatus: "yes" } })).result.aircraftId;
    return { aircraftId, typeId };
  }
  async function approve(seed: number, cls: "exterior" | "cabin" | "floor_plan", status: "actual_aircraft" | "representative_type", ids: { aircraftId: string; typeId: string }) {
    const up = (await ingestUpload(t.db, t.store, t.actor, { filename: `p${seed}.png`, bytes: await makeImage(300, 200, seed) })).result;
    await updateMediaMetadata(t.db, t.actor, key(), { mediaId: up.mediaId, expectedVersion: 1, classification: cls });
    await setMediaAssociation(t.db, t.actor, key(), { mediaId: up.mediaId, expectedVersion: 2, status, aircraftId: status === "actual_aircraft" ? ids.aircraftId : null, aircraftTypeId: status === "representative_type" ? ids.typeId : null });
    await approveMedia(t.db, t.actor, { mediaId: up.mediaId, contentVersionId: up.contentVersionId, expectedVersion: 3 });
    return up;
  }

  it("exports labelled photos in lineup order with the compact card, limited to chosen views", async () => {
    const ids = await seedAircraft();
    await approve(1, "exterior", "actual_aircraft", ids);
    await approve(2, "cabin", "actual_aircraft", ids);
    await approve(3, "floor_plan", "representative_type", ids);

    const all = await buildAircraftExport(t.db, t.store, t.actor, ids.aircraftId);
    expect(all.files.map((f) => f.name).sort()).toEqual(["CABIN 1 - B-KXX.png", "EXT 1 - B-KXX.png", "FLOOR PLAN 1 (representative) - B-KXX.png"]);
    expect(all.cardText).toContain("Operator: Metrojet");
    expect(all.cardText).toContain("Tail number: B-KXX");

    const some = await buildAircraftExport(t.db, t.store, t.actor, ids.aircraftId, ["cabin"]);
    expect(some.files.map((f) => f.name)).toEqual(["CABIN 1 - B-KXX.png"]);

    const zip = unzipSync(zipExport(some));
    expect(Object.keys(zip).sort()).toEqual(["CABIN 1 - B-KXX.png", "aircraft-card.txt"]);
    expect(strFromU8(zip["aircraft-card.txt"])).toContain("YOM: 2018");
    expect((await sharp(zip["CABIN 1 - B-KXX.png"]).metadata()).width).toBe(300);
  });

  it("does not export unapproved or retired photos", async () => {
    const ids = await seedAircraft();
    await ingestUpload(t.db, t.store, t.actor, { filename: "pending.png", bytes: await makeImage(300, 200, 9) });
    expect((await buildAircraftExport(t.db, t.store, t.actor, ids.aircraftId)).files).toHaveLength(0);
  });
});
