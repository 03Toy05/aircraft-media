import type { Classification } from "./constants";

/**
 * Chocks speaks the language you pick. Every sentence Chocks says is written once in English and looked up here;
 * Traditional Chinese is written out, and Simplified Chinese is made from it by a fixed character table, so the two
 * never drift apart. A sentence with no entry is simply said in English, never lost.
 *
 * Names (operators, aircraft types, tail numbers) are never translated. Have a native speaker read this file once.
 */
export type ChatLang = "en" | "zh-Hant" | "zh-Hans";

export const CHAT_LANGUAGES: { id: ChatLang; name: string }[] = [
  { id: "en", name: "English" },
  { id: "zh-Hant", name: "繁體中文" },
  { id: "zh-Hans", name: "简体中文" },
];

export const isChatLang = (v: unknown): v is ChatLang => v === "en" || v === "zh-Hant" || v === "zh-Hans";
export const parseChatLang = (v: unknown): ChatLang => (isChatLang(v) ? v : "en");
export const isChinese = (l: ChatLang | undefined) => l === "zh-Hant" || l === "zh-Hans";

/** English sentence (with {placeholders}) -> Traditional Chinese. */
export const HANT: Record<string, string> = {
  "Got {n} photo{s}.": "收到 {n} 張相片。",
  "No problem, I've cleared that. Send me photos and details whenever you're ready.": "沒問題，已清除。準備好時，請傳相片和資料給我。",
  "Here is the message and photos for:": "以下是這些飛機的報價訊息和相片：",
  "Open the quote to add prices, change the language, edit the wording and send it with the photos.": "打開報價頁面，可加入價格、更改語言、修改字句，並連同相片一併發送。",
  "I couldn't find {names}.": "找不到 {names}。",
  "I couldn't find: {names}.": "找不到：{names}。",
  "Open the Quote page to choose the aircraft.": "請打開報價頁面選擇飛機。",
  "Open the quote": "打開報價",
  "I couldn't match that to an operator or tail number you have. Try the operator's name or a tail number, for example “what does Capa Jet have?”.": "我在你的資料中找不到相符的營運商或機尾號。請試試輸入營運商名稱或機尾號，例如「Capa Jet 有哪些飛機？」。",
  "Here you go. I've prepared the card. Nothing is sent until you press Send in the messenger.": "已準備好資料卡。在通訊程式中按「傳送」之前，不會發出任何內容。",
  "Please pick one of the options below.": "請從下面的選項中選一個。",
  "I don't have a contact called “{who}”. Add them on the Contacts page first, with the messenger they prefer, then ask me again.": "我沒有名為「{who}」的聯絡人。請先在「聯絡人」頁面加入對方及其慣用的通訊程式，然後再問我。",
  "I couldn't find an aircraft matching “{what}”. Try the tail number, the operator or the aircraft type.": "找不到符合「{what}」的飛機。請試試機尾號、營運商或機型。",
  "“{what}” matches {n} aircraft. Which one should go to {who}?": "「{what}」符合 {n} 架飛機。要發給 {who} 的是哪一架？",
  "“{who}” matches {n} contacts. Which one?": "「{who}」符合 {n} 位聯絡人。是哪一位？",
  "Got it: “{text}” is another name for {name}. I'll save that so it matches next time.": "明白：「{text}」是 {name} 的另一個名稱。我會記下，下次就能自動對上。",
  "That's fine. I checked all {n} operator{s} you have and the closest ones are listed below, so it is most likely a new operator.": "沒問題。我已查過你的 {n} 個營運商，最接近的列在下面，所以這很可能是新營運商。",
  "That's fine. I checked all {n} operator{s} you have and none looks like “{text}”, so it is most likely a new operator.": "沒問題。我已查過你的 {n} 個營運商，沒有一個像「{text}」，所以這很可能是新營運商。",
  "Shall I create it as new, or leave the operator blank for now? You can add it later.": "要新增為新營運商，還是暫時留空？之後可以再加。",
  "I didn't understand “{line}”. You can add “Tail number: …”, “YOM: …” or “Capacity: …” on their own lines.": "我看不懂「{line}」。你可以分行加入「機尾號：…」、「出廠年份：…」或「載客量：…」。",
  "I read {a}.": "我理解為 {a}。",
  "Yes, create “{text}”": "是，新增「{text}」",
  "Same as {name}": "與 {name} 相同",
  "Leave operator blank": "營運商留空",
  "Operator: {name} is already in your list.": "營運商：{name} 已在你的名單中。",
  "“{text}” matches {n} of your operators. Which one is it?": "「{text}」符合你的 {n} 個營運商。是哪一個？",
  "I checked your {n} operator{s} and “{text}” isn't one of them.": "我查過你的 {n} 個營運商，「{text}」不在其中。",
  "The closest one is: {names}. Is it one of those under another name, or a new operator?": "最接近的是：{names}。它是其中一個的另一個名稱，還是新營運商？",
  "The closest ones are: {names}. Is it one of those under another name, or a new operator?": "最接近的有：{names}。它是其中一個的另一個名稱，還是新營運商？",
  "Is it a new operator? If you're not sure, say “not sure” and I'll tell you what I'd do.": "這是新營運商嗎？如果不確定，請說「不確定」，我會告訴你我會怎麼做。",
  "Aircraft type: {label}.": "機型：{label}。",
  "Aircraft type: {label} ({category}).": "機型：{label}（{category}）。",
  "“{text}” matches {n} aircraft types. Which one?": "「{text}」符合 {n} 個機型。是哪一個？",
  "I don't have “{text}”. Did you mean one of these?": "我沒有「{text}」。你是指下面其中一個嗎？",
  "I don't have an aircraft type called “{text}”. Tell me the exact name (like “Gulfstream G280”), or load the standard list on the Operators & aircraft page.": "我沒有名為「{text}」的機型。請告訴我準確名稱（例如「Gulfstream G280」），或在「營運商與飛機」頁面載入標準機型清單。",
  "Skip the type": "略過機型",
  "Which aircraft type is this? For example “Gulfstream G280”.": "這是哪個機型？例如「Gulfstream G280」。",
  "{tail} is already in your directory: {list}. Is this photo set for that aircraft, or a different aircraft with the same tail number?": "{tail} 已在你的資料中：{list}。這組相片是屬於該飛機，還是另一架機尾號相同的飛機？",
  "Same aircraft": "同一架飛機",
  "Different aircraft": "另一架飛機",
  "Skip the tail": "略過機尾號",
  "{tail} isn't in your directory yet, so I'll create it as a new aircraft.": "{tail} 尚未在你的資料中，我會把它新增為新飛機。",
  "(no tail number yet)": "（暫無機尾號）",
  "no tail number yet": "暫無機尾號",
  "You already have {list}. Is this that aircraft, or another one?": "你已經有 {list}。這是同一架飛機，還是另一架？",
  "Another aircraft": "另一架飛機",
  "Photos for the type only": "相片只屬於機型",
  "No tail number was given, so I'll record the aircraft without one. You can add it later.": "沒有提供機尾號，我會先記錄這架飛機而不填機尾號。之後可以再補。",
  "To create {tail} I need its aircraft type. Which one is it?": "要新增 {tail}，我需要知道它的機型。是哪一個？",
  "What view is “{name}”? Say “all interior” to apply a view to every unclassified photo.": "「{name}」是哪個角度？說「全部內部」可把該角度套用到所有未分類的相片。",
  "I need a bit more. Send photos, or details like “Operator: …”, “Aircraft type: …”, “Tail number: …”.": "我需要多一點資料。請傳相片，或像「營運商：…」、「機型：…」、「機尾號：…」這樣的資料。",
  "Say “confirm”, or change something by sending it again (for example “Capacity: 12”).": "請說「確認」，或重新傳送要修改的內容（例如「載客量：12」）。",
  "Confirm": "確認",
  "Cancel": "取消",
  "Here is what I'll do:": "我會這樣做：",
  "• Create operator “{text}”{reg}": "• 新增營運商「{text}」{reg}",
  " (region: {region})": "（地區：{region}）",
  "• Use operator {name} and remember “{text}” as another name": "• 使用營運商 {name}，並記住「{text}」是它的另一個名稱",
  "• Operator: {name}": "• 營運商：{name}",
  "• Operator: {name}, set region to {region}": "• 營運商：{name}，地區設為 {region}",
  "• Create aircraft {what}{type}{distinct}": "• 新增飛機 {what}{type}{distinct}",
  "without a tail number yet": "暫無機尾號",
  " as a different aircraft from the existing one": "，作為與現有飛機不同的另一架",
  "• Use the existing aircraft {label}, and update the details you gave": "• 使用現有飛機 {label}，並更新你提供的資料",
  "• No tail number: photos will represent the {label} type": "• 沒有機尾號：相片將代表 {label} 機型",
  "YOM {n}": "出廠年份 {n}",
  "YOR {n}": "翻新年份 {n}",
  "{n} seats": "{n} 座",
  "WIFI {status}": "WIFI {status}",
  "notes “{text}”": "備註「{text}」",
  "• Details: {facts}": "• 資料：{facts}",
  "• Details to save on it: {facts} (anything you didn't mention stays as it is)": "• 儲存到該飛機的資料：{facts}（沒提到的項目維持不變）",
  "• These photos have no aircraft or type to attach to, so they stay in Review": "• 這些相片沒有可歸屬的飛機或機型，所以會留在「審核」中",
  "• Approve {n} photo{s}: {list}": "• 核准 {n} 張相片：{list}",
  "Done.": "完成。",
  "Photo: {detail}": "相片：{detail}",
  // --- looking things up
  "{name}{region} has {n} aircraft:": "{name}{region} 有 {n} 架飛機：",
  "{name}{region} has {n} aircraft.": "{name}{region} 有 {n} 架飛機。",
  "Base: {x}": "基地：{x}",
  "{n} approved photo{s}": "{n} 張已核准相片",
  "Open {name}": "打開 {name}",
  "Open this aircraft": "打開這架飛機",
  "Nothing matches{how}. Try fewer filters.": "沒有符合的結果{how}。請減少一些篩選條件。",
  "{ops} operator{ops_s}, {n} aircraft{how}:": "{ops} 個營運商，{n} 架飛機{how}：",
  "No operator": "沒有營運商",
  "…and {n} more. Open the page to see them all.": "…還有 {n} 架。打開頁面可查看全部。",
  "Open this view on Operators & aircraft": "在「營運商與飛機」頁面打開這個檢視",
  "Hello, here are the aircraft options:": "您好，以下是飛機選項：",
};

// Characters that differ between Traditional and Simplified, only those used in this file and the labels below.
const HANS_PAIRS =
  "張:张 這:这 個:个 準:准 備:备 時:时 傳:传 給:给 視:视 於:于 訊:讯 發:发 價:价 語:语 頁:页 對:对 與:与 營:营 運:运 商:商 資:资 料:料 輛:辆 號:号 說:说 檢:检 單:单 開:开 無:无 沒:没 問:问 題:题 麼:么 應:应 該:该 裡:里 讓:让 難:难 設:设 計:计 請:请 試:试 輸:输 錯:错 誤:误 態:态 機:机 飛:飞 場:场 艙:舱 圖:图 區:区 領:领 頭:头 點:点 還:还 開:开 歷:历 錄:录 紀:纪 項:项 維:维 儲:储 歸:归 屬:属 審:审 稱:称 現:现 擇:择 選:选 條:条 認:认 確:确 絡:络 聯:联 暫:暂 載:载 額:额 當:当 擁:拥 讀:读 後:后 繼:继 續:续 變:变 動:动 為:为 無:无 係:系 嘅:嘅 喺:喺 見:见 觀:观 邊:边 麼:么 輕:轻 噴:喷 射:射 渦:涡 輪:轮 螺:螺 旋:旋 槳:桨 長:长 遠:远 程:程 級:级 類:类 別:别 舊:旧 數:数 總:总 實:实 際:际 張:张 戶:户 規:规 範:范 態:态 狀:状 隨:随 時:时 間:间 稍:稍 錄:录 驗:验 證:证 據:据 專:专 業:业 顯:显 示:示 爾:尔 艘:艘 級:级 屬:属 覽:览 絕:绝 關:关 閉:闭 優:优 勢:势 練:练 習:习 蘭:兰 寶:宝 鑰:钥 鍵:键 對:对 話:话 紙:纸 離:离 線:线 網:网 絡:络 譯:译 轉:转 換:换 擬:拟 範:范 編:编 輯:辑 紅:红 綠:绿 藍:蓝 黃:黄 鏡:镜 頻:频 聲:声 響:响 醫:医 護:护 領:领 導:导 務:务 勞:劳 權:权 號:号 碼:码 盡:尽 與:与 並:并 從:从 來:来 個:个 們:们 兩:两 軍:军 隊:队 門:门 間:间 風:风 馬:马 鳥:鸟 魚:鱼 龍:龙 齊:齐 隻:只 億:亿 萬:万 億:亿 臺:台 灣:湾 鐘:钟 錶:表 髮:发 麵:面 壞:坏 買:买 賣:卖 費:费 貴:贵 賬:账 銷:销 鮮:鲜 傳:传 價:价 優:优 倉:仓 庫:库 廠:厂 產:产 產:产 層:层 兒:儿 勝:胜 為:为 這:这 預:预 訂:订 訊:讯 詢:询 該:该 話:话 語:语 誰:谁 課:课 調:调 論:论 謝:谢 識:识 讚:赞 貨:货 質:质 購:购 資:资 趕:赶 輛:辆 較:较 輸:输 辦:办 鄉:乡 針:针 鋼:钢 錢:钱 鎖:锁 長:长 閱:阅 隨:随 難:难 電:电 靜:静 頂:顶 項:项 順:顺 須:须 預:预 頭:头 題:题 顏:颜 飲:饮 餐:餐 館:馆 養:养 驅:驱 鬆:松 鹽:盐 麗:丽 齡:龄 範:范 圍:围 圈:圈 園:园 團:团 國:国 圖:图 場:场 塊:块 夢:梦 學:学 實:实 寫:写 將:将 專:专 導:导 屆:届 帶:带 幫:帮 幣:币 廣:广 彈:弹 彙:汇 愛:爱 態:态 慣:惯 憑:凭 應:应 戲:戏 擔:担 據:据 擴:扩 擾:扰 數:数 斷:断 時:时 暫:暂 書:书 會:会 條:条 楊:杨 樣:样 標:标 樓:楼 橫:横 機:机 歡:欢 歲:岁 歷:历 殘:残 氣:气 決:决 況:况 淨:净 測:测 溝:沟 滿:满 濟:济 為:为 無:无 煙:烟 熱:热 爭:争 營:营 狀:状 環:环 現:现 產:产 當:当 發:发 盤:盘 眾:众 確:确 禮:礼 種:种 積:积 穩:稳 競:竞 節:节 範:范 築:筑 簡:简 糧:粮 紀:纪 約:约 級:级 組:组 結:结 給:给 絕:绝 統:统 絲:丝 經:经 綜:综 維:维 網:网 緊:紧 線:线 練:练 縣:县 總:总 織:织 繼:继 續:续 罰:罚 聞:闻 職:职 聯:联 聽:听 腦:脑 臨:临 與:与 興:兴 舉:举 艱:艰 藝:艺 藥:药 處:处 號:号 蟲:虫 裝:装 見:见 規:规 視:视 覽:览 觀:观 觸:触 計:计 討:讨 訓:训 記:记 設:设 許:许 論:论 證:证 評:评 詞:词 譯:译 讀:读 變:变 貝:贝 負:负 財:财 責:责 貼:贴 費:费 賓:宾 資:资 賽:赛 贈:赠 趨:趋 跡:迹 轉:转 軟:软 農:农 迴:回 迷:迷 適:适 遞:递 選:选 遲:迟 鄰:邻 醫:医 釋:释 針:针 鐵:铁 鑽:钻 關:关 隊:队 階:阶 陽:阳 際:际 雖:虽 雜:杂 離:离 難:难 靈:灵 靠:靠 面:面 鞋:鞋 頁:页 頓:顿 預:预 領:领 願:愿 類:类 顯:显 風:风 飛:飞 飯:饭 餘:余 館:馆 騎:骑 驚:惊 體:体 髮:发 鬥:斗 鬧:闹 魚:鱼 鳥:鸟 麥:麦 黨:党 齊:齐 齒:齿 報:报 連:连 併:并 內:内 過:过 訴:诉 嗎:吗 補:补 減:减 篩:筛 註:注";

const HANS = new Map<string, string>();
for (const pair of HANS_PAIRS.split(/\s+/)) {
  const [a, b] = pair.split(":");
  if (a && b && a !== b) HANS.set(a, b);
}

/** Simplified Chinese from Traditional, by character. Only used on our own wording, never on names the user typed. */
export function toHans(s: string): string {
  let out = "";
  for (const ch of s) out += HANS.get(ch) ?? ch;
  return out;
}

export type Params = Record<string, string | number>;

/** Say a sentence in the chosen language and fill its {placeholders}. Unknown sentences stay in English. */
export function tr(lang: ChatLang | undefined, template: string, params: Params = {}): string {
  let text = template;
  if (lang === "zh-Hant") text = HANT[template] ?? template;
  else if (lang === "zh-Hans") text = HANT[template] !== undefined ? toHans(HANT[template]) : template;
  return text.replace(/\{(\w+)\}/g, (_m, k: string) => (params[k] === undefined ? "" : String(params[k])));
}

export const plural = (n: number) => (n === 1 ? "" : "s");

// ---------------------------------------------------------------- fixed vocabularies

export const CATEGORY_ZH: Record<string, string> = {
  very_light_jet: "超輕型噴射機", light_jet: "輕型噴射機", midsize_jet: "中型噴射機", super_midsize_jet: "超中型噴射機",
  heavy_jet: "大型噴射機", ultra_long_range_jet: "超遠程噴射機", executive_airliner: "行政客機", turboprop: "渦輪螺旋槳機",
  helicopter: "直升機", other: "其他",
};
export function trCategory(lang: ChatLang | undefined, key: string, englishLabel: string): string {
  if (!isChinese(lang)) return englishLabel;
  const z = CATEGORY_ZH[key];
  return z ? (lang === "zh-Hans" ? toHans(z) : z) : englishLabel;
}

export const CLASSIFICATION_ZH: Record<Classification, string> = {
  exterior: "外觀", interior: "內部", floor_plan: "平面圖", unclassified: "未分類",
};
export function trClassification(lang: ChatLang | undefined, c: Classification, englishLabel: string): string {
  if (!isChinese(lang)) return englishLabel;
  return lang === "zh-Hans" ? toHans(CLASSIFICATION_ZH[c]) : CLASSIFICATION_ZH[c];
}

export function trWifi(lang: ChatLang | undefined, status: string): string {
  if (!isChinese(lang)) return status;
  const z = ({ yes: "有", no: "無", tbc: "待確認", unknown: "不明" } as Record<string, string>)[status] ?? status;
  return lang === "zh-Hans" ? toHans(z) : z;
}

const zh = (lang: ChatLang | undefined, hant: string) => (lang === "zh-Hans" ? toHans(hant) : hant);

const FIELD_ZH: Record<string, string> = { YOM: "出廠年份", YOR: "翻新年份", capacity: "載客量", Capacity: "載客量", WIFI: "WIFI", notes: "備註", Notes: "備註", "Tail number": "機尾號" };

/** What we said in English while applying a confirmed proposal ("Operator “X” created", ...), said in Chinese. */
export function trStep(lang: ChatLang | undefined, s: string): string {
  if (!isChinese(lang)) return s;
  const rules: [RegExp, (m: RegExpMatchArray) => string][] = [
    [/^Operator “(.+)” created$/, (m) => `已新增營運商「${m[1]}」`],
    [/^Region set to (.+)$/, (m) => `地區已設為 ${m[1]}`],
    [/^“(.+)” saved as another name for that operator$/, (m) => `「${m[1]}」已儲存為該營運商的另一個名稱`],
    [/^Aircraft created \(no tail number yet\)$/, () => "已新增飛機（暫無機尾號）"],
    [/^Aircraft (.+) created$/, (m) => `已新增飛機 ${m[1]}`],
    [/^Existing aircraft updated: (.+) \(earlier values are kept in its history\)$/, (m) => `已更新現有飛機：${m[1].split(", ").map((f) => FIELD_ZH[f] ?? f).join("、")}（之前的數值會保留在歷史紀錄中）`],
    [/^Existing aircraft updated: base \((.+)\)$/, (m) => `已更新現有飛機：基地（${m[1]}）`],
    [/^Existing aircraft updated: operator$/, () => "已更新現有飛機：營運商"],
    [/^approved as this aircraft$/, () => "已核准為這架飛機的相片"],
    [/^approved as representative of the type$/, () => "已核准為該機型的代表相片"],
    [/^left in Review: (.+)$/, (m) => `留在審核中：${m[1]}`],
    [/^already (.+)$/, (m) => `已是「${m[1]}」狀態`],
  ];
  for (const [re, f] of rules) {
    const m = s.match(re);
    if (m) return zh(lang, f(m));
  }
  return s;
}

/** The short notes the card reader leaves ("“10 seats” read as Capacity 10"), said in Chinese. */
export function trLoose(lang: ChatLang | undefined, s: string): string {
  if (!isChinese(lang)) return s;
  let m = s.match(/^"(.+)" read as (Notes|Tail number|Capacity (\d+)|(YOM|YOR) (\d+)|YOM \(year of manufacture\)|YOR \(year of refurbishment\))$/);
  if (m) {
    const what = m[2];
    const z = what === "Notes" ? "備註" : what === "Tail number" ? "機尾號" : what.startsWith("Capacity") ? `載客量 ${m[3]}` : what.startsWith("YOM (") ? "出廠年份" : what.startsWith("YOR (") ? "翻新年份" : `${m[4] === "YOM" ? "出廠年份" : "翻新年份"} ${m[5]}`;
    return zh(lang, `「${m[1]}」讀作${z}`);
  }
  if (s === "Base cannot combine Floating with locations") return zh(lang, "基地不能同時選擇「浮動」和地點");
  m = s.match(/^(YOM|YOR|Capacity) is not a number: (.+)$/);
  if (m) return zh(lang, `${FIELD_ZH[m[1]]} 不是數字：${m[2]}`);
  m = s.match(/^WIFI must start with Yes, No, TBC or Unknown: (.+)$/);
  if (m) return zh(lang, `WIFI 必須以「有」、「無」、「待確認」或「不明」開頭：${m[1]}`);
  return s;
}

const SORT_ZH: Record<string, string> = {
  "default": "預設", "newest (yom)": "最新（出廠年份）", "oldest (yom)": "最舊（出廠年份）",
  "most recently refurbished (yor)": "最近翻新（翻新年份）", "oldest refurbishment (yor)": "最早翻新（翻新年份）",
  "most seats": "座位最多", "fewest seats": "座位最少", "wifi (yes first)": "WIFI（有的在前）", "type a–z": "機型 A–Z",
};

/** The "what I applied" notes of a filter request ("region: Asia", "aircraft sorted by newest (yom)"), said in Chinese. */
export function trUnderstood(lang: ChatLang | undefined, s: string, categoryKeyOf: (englishLabel: string) => string | null): string {
  if (!isChinese(lang)) return s;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^region: (.+)$/))) return zh(lang, `地區：${m[1]}`);
  if (s === "no region set") return zh(lang, "未設定地區");
  if ((m = s.match(/^category: (.+)$/))) { const k = categoryKeyOf(m[1]); return zh(lang, `類別：${k ? CATEGORY_ZH[k] : m[1]}`); }
  if (s === "base: Floating") return zh(lang, "基地：浮動");
  if ((m = s.match(/^base: (.+)$/))) return zh(lang, `基地：${m[1]}`);
  if (s === "base not recorded") return zh(lang, "未記錄基地");
  if ((m = s.match(/^WIFI: (Yes|No|TBC|Unknown)$/))) return zh(lang, `WIFI：${({ Yes: "有", No: "無", TBC: "待確認", Unknown: "不明" } as Record<string, string>)[m[1]]}`);
  if ((m = s.match(/^aircraft sorted by (.+)$/))) return zh(lang, `飛機排序：${SORT_ZH[m[1]] ?? m[1]}`);
  if ((m = s.match(/^operators sorted by (.+)$/))) return zh(lang, `營運商排序：${({ region: "地區", name: "名稱", "most aircraft": "飛機最多" } as Record<string, string>)[m[1]] ?? m[1]}`);
  return s;
}
