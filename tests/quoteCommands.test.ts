import { describe, expect, it } from "vitest";
import { clauses, parseQuoteCommands } from "../src/domain/quoteCommands";

const fleet = [
  { id: "a1", type: "Gulfstream G280", tail: null, operator: "Advance Aviation" },
  { id: "a2", type: "Gulfstream G650ER", tail: "B-KXX", operator: "Jet Aviation" },
  { id: "a3", type: "Gulfstream G650ER", tail: "VP-CZZ", operator: "Tag Aviation" },
];

describe("Quote page commands", () => {
  it("splits clauses but keeps numbers together", () => {
    expect(clauses("add the G280, price USD 85,000 then copy")).toEqual(["add the G280", "price USD 85,000", "copy"]);
  });

  it("adds aircraft, sets the price on the last one, changes the language and copies", () => {
    const r = parseQuoteCommands("Add Jet Aviation G650ER, price USD 85,000 plus tax, Chinese, copy", fleet, []);
    expect(r.unknown).toEqual([]);
    expect(r.commands).toEqual([
      { do: "add", ids: ["a2"], what: "Jet Aviation G650ER" },
      { do: "price", id: "a2", value: "USD 85,000 plus tax" },
      { do: "lang", lang: "zh-Hant" },
      { do: "copy" },
    ]);
  });

  it("names the aircraft for a price, removes one, toggles details and picks an app", () => {
    const r = parseQuoteCommands("price for the G280 is 40k; remove B-KXX; show the tail; no closing line; send on WeChat", fleet, ["a1", "a2"]);
    expect(r.commands).toEqual([
      { do: "price", id: "a1", value: "40k" },
      { do: "remove", ids: ["a2"], what: "B-KXX" },
      { do: "show", what: "tail", on: true },
      { do: "show", what: "closing", on: false },
      { do: "send", app: "wechat" },
    ]);
  });

  it("understands Chinese and passes on what it does not know", () => {
    const r = parseQuoteCommands("加 G280，簡體，價錢 USD 40,000，分享", fleet, []);
    expect(r.commands).toEqual([
      { do: "add", ids: ["a1"], what: "G280" },
      { do: "lang", lang: "zh-Hans" },
      { do: "price", id: "a1", value: "USD 40,000" },
      { do: "share" },
    ]);
    expect(parseQuoteCommands("what is the weather", fleet, []).unknown).toEqual(["what is the weather"]);
    expect(parseQuoteCommands("G650ER", fleet, []).commands).toEqual([{ do: "add", ids: ["a2", "a3"], what: "G650ER" }]);
  });
});
