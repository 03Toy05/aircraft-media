import { describe, expect, it } from "vitest";
import { devBypassEnabled, isOwnerEmail, normalizePhone } from "../src/lib/owner";
import { setup, key } from "./helpers";
import { addVerifiedNumber } from "../src/domain/settings";
import { createOrganisation, resolveOrganisations } from "../src/domain/directory";
import { users } from "../src/db/schema";
import { FIXED_TENANT_ID } from "../src/domain/constants";

describe("Test 14 (single-user form) — only the owner can use the app", () => {
  it("accepts only the configured owner email, case-insensitively", () => {
    expect(isOwnerEmail("Owner@Example.com", "owner@example.com")).toBe(true);
    expect(isOwnerEmail("someone.else@example.com", "owner@example.com")).toBe(false);
    expect(isOwnerEmail(null, "owner@example.com")).toBe(false);
    expect(isOwnerEmail("owner@example.com", undefined)).toBe(false); // unset owner locks everyone out
  });

  it("never enables the dev bypass in production", () => {
    expect(devBypassEnabled({ NODE_ENV: "production", DEV_AUTH_BYPASS: "1" } as NodeJS.ProcessEnv)).toBe(false);
    expect(devBypassEnabled({ NODE_ENV: "development", DEV_AUTH_BYPASS: "1" } as NodeJS.ProcessEnv)).toBe(true);
    expect(devBypassEnabled({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(false);
  });

  it("scopes reads to the tenant", async () => {
    const t = await setup();
    await createOrganisation(t.db, t.actor, key(), { name: "Metrojet" });
    expect(await resolveOrganisations(t.db, t.actor.tenantId, "Metrojet")).toHaveLength(1);
    expect(await resolveOrganisations(t.db, "00000000-0000-0000-0000-0000000000ff", "Metrojet")).toHaveLength(0);
  });
});

describe("Verified WhatsApp number", () => {
  it("normalises, stores once, and refuses a second active record of the same number", async () => {
    const t = await setup();
    expect(normalizePhone("+852 9123-4567")).toBe("85291234567");
    expect(normalizePhone("123")).toBeNull();
    await addVerifiedNumber(t.db, t.actor, key(), { phone: "+852 9123 4567" });
    const err = await addVerifiedNumber(t.db, t.actor, key(), { phone: "85291234567" }).catch((e) => e);
    expect(err.code).toBe("NUMBER_IN_USE");
    void users; void FIXED_TENANT_ID;
  });
});
