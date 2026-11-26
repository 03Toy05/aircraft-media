import { describe, expect, it } from "vitest";
import { aircraftNameZh, quoteAircraftName } from "@/domain/aircraftNamesZh";
import { buildQuoteParts } from "@/domain/quote";
import { STANDARD_AIRCRAFT_TYPES } from "@/domain/standardTypes";

describe("aircraft names on Chinese quotes", () => {
  it("puts the maker or family in Chinese and keeps the model number", () => {
    expect(aircraftNameZh("zh-Hant", "Gulfstream G650ER")).toBe("灣流 G650ER");
    expect(aircraftNameZh("zh-Hans", "Gulfstream G650ER")).toBe("湾流 G650ER");
    expect(aircraftNameZh("zh-Hant", "Bombardier Global 7500")).toBe("環球 7500");
    expect(aircraftNameZh("zh-Hant", "Bombardier Challenger 350")).toBe("挑戰者 350");
    expect(aircraftNameZh("zh-Hans", "Embraer Praetor 600")).toBe("巴航工业领航 600");
    expect(aircraftNameZh("zh-Hans", "Embraer Lineage 1000")).toBe("世袭 1000");
    expect(aircraftNameZh("zh-Hans", "Beechcraft Premier IA")).toBe("比奇首相 IA");
    expect(aircraftNameZh("zh-Hant", "Beechcraft King Air 350i")).toBe("空中國王 350i");
    expect(aircraftNameZh("zh-Hant", "Cessna Citation Latitude")).toBe("獎狀緯度");
    expect(aircraftNameZh("zh-Hans", "Cessna Citation CJ4")).toBe("奖状 CJ4");
    expect(aircraftNameZh("zh-Hant", "Airbus ACJ320neo")).toBe("空中巴士公務機 ACJ320neo");
    expect(aircraftNameZh("zh-Hans", "Airbus H145")).toBe("空客直升机 H145");
    expect(aircraftNameZh("zh-Hant", "Dassault Falcon 8X")).toBe("獵鷹 8X");
  });

  it("leaves other languages and unknown makers in English", () => {
    expect(aircraftNameZh("en", "Gulfstream G650ER")).toBeNull();
    expect(aircraftNameZh("ja", "Gulfstream G650ER")).toBeNull();
    expect(aircraftNameZh("zh-Hans", "Honda HondaJet HA-420")).toBe("本田喷气飞机 HA-420");
    expect(aircraftNameZh("zh-Hant", "HondaJet Elite")).toBe("本田噴氣飛機 Elite");
    expect(aircraftNameZh("zh-Hans", "Cirrus Vision Jet SF50")).toBe("西锐 SF50");
    expect(aircraftNameZh("zh-Hant", "Eclipse 550")).toBeNull();
    expect(quoteAircraftName("zh-Hant", "Nextant 400XT")).toBe("Nextant 400XT");
    expect(quoteAircraftName("en", "Gulfstream G650ER")).toBe("Gulfstream G650ER");
  });

  it("shows the English name in brackets on the quote", () => {
    expect(quoteAircraftName("zh-Hant", "Gulfstream G650ER")).toBe("灣流 G650ER（Gulfstream G650ER）");
    const item = { type: "Gulfstream G650ER", yom: 2015, yor: null, capacity: 13, wifi: "yes" as const, wifiDetail: null, smoking: "no" as const, pets: "unknown" as const, cleaningFee: null, price: "" };
    expect(buildQuoteParts([item], { language: "zh-Hant", template: null }).blocks[0]).toContain("灣流 G650ER（Gulfstream G650ER）");
    expect(buildQuoteParts([item], { language: "en", template: null }).blocks[0]).toContain("Gulfstream G650ER");
    expect(buildQuoteParts([item], { language: "en", template: null }).blocks[0]).not.toContain("灣流");
  });

  it("knows every maker in the standard list except the few kept in English", () => {
    const keptEnglish = ["Eclipse", "Nextant", "Enstrom", "Kazan", "MD Helicopters"];
    const unknown = [...new Set(STANDARD_AIRCRAFT_TYPES.filter((t) => !keptEnglish.includes(t.manufacturer) && !aircraftNameZh("zh-Hant", `${t.manufacturer} ${t.model}`)).map((t) => `${t.manufacturer} ${t.model}`))];
    expect(unknown).toEqual([]);
  });
});
