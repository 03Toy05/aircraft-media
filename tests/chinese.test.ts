import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { setup, key } from "./helpers";
import { createAircraft, createAircraftType, createOrganisation } from "../src/domain/directory";
import { converse, emptyDraft, type Draft, type DraftPhoto } from "../src/domain/toy";
import { parseAircraftCard } from "../src/domain/card";
import { parseQuoteRequest, parseShareRequest } from "../src/domain/toyShare";
import { HANT, toHans, tr } from "../src/domain/toyText";

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  t = await setup();
  await createAircraftType(t.db, t.actor, key(), { manufacturer: "Gulfstream", model: "G280", category: "super_midsize_jet" });
});

const withLang = (lang: "en" | "zh-Hant" | "zh-Hans"): Draft => ({ ...emptyDraft("z"), lang });
const say = (r: { reply: { say: string[] } }) => r.reply.say.join("\n");
const fakePhoto = (name: string): DraftPhoto => ({ mediaId: `m-${name}`, name, contentVersionId: null, classification: "unclassified" });

describe("Toy in Traditional and Simplified Chinese", () => {
  it("every sentence Toy says has a Chinese translation", () => {
    const files = [...["toy.ts", "toyLookup.ts"].map((f) => join("src", "domain", f)), join("app", "chatActions.ts")].map((f) => readFileSync(join(__dirname, "..", f), "utf8"));
    const keys = new Set<string>();
    for (const src of files)
      for (const m of src.matchAll(/\btr\(\s*(?:L|lang|d\.lang)\s*,\s*(?:[^"`]*?\?\s*)?"((?:[^"\\]|\\.)*)"(?:\s*:\s*"((?:[^"\\]|\\.)*)")?/g))
        for (const k of [m[1], m[2]]) if (k) keys.add(k.replace(/\\"/g, '"'));
    expect(keys.size).toBeGreaterThan(60);
    expect([...keys].filter((k) => !(k in HANT))).toEqual([]);
    // Nothing in the table is dead text (the quote greeting is used by another file).
    expect(Object.keys(HANT).filter((k) => !keys.has(k) && k !== "Hello, here are the aircraft options:")).toEqual([]);
  });

  it("Simplified Chinese is made from the Traditional wording, with no Traditional-only characters left", () => {
    expect(tr("zh-Hant", "Confirm")).toBe("確認");
    expect(tr("zh-Hans", "Confirm")).toBe("确认");
    expect(tr("zh-Hans", "Done.")).toBe("完成。");
    expect(tr("en", "Got {n} photo{s}.", { n: 2, s: "s" })).toBe("Got 2 photos.");
    expect(tr("zh-Hans", "Got {n} photo{s}.", { n: 2, s: "s" })).toBe("收到 2 张相片。");
    const traditionalOnly = /[報連併內過訴嗎補減篩註張這個準備傳給發價頁對與營運資號說開無沒問題設請試輸機飛場艙圖區點還歷錄項維儲歸屬審稱現擇選條認確絡聯暫載當讀後繼續變動為見觀邊輕噴渦輪槳長遠類別舊數總實際規範狀態間驗證據專業顯關閉優線網譯轉換編輯]/;
    for (const v of Object.values(HANT)) expect(toHans(v)).not.toMatch(traditionalOnly);
  });

  it("reads labelled cards, dictated sentences and WIFI values in Chinese", () => {
    expect(parseAircraftCard("營運商：Vietstar Aviation\n機型：Legacy 600\n基地：胡志明市、河內\n載客量：13\n出廠年份：2015\n翻新年份：2020\nWIFI：有，每 MB 10 美元\n備註：需車主批准\n地區：亞洲")).toMatchObject({
      operator: "Vietstar Aviation", aircraft: "Legacy 600", base: { mode: "based", locations: ["胡志明市", "河內"] }, capacity: 13, yom: 2015, yor: 2020, wifi: "yes", wifiDetail: "每 MB 10 美元", notes: "需車主批准", region: "亞洲",
    });
    expect(parseAircraftCard("运营商：Metrojet\n机型：G280\n载客量：10\nWIFI：无\n基地：浮动")).toMatchObject({ operator: "Metrojet", aircraft: "G280", capacity: 10, wifi: "no", base: { mode: "floating", locations: [] } });
    expect(parseAircraftCard("新增營運商 Vietstar Aviation 基地在 胡志明市 機型 Legacy 600 13座")).toMatchObject({ operator: "Vietstar Aviation", base: { locations: ["胡志明市"] }, aircraft: "Legacy 600", capacity: 13 });
    expect(parseAircraftCard("營運商Vietstar機型G280載客量10出廠年份2015")).toMatchObject({ operator: "Vietstar", aircraft: "G280", capacity: 10, yom: 2015 });
    expect(parseAircraftCard("WIFI：待確認")).toMatchObject({ wifi: "tbc" });
    expect(parseAircraftCard("Tag Aviation\n2017年\n15座")).toMatchObject({ yom: 2017, capacity: 15 });
  });

  it("holds a whole conversation in Traditional Chinese, and again in Simplified", async () => {
    let r = await converse(t.db, t.actor.tenantId, withLang("zh-Hant"), "營運商：Vietstar Aviation\n機型：G280\n載客量：13", []);
    expect(say(r)).toMatch(/不在其中/);
    expect(r.reply.chips.map((c) => c.label)).toContain("營運商留空");
    r = await converse(t.db, t.actor.tenantId, r.draft, "新增", []);
    expect(say(r)).toMatch(/我會這樣做：/);
    expect(say(r)).toMatch(/新增營運商「Vietstar Aviation」/);
    expect(r.reply.chips.map((c) => c.label)).toEqual(["確認", "取消"]);
    r = await converse(t.db, t.actor.tenantId, r.draft, "確認", []);
    expect(r.confirm).toBe(true);

    let s = await converse(t.db, t.actor.tenantId, withLang("zh-Hans"), "运营商：Vietstar Aviation\n机型：G280\n载客量：13", []);
    expect(say(s)).toMatch(/不在其中/);
    s = await converse(t.db, t.actor.tenantId, s.draft, "新增", []);
    expect(s.reply.chips.map((c) => c.label)).toEqual(["确认", "取消"]);
    expect(say(s)).toMatch(/我会这样做：/);
    s = await converse(t.db, t.actor.tenantId, s.draft, "取消", []);
    expect(say(s)).toMatch(/已清除/);
    expect(s.draft.lang).toBe("zh-Hans");
  });

  it("a whole dictated Chinese sentence replaces a half-finished operator instead of being taken as 'new'", async () => {
    const first = await converse(t.db, t.actor.tenantId, withLang("zh-Hant"), "新增營運商 dear Jets", []);
    expect(first.draft.operatorText).toBe("dear Jets");
    const next = await converse(t.db, t.actor.tenantId, first.draft, "新增營運商 Vietstar Aviation 基地在 胡志明市 機型 Legacy 600 13座", []);
    expect(next.draft.operatorText).toBe("Vietstar Aviation");
    expect(next.draft.base).toEqual({ mode: "based", locations: ["胡志明市"] });
    expect(next.draft.capacity).toBe(13);
  });

  it("accepts 載客量 12 確認 in one go, and 全部客艙 for the views", async () => {
    await createOrganisation(t.db, t.actor, key(), { name: "Metrojet" });
    const first = await converse(t.db, t.actor.tenantId, withLang("zh-Hant"), "營運商：Metrojet\n機型：G280\n載客量：10", [fakePhoto("a.jpg")]);
    expect(first.draft.asked?.kind).toBe("classify");
    const cls = await converse(t.db, t.actor.tenantId, first.draft, "全部客艙", []);
    expect(cls.draft.asked?.kind).toBe("confirm");
    const done = await converse(t.db, t.actor.tenantId, cls.draft, "載客量 12 確認", []);
    expect(done.confirm).toBe(true);
    expect(done.draft.capacity).toBe(12);
  });

  async function fleet() {
    const heavy = (await createAircraftType(t.db, t.actor, key(), { manufacturer: "Gulfstream", model: "G650ER", category: "heavy_jet" })).result.aircraftTypeId;
    const g550 = (await createAircraftType(t.db, t.actor, key(), { manufacturer: "Gulfstream", model: "G550", category: "heavy_jet" })).result.aircraftTypeId;
    const capa = (await createOrganisation(t.db, t.actor, key(), { name: "CapaJet", region: "Asia" })).result.organisationId;
    const tag = (await createOrganisation(t.db, t.actor, key(), { name: "Tag Aviation", region: "Europe" })).result.organisationId;
    const a1 = (await createAircraft(t.db, t.actor, key(), { aircraftTypeId: g550, operatorId: capa, info: { yom: 2013, yor: 2020, capacity: 13, wifiStatus: "yes", wifiDetail: "at USD 10/MB" } })).result.aircraftId;
    const a2 = (await createAircraft(t.db, t.actor, key(), { aircraftTypeId: heavy, operatorId: tag, registration: "T7-LXX", info: { yom: 2017, capacity: 15, wifiStatus: "no" } })).result.aircraftId;
    return { a1, a2 };
  }

  it("looks things up, filters and sorts when asked in Chinese, and answers in Chinese", async () => {
    const { a2 } = await fleet();
    const ask = (lang: "zh-Hant" | "zh-Hans", q: string) => converse(t.db, t.actor.tenantId, withLang(lang), q, []);
    let r = await ask("zh-Hant", "CapaJet 有咩飛機？");
    expect(say(r)).toMatch(/有 1 架飛機/); expect(say(r)).toMatch(/G550/); expect(say(r)).toMatch(/出廠年份 2013/); expect(say(r)).toMatch(/13 座/);
    r = await ask("zh-Hans", "CapaJet 有哪些飞机");
    expect(say(r)).toMatch(/有 1 架飞机/);
    r = await ask("zh-Hant", "顯示大型噴射機");
    expect(say(r)).toMatch(/G550/); expect(say(r)).toMatch(/G650ER/); expect(say(r)).toMatch(/類別：大型噴射機/);
    r = await ask("zh-Hant", "列出有 wifi 的飛機");
    expect(say(r)).toMatch(/G550/); expect(say(r)).not.toMatch(/T7-LXX/); expect(say(r)).toMatch(/WIFI：有/);
    r = await ask("zh-Hant", "列出沒有 wifi 的飛機");
    expect(say(r)).toMatch(/T7-LXX/); expect(say(r)).not.toMatch(/出廠年份 2013/);
    r = await ask("zh-Hant", "顯示 Europe 的飛機");
    expect(say(r)).toMatch(/T7-LXX/); expect(say(r)).not.toMatch(/G550/); expect(r.reply.link?.href).toBe("/fleet?region=Europe");
    const order = async (q: string) => say(await ask("zh-Hant", q)).match(/G550|G650ER/g);
    expect(await order("列出所有飛機，最新的在前")).toEqual(["G650ER", "G550"]);
    expect(await order("列出所有飛機 座位最多")).toEqual(["G650ER", "G550"]);
    expect(await order("列出所有飛機 最舊的在前")).toEqual(["G550", "G650ER"]);
    r = await ask("zh-Hant", "T7 LXX 的相片");
    expect(r.reply.link?.href).toBe(`/aircraft/${a2}`);
  });

  it("makes the quote message, with photos, for named aircraft when asked in Chinese", async () => {
    const { a1, a2 } = await fleet();
    expect(parseQuoteRequest("給我 CapacJet 的 G550 和 Tag 的 G650ER 的模板和相片")).toEqual({ what: ["CapacJet 的 G550", "Tag 的 G650ER"] });
    expect(parseQuoteRequest("幫我整 CapaJet G550 嘅報價")).toEqual({ what: ["CapaJet G550"] });
    const r = await converse(t.db, t.actor.tenantId, withLang("zh-Hant"), "給我 CapacJet 的 G550 和 Tag 的 G650ER 的模板和相片", []);
    expect(r.reply.link?.href).toBe(`/quote?ids=${a1},${a2}`);
    expect(r.reply.copy).toBe(
      [
        "您好，以下是飛機選項：",
        ["飛機 1：Gulfstream G550", "出廠年份：2013", "翻新年份：2020", "載客量：13 座", "WIFI：有, at USD 10/MB", "價格："].join("\n"),
        ["飛機 2：Gulfstream G650ER", "出廠年份：2017", "載客量：15 座", "WIFI：無", "價格："].join("\n"),
        "如需更多資料或照片，請隨時告訴我。",
      ].join("\n\n"),
    );
    expect(say(r)).toMatch(/報價已準備好/);
    expect(r.reply.link?.label).toBe("查看報價");
    const s = await converse(t.db, t.actor.tenantId, withLang("zh-Hans"), "给我 CapacJet 的 G550 的模板", []);
    expect(s.reply.copy).toMatch(/^您好，以下是飞机选项：/);
    expect(s.reply.copy).toMatch(/出厂年份：2013/);
  });

  it("reads Chinese 'send to' requests", () => {
    expect(parseShareRequest("把 G280 發給 陳生")).toEqual({ what: "G280", who: "陳生" });
    expect(parseShareRequest("發送 G280 的相片給 陳先生")).toEqual({ what: "G280", who: "陳先生" });
    expect(parseShareRequest("operator Metrojet")).toBeNull();
  });
});
