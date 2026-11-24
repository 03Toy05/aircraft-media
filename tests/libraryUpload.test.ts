import { describe, expect, it } from "vitest";
import { adminActor, readPackFiles, uploadKeyMatches, uploadKeySet } from "../src/domain/libraryUpload";
import { setup } from "./helpers";

const KEY = "k".repeat(40);

describe("Library upload key", () => {
  it("is off without a long enough key, and only the exact key matches", () => {
    expect(uploadKeySet(undefined)).toBe(false);
    expect(uploadKeySet("short")).toBe(false);
    expect(uploadKeySet(KEY)).toBe(true);
    expect(uploadKeyMatches(KEY, undefined)).toBe(false); // no key on the site: nothing gets in
    expect(uploadKeyMatches("short", "short")).toBe(false); // a weak key never switches it on
    expect(uploadKeyMatches("", KEY)).toBe(false);
    expect(uploadKeyMatches(KEY + "x", KEY)).toBe(false);
    expect(uploadKeyMatches("K".repeat(40), KEY)).toBe(false);
    expect(uploadKeyMatches(KEY, KEY)).toBe(true);
  });

  it("imports as the admin, who must have signed in once", async () => {
    const t = await setup(); // owner@example.test exists
    expect(await adminActor(t.db, " Owner@Example.test ")).toEqual(t.actor);
    expect(await adminActor(t.db, "nobody@example.test")).toBeNull();
    expect(await adminActor(t.db, undefined)).toBeNull();
  });
});

describe("Reading an uploaded pack", () => {
  const file = (name: string, text: string) => new File([text], name);
  it("needs pack.json with an operator and aircraft, and keeps the photos by name", async () => {
    const pack = { operator: "Avcon Jet", aircraft: [{ type: "Gulfstream G650", photos: {} }] };
    const r = await readPackFiles([file("pack.json", JSON.stringify(pack)), file("a-ext.jpg", "jpg bytes"), "not a file"]);
    expect(r.pack.operator).toBe("Avcon Jet");
    expect([...r.files.keys()]).toEqual(["a-ext.jpg"]);

    await expect(readPackFiles([file("a-ext.jpg", "x")])).rejects.toThrow("pack.json");
    await expect(readPackFiles([file("pack.json", "{oops")])).rejects.toThrow("valid JSON");
    await expect(readPackFiles([file("pack.json", JSON.stringify({ operator: "X", aircraft: [] }))])).rejects.toThrow("aircraft");
  });
});
