import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { setup, key, makeImage } from "./helpers";
import { FakeDrive, OTHER_ID, ROOT_ID } from "./fakeDrive";
import { DriveFileStore } from "../src/storage/drive";
import { StorageRouter } from "../src/storage";
import { importDriveFolder, parseFolderRef } from "../src/domain/driveImport";
import { aircraftMedia, driveSyncState, mediaContentVersions, sourceEvidence } from "../src/db/schema";
import { createAircraft, createAircraftType } from "../src/domain/directory";
import { approveMedia, readContentBytes, setMediaAssociation, updateMediaMetadata } from "../src/domain/media";
import { getCatalogue } from "../src/domain/catalogue";

let t: Awaited<ReturnType<typeof setup>>;
let drive: FakeDrive;
let store: StorageRouter;
let inbox: string;
let sub: string;

async function pdfWithPhotos() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([600, 400]);
  const jpg = await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 10, g: 120, b: 200 } } }).jpeg().toBuffer();
  page.drawImage(await pdf.embedJpg(jpg), { x: 0, y: 0, width: 300, height: 200 });
  return new Uint8Array(await pdf.save());
}

beforeEach(async () => {
  t = await setup();
  drive = new FakeDrive();
  store = new StorageRouter(new DriveFileStore(drive.client()));
  inbox = drive.addFolder("Inbox", ROOT_ID);
  drive.addFile("a.png", "image/png", await makeImage(400, 300, 1), inbox);
  drive.addFile("b.png", "image/png", await makeImage(400, 300, 2), inbox);
  drive.addFile("notes.txt", "text/plain", new TextEncoder().encode("hello"), inbox);
  sub = drive.addFolder("Gulfstream", inbox);
  drive.addFile("c.png", "image/png", await makeImage(400, 300, 3), sub);
  drive.addFile("brochure.pdf", "application/pdf", await pdfWithPhotos(), inbox);
});

describe("Drive import (mocked Drive API)", () => {
  it("imports photos and PDFs from the selected folder tree, in place, with per-item outcomes", async () => {
    const before = [...drive.nodes.keys()].filter((id) => !id.startsWith("ROOT") && !id.startsWith("OTHER"));
    const s = await importDriveFolder(t.db, drive.client(), store, t.actor, `https://drive.google.com/drive/folders/${inbox}`);
    expect(s).toMatchObject({ imported: 4, alreadyImported: 0, unsupported: 1, failed: 0, truncated: false, folderName: "Inbox" });

    // 3 photos + 1 extracted from the PDF, all awaiting review and unresolved
    const media = await t.db.select().from(aircraftMedia);
    expect(media).toHaveLength(4);
    expect(media.every((m) => m.reviewState === "needs_review" && m.associationStatus === "unresolved")).toBe(true);

    // originals are referenced in place: same Drive file IDs, never moved or copied
    const versions = await t.db.select().from(mediaContentVersions);
    const direct = versions.filter((v) => !v.isDerivative);
    expect(direct).toHaveLength(3);
    for (const v of direct) {
      expect(v.storageKind).toBe("drive");
      expect([inbox, sub]).toContain(drive.nodes.get(v.storageRef)!.parents![0]); // still where the owner put it
      expect(v.driveRevision).toBe("rev-1");
    }
    for (const id of before) expect(drive.nodes.get(id)!.parents?.[0]).toBeDefined(); // nothing removed/moved
    // the PDF-extracted derivative was written under Processing/ in the root
    const processing = drive.childrenOf(ROOT_ID).find((f) => f.name === "Processing")!;
    expect(drive.childrenOf(processing.id)).toHaveLength(1);
    const pdfEv = (await t.db.select().from(sourceEvidence).where(eq(sourceEvidence.sourceKind, "pdf")))[0];
    expect(pdfEv.originalDriveFileId).toBeTruthy();

    // sync state recorded
    expect((await t.db.select().from(driveSyncState))[0]).toMatchObject({ folderId: inbox, folderName: "Inbox" });
  });

  it("Test 4 (Drive): importing the same folder again does nothing — no downloads, no duplicates", async () => {
    await importDriveFolder(t.db, drive.client(), store, t.actor, inbox);
    const downloadsAfterFirst = drive.downloads.length;
    const again = await importDriveFolder(t.db, drive.client(), store, t.actor, inbox);
    expect(again).toMatchObject({ imported: 0, alreadyImported: 4, failed: 0 });
    expect(drive.downloads.length).toBe(downloadsAfterFirst); // skipped before download
    expect(await t.db.select().from(aircraftMedia)).toHaveLength(4);
  });

  it("imports an edited file (new revision) as new content and leaves unchanged files alone", async () => {
    await importDriveFolder(t.db, drive.client(), store, t.actor, inbox);
    const a = [...drive.nodes.values()].find((n) => n.name === "a.png")!;
    drive.editFile(a.id, await makeImage(500, 400, 9));
    const s = await importDriveFolder(t.db, drive.client(), store, t.actor, inbox);
    expect(s).toMatchObject({ imported: 1, alreadyImported: 3 });
    expect(await t.db.select().from(aircraftMedia)).toHaveLength(5);
  });

  it("one failing file does not block the others, and a retry only repeats the failed one", async () => {
    const b = [...drive.nodes.values()].find((n) => n.name === "b.png")!;
    drive.failDownload.add(b.id);
    const first = await importDriveFolder(t.db, drive.client(), store, t.actor, inbox);
    expect(first).toMatchObject({ imported: 3, failed: 1 });
    expect(first.items.find((i) => i.outcome === "failed")!.name).toBe("b.png");

    drive.failDownload.clear();
    const downloadsBefore = drive.downloads.length;
    const retry = await importDriveFolder(t.db, drive.client(), store, t.actor, inbox);
    expect(retry).toMatchObject({ imported: 1, alreadyImported: 3, failed: 0 });
    expect(drive.downloads.length - downloadsBefore).toBe(1);
    expect(await t.db.select().from(aircraftMedia)).toHaveLength(4);
  });

  it("refuses folders outside the Aircraft Media root and bad references", async () => {
    await expect(importDriveFolder(t.db, drive.client(), store, t.actor, OTHER_ID)).rejects.toThrow(/not inside the Aircraft Media/);
    await expect(importDriveFolder(t.db, drive.client(), store, t.actor, "nope")).rejects.toThrow(/folder link or ID/);
    expect(parseFolderRef("https://drive.google.com/drive/folders/1KaOTmLDTrSg5lanEPuw3jppU0ZsOK6sn?usp=sharing")).toBe("1KaOTmLDTrSg5lanEPuw3jppU0ZsOK6sn");
  });
});

describe("Drive storage", () => {
  it("files new bytes under Sources/ and Processing/, creating each folder once", async () => {
    const ds = new DriveFileStore(drive.client());
    const a = await ds.put(new Uint8Array([1, 2, 3]), "one.bin", "Sources", "application/octet-stream");
    const b = await ds.put(new Uint8Array([4, 5]), "two.bin", "Sources");
    await ds.put(new Uint8Array([6]), "d.bin", "Processing");
    expect(drive.childrenOf(ROOT_ID).filter((f) => f.name === "Sources")).toHaveLength(1);
    expect(Array.from(await ds.get(a))).toEqual([1, 2, 3]);
    expect(Array.from(await ds.get(b))).toEqual([4, 5]);
  });

  it("refreshes the access token once and reuses it", async () => {
    const client = drive.client();
    await client.getFile(ROOT_ID);
    await client.listChildren(ROOT_ID);
    expect(drive.tokenCalls).toBe(1);
  });

  it("Test 11 (Drive): a file removed from Drive is detected on read and no longer counts as available", async () => {
    // import one photo, make it an approved actual photo of an aircraft
    const solo = drive.addFolder("Solo", ROOT_ID);
    const fileId = drive.addFile("cabin.png", "image/png", await makeImage(400, 300, 4), solo);
    const s = await importDriveFolder(t.db, drive.client(), store, t.actor, solo);
    const mediaId = s.items[0].mediaIds![0];
    const typeId = (await createAircraftType(t.db, t.actor, key(), { manufacturer: "Gulfstream", model: "G650ER" })).result.aircraftTypeId;
    const acId = (await createAircraft(t.db, t.actor, key(), { aircraftTypeId: typeId, registration: "B-KXX" })).result.aircraftId;
    await updateMediaMetadata(t.db, t.actor, key(), { mediaId, expectedVersion: 1, classification: "interior" });
    await setMediaAssociation(t.db, t.actor, key(), { mediaId, expectedVersion: 2, status: "actual_aircraft", aircraftId: acId });
    const cv = (await t.db.select().from(mediaContentVersions).where(eq(mediaContentVersions.aircraftMediaId, mediaId)))[0];
    await approveMedia(t.db, t.actor, { mediaId, contentVersionId: cv.id, expectedVersion: 3 });
    expect((await getCatalogue(t.db, t.actor.tenantId))[0].cells.interior.status).toBe("actual_available");
    expect((await readContentBytes(t.db, store, cv.id)).bytes.byteLength).toBeGreaterThan(0);

    drive.remove(fileId); // gone from Drive
    await expect(readContentBytes(t.db, store, cv.id)).rejects.toThrow(/could not be retrieved/);
    const row = (await getCatalogue(t.db, t.actor.tenantId))[0];
    expect(row.cells.interior.status).toBe("unavailable");
    expect(row.status).toBe("unavailable");
  });
});
