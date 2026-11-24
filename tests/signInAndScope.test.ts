import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { setup, key } from "./helpers";
import { signInLinks, users } from "../src/db/schema";
import type { Actor } from "../src/domain/action";
import { createAircraft, createAircraftType, createOrganisation } from "../src/domain/directory";
import { consumeSignInLink, createSignInLink, mayUseApp } from "../src/domain/signInLinks";
import { LIBRARY_TENANT_ID, libraryScope, scopeHasAircraft, scopeHasOperator, setLibraryOperators, withinLibraryScope } from "../src/domain/library";
import { aircraftMedia } from "../src/db/schema";
import { approveMedia, ingestUpload, setMediaAssociation, updateMediaMetadata } from "../src/domain/media";
import { makeImage } from "./helpers";

/** Puts one approved photo on a library aircraft, so brokers may see it. */
async function approvedPhoto(t: Awaited<ReturnType<typeof setup>>, lib: Actor, aircraftId: string, seed: number) {
  const up = (await ingestUpload(t.db, t.store, lib, { filename: `p${seed}.png`, bytes: await makeImage(400, 300, seed) })).result;
  const v = async () => (await t.db.select({ v: aircraftMedia.version }).from(aircraftMedia).where(eq(aircraftMedia.id, up.mediaId)))[0].v;
  await updateMediaMetadata(t.db, lib, key(), { mediaId: up.mediaId, expectedVersion: await v(), classification: "exterior" });
  await setMediaAssociation(t.db, lib, key(), { mediaId: up.mediaId, expectedVersion: await v(), status: "actual_aircraft", aircraftId });
  await approveMedia(t.db, lib, { mediaId: up.mediaId, contentVersionId: up.contentVersionId, expectedVersion: await v() });
}

describe("Sign-in by emailed link", () => {
  it("only makes links for invited people, once each, and refuses used or expired ones", async () => {
    const t = await setup(); // owner@example.test is invited (a user row)
    expect(await mayUseApp(t.db, "stranger@example.test")).toBe("not_invited");
    expect(await createSignInLink(t.db, "stranger@example.test")).toBeNull();
    expect(await createSignInLink(t.db, "not an email")).toBeNull();

    const token = await createSignInLink(t.db, "  Owner@Example.test ");
    expect(token).toBeTruthy();
    // Only the hash is stored.
    const [row] = await t.db.select().from(signInLinks);
    expect(row.tokenHash).not.toBe(token);
    expect(row.email).toBe("owner@example.test");

    expect(await consumeSignInLink(t.db, "wrong")).toBeNull();
    expect(await consumeSignInLink(t.db, token!)).toBe("owner@example.test");
    expect(await consumeSignInLink(t.db, token!)).toBeNull(); // works once

    const old = await createSignInLink(t.db, "owner@example.test");
    expect(await consumeSignInLink(t.db, old!, "password", new Date(Date.now() + 31 * 60_000))).toBeNull(); // expired
  });

  it("stops after a few links in a quarter of an hour, and refuses people turned off since", async () => {
    const t = await setup();
    for (let i = 0; i < 3; i++) expect(await createSignInLink(t.db, "owner@example.test")).toBeTruthy();
    expect(await createSignInLink(t.db, "owner@example.test")).toBeNull();

    const t2 = await setup();
    const token = await createSignInLink(t2.db, "owner@example.test");
    await t2.db.update(users).set({ status: "blocked" }).where(eq(users.email, "owner@example.test"));
    expect(await consumeSignInLink(t2.db, token!)).toBeNull();
    expect(await createSignInLink(t2.db, "owner@example.test")).toBeNull();
  });
});

describe("Library operators per person", () => {
  it("shows everything, only the chosen operators, or nothing", async () => {
    const t = await setup();
    const lib: Actor = { id: t.actor.id, tenantId: LIBRARY_TENANT_ID };
    const type = (await createAircraftType(t.db, lib, key(), { manufacturer: "Gulfstream", model: "G650ER", category: "ultra_long_range_jet" })).result.aircraftTypeId;
    const opA = (await createOrganisation(t.db, lib, key(), { name: "Alpha Jets" })).result.organisationId;
    const opB = (await createOrganisation(t.db, lib, key(), { name: "Bravo Air" })).result.organisationId;
    const acA = (await createAircraft(t.db, lib, key(), { aircraftTypeId: type, operatorId: opA, registration: "B-AAA" })).result.aircraftId;
    const acB = (await createAircraft(t.db, lib, key(), { aircraftTypeId: type, operatorId: opB, registration: "B-BBB" })).result.aircraftId;
    const opC = (await createOrganisation(t.db, lib, key(), { name: "Charlie Charter" })).result.organisationId;
    const acC = (await createAircraft(t.db, lib, key(), { aircraftTypeId: type, operatorId: opC, registration: "B-CCC" })).result.aircraftId;
    await approvedPhoto(t, lib, acA, 1);
    await approvedPhoto(t, lib, acB, 2); // B-CCC has no approved photo yet: only the admin sees it
    const own = (await createAircraft(t.db, t.actor, key(), { aircraftTypeId: (await createAircraftType(t.db, t.actor, key(), { manufacturer: "Gulfstream", model: "G650ER", category: "ultra_long_range_jet" })).result.aircraftTypeId, registration: "B-OWN" })).result.aircraftId;

    const [u] = await t.db.insert(users).values({ tenantId: randomUUID(), email: "broker@example.test", displayName: "Broker" }).returning({ id: users.id });
    const who = { isAdmin: false, actor: { id: u.id } };

    expect(await libraryScope(t.db, who)).toBeNull(); // not shared yet
    await t.db.update(users).set({ libraryAccess: true }).where(eq(users.id, u.id));
    // Shared: every operator, but only aircraft that already have an approved photo.
    const open = await libraryScope(t.db, who);
    expect([acA, acB, acC].map((id) => scopeHasAircraft(open, id))).toEqual([true, true, false]);
    expect([opA, opB, opC].map((id) => scopeHasOperator(open, id))).toEqual([true, true, false]);
    expect(await withinLibraryScope(t.db, open, [own, acA, acC])).toEqual([own, acA]);

    await setLibraryOperators(t.db, u.id, [opA]);
    const scope = await libraryScope(t.db, who);
    expect(scopeHasOperator(scope, opA)).toBe(true);
    expect(scopeHasOperator(scope, opB)).toBe(false);
    expect(scopeHasAircraft(scope, acA)).toBe(true);
    expect(scopeHasAircraft(scope, acB)).toBe(false);
    // A quote keeps the person's own aircraft and the allowed library ones.
    expect(await withinLibraryScope(t.db, scope, [own, acA, acB])).toEqual([own, acA]);

    await setLibraryOperators(t.db, u.id, [opA, opC]);
    expect(scopeHasAircraft(await libraryScope(t.db, who), acC)).toBe(false); // chosen, but not ready yet
    await setLibraryOperators(t.db, u.id, []);
    expect(scopeHasAircraft(await libraryScope(t.db, who), acA)).toBe(false);
    // The admin always sees everything.
    expect(await libraryScope(t.db, { isAdmin: true, actor: { id: u.id } })).toEqual({ all: true });
  });
});

describe("Passwords", () => {
  it("sets, checks, and locks after five wrong tries", async () => {
    const t = await setup();
    const { checkPassword, hasPassword, passwordProblem, setPassword } = await import("../src/domain/passwords");
    expect(passwordProblem("short")).toBeTruthy();
    expect(passwordProblem(" spaced out ")).toBeTruthy();
    expect(await hasPassword(t.db, "owner@example.test")).toBe(false);
    expect((await checkPassword(t.db, "owner@example.test", "anything1")).result).toBe("wrong"); // none set yet

    expect(await setPassword(t.db, "Owner@Example.test", "correct horse")).toBe(true);
    expect(await setPassword(t.db, "nobody@example.test", "correct horse")).toBe(false);
    const [u] = await t.db.select({ h: users.passwordHash }).from(users).where(eq(users.email, "owner@example.test"));
    expect(u.h).not.toContain("correct horse"); // stored hashed
    expect(await checkPassword(t.db, " OWNER@example.test", "correct horse")).toEqual({ result: "ok", email: "owner@example.test" });

    for (let i = 0; i < 4; i++) expect((await checkPassword(t.db, "owner@example.test", "wrong guess")).result).toBe("wrong");
    expect((await checkPassword(t.db, "owner@example.test", "wrong guess")).result).toBe("locked");
    expect((await checkPassword(t.db, "owner@example.test", "correct horse")).result).toBe("locked"); // even the right one, for now
    expect((await checkPassword(t.db, "owner@example.test", "correct horse", new Date(Date.now() + 16 * 60_000))).result).toBe("ok");

    // A new password from an emailed link clears the lock.
    for (let i = 0; i < 5; i++) await checkPassword(t.db, "owner@example.test", "wrong guess");
    const token = await createSignInLink(t.db, "owner@example.test", "password");
    expect(await consumeSignInLink(t.db, token!, "sign_in")).toBeNull(); // a password link is only for passwords
    expect(await consumeSignInLink(t.db, token!, "password")).toBe("owner@example.test");
    await setPassword(t.db, "owner@example.test", "new password 2");
    expect((await checkPassword(t.db, "owner@example.test", "new password 2")).result).toBe("ok");

    // Turned off: the right password no longer gets in.
    await t.db.update(users).set({ status: "blocked" }).where(eq(users.email, "owner@example.test"));
    expect((await checkPassword(t.db, "owner@example.test", "new password 2")).result).toBe("wrong");
  });
});
