import { beforeEach, describe, expect, it } from "vitest";
import { setup, key, makeImage } from "./helpers";
import { FakeDrive, ROOT_ID } from "./fakeDrive";
import { createAircraft, createAircraftType, createOrganisation, setAircraftTypeCategory } from "../src/domain/directory";
import { approveMedia, getMediaDetail, ingestUpload, retireMedia, setMediaAssociation, updateMediaMetadata } from "../src/domain/media";
import { buildExportCsv, exportRootFor, exportToDrive, typeToken } from "../src/domain/cbosExport";
import type { Classification } from "../src/domain/constants";

let t: Awaited<ReturnType<typeof setup>>;
let drive: FakeDrive;
let acId: string;
let typeId: string;

beforeEach(async () => {
  t = await setup();
  drive = new FakeDrive();
  const org = (await createOrganisation(t.db, t.actor, key(), { name: "Metrojet" })).result.organisationId;
  typeId = (await createAircraftType(t.db, t.actor, key(), { manufacturer: "Bombardier", model: "Challenger 650" })).result.aircraftTypeId;
  await setAircraftTypeCategory(t.db, t.actor, key(), { aircraftTypeId: typeId, category: "heavy_jet" });
  acId = (await createAircraft(t.db, t.actor, key(), { aircraftTypeId: typeId, registration: "B-KXX", operatorId: org, info: { yom: 2018, yor: null, capacity: 12, wifiStatus: "yes", notes: null } })).result.aircraftId;
});

async function approved(seed: number, cls: Classification, as: "actual" | "type") {
  const r = (await ingestUpload(t.db, t.store, t.actor, { filename: `IMG_${seed}.png`, bytes: await makeImage(400, 300, seed) })).result;
  let v = (await getMediaDetail(t.db, t.actor.tenantId, r.mediaId))!.media.version;
  await updateMediaMetadata(t.db, t.actor, key(), { mediaId: r.mediaId, expectedVersion: v, classification: cls });
  v++;
  await setMediaAssociation(t.db, t.actor, key(), as === "actual" ? { mediaId: r.mediaId, expectedVersion: v, status: "actual_aircraft", aircraftId: acId } : { mediaId: r.mediaId, expectedVersion: v, status: "representative_type", aircraftTypeId: typeId });
  const d = (await getMediaDetail(t.db, t.actor.tenantId, r.mediaId))!;
  await approveMedia(t.db, t.actor, { mediaId: r.mediaId, contentVersionId: d.media.currentContentVersionId!, expectedVersion: d.media.version });
  return r.mediaId;
}

/** Every live file under the root as "folder/…/name". */
function tree(): string[] {
  const out: string[] = [];
  const walk = (id: string, path: string) => {
    for (const c of drive.childrenOf(id)) {
      const p = path ? `${path}/${c.name}` : c.name;
      if (c.mimeType.includes("folder")) walk(c.id, p);
      else out.push(p);
    }
  };
  walk(ROOT_ID, "");
  return out.sort();
}

describe("CBOS export (copies with CBOS names plus a data sheet)", () => {
  it("files approved photos in CBOS's layouts and writes a sheet with the stable IDs", async () => {
    expect(typeToken("Bombardier", "Challenger 650")).toBe("BOMBARDIER_CHALLENGER_650");
    const ext = await approved(1, "exterior", "actual");
    await approved(2, "cabin", "actual");
    await approved(3, "cabin", "actual");
    await approved(4, "floor_plan", "type");

    const s = await exportToDrive(t.db, drive.client(), t.store, t.actor.tenantId, exportRootFor(true, "owner@example.test"));
    expect(s).toMatchObject({ added: 4, failed: [] });
    expect(tree()).toEqual([
      "CBOS Export/Operator Aircraft/Metrojet/B-KXX/Exterior_01.png",
      "CBOS Export/Operator Aircraft/Metrojet/B-KXX/Interior_01.png",
      "CBOS Export/Operator Aircraft/Metrojet/B-KXX/Interior_02.png",
      "CBOS Export/Private Aircraft/Heavy Jets/BOMBARDIER_CHALLENGER_650_Floorplan_01.png",
      "CBOS Export/aircraft-media.csv",
    ]);

    const csv = await buildExportCsv(t.db, t.actor.tenantId);
    const [head, ...lines] = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(head.split(",").slice(0, 8)).toEqual(["media_id", "media_reference", "content_version_id", "content_sha256", "classification", "display_label", "association", "aircraft_id"]);
    const extLine = lines.find((l) => l.startsWith(ext))!;
    expect(extLine).toContain(",exterior,EXT 1,actual_aircraft,");
    expect(extLine).toContain(",B-KXX,");
    expect(extLine).toContain(",Metrojet,");
    expect(extLine).toContain("CBOS Export/Operator Aircraft/Metrojet/B-KXX/Exterior_01.png");

    // Running again changes nothing; retiring a photo bins its copy and renumbers nothing else.
    expect(await exportToDrive(t.db, drive.client(), t.store, t.actor.tenantId, ["CBOS Export"])).toMatchObject({ added: 0, unchanged: 4 });
    await retireMedia(t.db, t.actor, key(), { mediaId: ext });
    expect(await exportToDrive(t.db, drive.client(), t.store, t.actor.tenantId, ["CBOS Export"])).toMatchObject({ removed: 1, unchanged: 3 });
    expect(tree()).not.toContain("CBOS Export/Operator Aircraft/Metrojet/B-KXX/Exterior_01.png");
  });

  it("puts other users' exports in their own folder", () => {
    expect(exportRootFor(false, "broker@example.com")).toEqual(["CBOS Export", "Users", "broker@example.com"]);
  });
});
