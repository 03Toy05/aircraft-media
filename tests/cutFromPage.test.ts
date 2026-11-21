import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { setup } from "./helpers";
import { ingestPdf } from "../src/domain/intake";
import { extractCropAsMedia, listWaitingGroups } from "../src/domain/media";

describe("Cutting photos out of a flat PDF page", () => {
  it("keeps the cut-outs in the page's Review set, with the text sent with the PDF", async () => {
    const t = await setup();
    // A brochure page saved as one picture: the photos are only parts of it.
    const page = new Uint8Array(await sharp({ create: { width: 1200, height: 1600, channels: 3, background: { r: 240, g: 240, b: 240 } } })
      .composite([{ input: await sharp({ create: { width: 600, height: 300, channels: 3, background: { r: 30, g: 90, b: 200 } } }).png().toBuffer(), left: 300, top: 300 }])
      .jpeg().toBuffer());
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]).drawImage(await doc.embedJpg(page), { x: 0, y: 0, width: 595, height: 842 });
    const r = await ingestPdf(t.db, t.store, t.actor, { filename: "G450.pdf", bytes: new Uint8Array(await doc.save()), cardText: "China Business Aviation Services Limited\nG450\nYOM 2012\n14 seats", batchId: "batch-1" });
    const pagePhoto = r.result.extracted[0];

    await extractCropAsMedia(t.db, t.store, t.actor, { mediaId: pagePhoto.mediaId, sourceContentVersionId: pagePhoto.contentVersionId, rect: { x: 300, y: 300, width: 600, height: 300 } });
    await extractCropAsMedia(t.db, t.store, t.actor, { mediaId: pagePhoto.mediaId, sourceContentVersionId: pagePhoto.contentVersionId, rect: { x: 0, y: 0, width: 500, height: 400 } });

    const groups = await listWaitingGroups(t.db, t.actor.tenantId);
    expect(groups).toHaveLength(1);
    expect(groups[0].photos).toHaveLength(3);
    expect(groups[0].evidenceText).toContain("YOM 2012");
  });
});
