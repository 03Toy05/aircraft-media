import { afterEach, describe, expect, it, vi } from "vitest";
import type { Mail } from "../src/lib/mail";

const sent: Mail[] = [];
vi.mock("../src/lib/mail", () => ({ sendMail: async (m: Mail) => { sent.push(m); }, mailReady: () => true }));
vi.mock("../src/lib/site", () => ({ siteAddress: async () => "https://www.aircraftmedia.my" }));

import { setup } from "./helpers";
import { startTrialWithNotice } from "../src/lib/signupNotice";
import { mayUseApp } from "../src/domain/signInLinks";

describe("The admin hears about every new sign-up", () => {
  afterEach(() => { sent.length = 0; vi.unstubAllEnvs(); });

  it("emails the admin once, for a new person only, with how they joined", async () => {
    vi.stubEnv("OWNER_EMAIL", "owner@example.test");
    vi.stubEnv("SUPPORT_EMAIL", "toy@aircraftmedia.my");
    const t = await setup();
    const r = await startTrialWithNotice(t.db, "kim@charter.example", null, "the sign-in page");
    expect(r?.created).toBe(true);
    expect(await mayUseApp(t.db, "kim@charter.example")).toBe("pending"); // an application, until approved
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "toy@aircraftmedia.my", subject: "New application: kim@charter.example", replyTo: "kim@charter.example" });
    expect(sent[0].text).toContain("kim@charter.example applied for a free trial through the sign-in page.");
    expect(sent[0].text).toContain("https://www.aircraftmedia.my/admin#applications");

    await startTrialWithNotice(t.db, "KIM@charter.example", null, "the free trial page"); // already there
    expect(sent).toHaveLength(1);
  });
});
