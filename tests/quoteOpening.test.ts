import { describe, expect, it } from "vitest";
import { parseQuoteRequest } from "@/domain/toyShare";

const today = new Date("2026-11-25T00:00:00Z");

describe("the quote template's opening and closing lines", () => {
  it("reads Opening at the top and Closing at the bottom", () => {
    const r = parseQuoteRequest([
      "Quote",
      "Opening: Dear Mr Chan, please find our options below.",
      "Leg 1 – Date: 12 Dec | From: HKG | To: LHR | Time: 16:30 | Pax: 8",
      "Option 1 – Operator: Tag Aviation | Aircraft: G650ER | Price: USD 230,000",
      "Closing: Subject to availability. Best regards, Wallace",
    ].join("\n"), today);
    expect(r?.greeting).toBe("Dear Mr Chan, please find our options below.");
    expect(r?.closing).toBe("Subject to availability. Best regards, Wallace");
    expect(r?.what).toEqual(["Tag Aviation G650ER"]);
    expect(r?.prices).toEqual(["USD 230,000"]);
    expect(r?.legs?.[0]).toMatchObject({ from: "VHHH", to: "EGLL", pax: 8 });
  });

  it("leaves blank Opening and Closing out", () => {
    const r = parseQuoteRequest("Quote\nOpening: \nOption 1 – Operator: Tag Aviation | Aircraft: G650ER | Price: \nClosing: ", today);
    expect(r?.what).toEqual(["Tag Aviation G650ER"]);
    expect(r).not.toHaveProperty("greeting");
    expect(r).not.toHaveProperty("closing");
  });

  it("reads the Chinese template", () => {
    const r = parseQuoteRequest("報價\n開場白：陳先生您好，以下是飛機選項。\n選項1 – 營運商：Tag Aviation ｜飛機：G650ER ｜價格：USD 230,000\n結尾語：謝謝！", today);
    expect(r?.greeting).toBe("陳先生您好，以下是飛機選項。");
    expect(r?.closing).toBe("謝謝！");
    expect(r?.what).toEqual(["Tag Aviation G650ER"]);
  });
});
