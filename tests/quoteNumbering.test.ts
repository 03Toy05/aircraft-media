import { describe, expect, it } from "vitest";
import { buildQuoteParts, renumberBlock } from "../src/domain/quote";

const en = { language: "en" as const, template: null };

describe("Option numbers follow the order in the message, never the text", () => {
  it("numbers automatic blocks by position", () => {
    const p = buildQuoteParts([{ type: "Gulfstream G280" }, { type: "Gulfstream G650ER" }] as never, { language: "en" });
    expect(p.blocks[0]).toMatch(/^Aircraft 1: Gulfstream G280/);
    expect(p.blocks[1]).toMatch(/^Aircraft 2: Gulfstream G650ER/);
  });

  it("renumbers a block rewritten by hand, keeping the broker's words and styles", () => {
    const typed = "Aircraft 3: _Gulfstream G650ER_\nManufacture: 2017\nPrice: USD 100,000";
    expect(renumberBlock(typed, en, 1, 1)).toBe("Aircraft: _Gulfstream G650ER_\nManufacture: 2017\nPrice: USD 100,000");
    expect(renumberBlock(typed, en, 2, 3)).toBe("Aircraft 2: _Gulfstream G650ER_\nManufacture: 2017\nPrice: USD 100,000");
    expect(renumberBlock("*Aircraft 2*: *Gulfstream G280*", en, 1, 2)).toBe("*Aircraft 1*: *Gulfstream G280*");
    expect(renumberBlock("Aircraft: Gulfstream G280", en, 3, 3)).toBe("Aircraft 3: Gulfstream G280");
  });

  it("leaves text alone when the broker removed the label, and only touches the first label line", () => {
    expect(renumberBlock("Gulfstream G280, 10 seats", en, 2, 3)).toBe("Gulfstream G280, 10 seats");
    expect(renumberBlock("Aircraft 5: G280\nAircraft 9: note", en, 1, 2)).toBe("Aircraft 1: G280\nAircraft 9: note");
  });

  it("works with Chinese wording and the broker's own template", () => {
    const zh = buildQuoteParts([{ type: "G280" }, { type: "G650ER" }] as never, { language: "zh-Hant" }).blocks[1];
    expect(renumberBlock(zh, { language: "zh-Hant", template: null }, 1, 2)).toBe(buildQuoteParts([{ type: "G650ER" }, { type: "G280" }] as never, { language: "zh-Hant" }).blocks[0]);
    expect(renumberBlock("Option 4 - G280", { language: "en", template: { block: "Option{n} - {aircraft}" } }, 1, 2)).toBe("Option 4 - G280"); // no colon after it: left alone
    expect(renumberBlock("Option 4: G280", { language: "en", template: { block: "Option{n}: {aircraft}" } }, 1, 2)).toBe("Option 1: G280");
  });
});
