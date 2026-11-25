import { describe, expect, it } from "vitest";
import { parseQuoteFollowUp } from "../src/domain/toyQuoteEdit";

const list = [
  { id: "a", type: "Bombardier Global 6000", tail: "9H-VJA", operator: "VistaJet" },
  { id: "b", type: "Gulfstream G650ER", tail: "A7-CGA", operator: "Qatar Executive" },
  { id: "c", type: "Bombardier Global 7500", tail: "9H-VJB", operator: "VistaJet" },
];

describe("Changes typed after a quote, as brokers write them", () => {
  it("owner's approval on one aircraft and WiFi on another, in one message (the broker's message)", () => {
    const r = parseQuoteFollowUp("Can you add subject to owner's approval for G650ER?\nand change WiFi to No on Global 7500", list);
    expect(r).toEqual({
      prices: {},
      edits: [
        { id: "b", field: "notes", value: "Subject to owner's approval", append: true },
        { id: "c", field: "wifi", value: "no", detail: "" },
      ],
      unclear: [],
    });
  });
  it("other ways of saying it", () => {
    expect(parseQuoteFollowUp("G650ER owner's approval required", list)?.edits).toEqual([{ id: "b", field: "notes", value: "Subject to owner's approval", append: true }]);
    expect(parseQuoteFollowUp("Global 6000 WiFi: No", list)?.edits).toEqual([{ id: "a", field: "wifi", value: "no", detail: "" }]);
  });
  it("a plain question is still not a change", () => {
    expect(parseQuoteFollowUp("Does the G650ER have WiFi?", list)).toBeNull();
  });
});
