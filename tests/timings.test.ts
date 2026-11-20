import { describe, expect, it } from "vitest";
import { setup } from "./helpers";
import { recordTimings, speedReport, timingName } from "../src/domain/timings";

describe("Speed timings", () => {
  it("names every aircraft page the same", () => {
    expect(timingName("/aircraft/5217ceec-15a9-4cdf-86fb-66ebd0a589ca")).toBe("/aircraft/:id");
    expect(timingName("  Add to   my workspace ")).toBe("Add to my workspace");
  });

  it("records waits and reports typical, slow and slowest per page, button and Toy reply", async () => {
    const t = await setup();
    const who = { tenantId: t.actor.tenantId, userId: t.actor.id };
    const quote = Array.from({ length: 10 }, (_, i) => ({ kind: "toy" as const, name: "quote", ms: (i + 1) * 100, serverMs: 50 }));
    const n = await recordTimings(t.db, who, [
      ...quote,
      { kind: "page", name: "/aircraft/5217ceec-15a9-4cdf-86fb-66ebd0a589ca", ms: 300 },
      { kind: "page", name: "/library", ms: -5 }, // dropped
      { kind: "nonsense" as "page", name: "x", ms: 1 }, // dropped
    ]);
    expect(n).toBe(11);
    const r = await speedReport(t.db, 7);
    const q = r.find((x) => x.kind === "toy" && x.name === "quote")!;
    expect(q).toMatchObject({ count: 10, typical: 550, slowest: 1000, server: 50 });
    expect(q.slow).toBe(910);
    expect(r.find((x) => x.kind === "page")?.name).toBe("/aircraft/:id");
  });
});
