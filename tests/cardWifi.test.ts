import { describe, expect, it } from "vitest";
import { parseAircraftCard } from "../src/domain/card";

describe("WIFI as brochures write it", () => {
  it.each([
    ["WIFI complimentary", "yes", "complimentary"],
    ["WIFI: Free", "yes", "Free"],
    ["WIFI available", "yes", "available"],
    ["WIFI On Request", "tbc", "On Request"],
    ["WIFI none", "no", undefined],
    ["WIFI Yes, USD 10/MB", "yes", "USD 10/MB"],
  ])("%s", (line, status, detail) => {
    const c = parseAircraftCard(`Qatar Executive\nGulfstream G650ER\n${line}\nSmoking No\nPets Yes`);
    expect(c.wifi).toBe(status);
    expect(c.wifiDetail || undefined).toBe(detail);
    expect(c.problems).toEqual([]);
    expect(c.smoking).toBe("no");
    expect(c.pets).toBe("yes");
  });
});
