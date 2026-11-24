import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { setup, key } from "./helpers";
import { signInLinks, users } from "../src/db/schema";
import type { Actor } from "../src/domain/action";
import { createAircraft, createAircraftType, createOrganisation } from "../src/domain/directory";
import { consumeSignInLink, createSignInLink, mayUseApp } from "../src/domain/signInLinks";
import { LIBRARY_TENANT_ID, libraryScope, scopeHasAircraft, scopeHasOperator, setLibraryOperators, withinLibraryScope } from "../src/domain/library";

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
    expect(await consumeSignInLink(t.db, old!, new Date(Date.now() + 21 * 60_000))).toBeNull(); // expired
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
    const own = (await createAircraft(t.db, t.actor, key(), { aircraftTypeId: (await createAircraftType(t.db, t.actor, key(), { manufacturer: "Gulfstream", model: "G650ER", category: "ultra_long_range_jet" })).result.aircraftTypeId, registration: "B-OWN" })).result.aircraftId;

    const [u] = await t.db.insert(users).values({ tenantId: randomUUID(), email: "broker@example.test", displayName: "Broker" }).returning({ id: users.id });
    const who = { isAdmin: false, actor: { id: u.id } };

    expect(await libraryScope(t.db, who)).toBeNull(); // not shared yet
    await t.db.update(users).set({ libraryAccess: true }).where(eq(users.id, u.id));
    expect(await libraryScope(t.db, who)).toEqual({ all: true }); // shared: every operator

    await setLibraryOperators(t.db, u.id, [opA]);
    const scope = await libraryScope(t.db, who);
    expect(scopeHasOperator(scope, opA)).toBe(true);
    expect(scopeHasOperator(scope, opB)).toBe(false);
    expect(scopeHasAircraft(scope, acA)).toBe(true);
    expect(scopeHasAircraft(scope, acB)).toBe(false);
    // A quote keeps the person's own aircraft and the allowed library ones.
    expect(await withinLibraryScope(t.db, scope, [own, acA, acB])).toEqual([own, acA]);

    await setLibraryOperators(t.db, u.id, []);
    expect(scopeHasAircraft(await libraryScope(t.db, who), acA)).toBe(false);
    // The admin always sees everything.
    expect(await libraryScope(t.db, { isAdmin: true, actor: { id: u.id } })).toEqual({ all: true });
  });
});
