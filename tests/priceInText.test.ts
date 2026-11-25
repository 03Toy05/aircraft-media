import { describe, expect, it } from "vitest";
import { priceInText } from "../src/domain/quote";

describe("Price in a block written by hand", () => {
  it("finds the price line in the quote's language, without bold marks", () => {
    expect(priceInText("Aircraft 2: Bombardier Global 6000\nCapacity: 14 seats\nPrice: USD 90,000", "Price")).toBe("USD 90,000");
    expect(priceInText("*Price:* USD 1 + tax", "Price")).toBe("USD 1 + tax");
    expect(priceInText("飛機：G650\n價格：港幣 50,000", "價格")).toBe("港幣 50,000");
    expect(priceInText("price: usd 5", "Price")).toBe("usd 5");
    expect(priceInText("no price here", "Price")).toBe("");
    expect(priceInText(undefined, "Price")).toBe("");
  });
});
