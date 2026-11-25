import { describe, expect, it } from "vitest";
import { needsCjkFont } from "../src/domain/quotePdf";

describe("PDF font choice", () => {
  it("uses the small TrueType font for Latin, Vietnamese and Cyrillic quotes", () => {
    expect(needsCjkFont("en", "Bombardier Global 7500 – USD 90,000 + tax")).toBe(false);
    expect(needsCjkFont("vi", "Giá: 90.000 USD, máy bay đẹp")).toBe(false);
    expect(needsCjkFont("ru", "Цена: 90 000 USD")).toBe(false);
    expect(needsCjkFont("de", "Größe € 5")).toBe(false);
  });
  it("uses the full font for Chinese and Japanese, or any Chinese text in another quote", () => {
    expect(needsCjkFont("zh-Hant", "Global 7500")).toBe(true);
    expect(needsCjkFont("ja", "Global 7500")).toBe(true);
    expect(needsCjkFont("en", "Operator: 金鹿公务")).toBe(true);
  });
});
