/**
 * Aircraft names on Chinese quotes: the maker or model family in Chinese, the model number as it is
 * ("灣流 G650ER", "環球 7500", "巴航工業領航 600"). Only the client's quote in Chinese uses them (message, PDF, client
 * link); everywhere else, and in search, Toy and the records, the English name stays.
 *
 * Each rule replaces the start of the English name ("Gulfstream ", "Bombardier Global ") and keeps the rest.
 * The more specific rule comes first. A name no rule knows stays in English.
 */
type Rule = [RegExp, string, string]; // English start, Traditional (Hong Kong), Simplified (mainland)

const RULES: Rule[] = [
  [/^Gulfstream\s+/i, "灣流 ", "湾流 "],
  [/^(?:Bombardier\s+)?Global\s+/i, "環球 ", "环球 "],
  [/^(?:Bombardier\s+)?Challenger\s+/i, "挑戰者 ", "挑战者 "],
  [/^(?:Bombardier\s+)?Learjet\s+/i, "里爾 ", "里尔 "],
  [/^Bombardier\s+/i, "龐巴迪 ", "庞巴迪 "],
  [/^(?:Dassault\s+)?Falcon\s+/i, "獵鷹 ", "猎鹰 "],
  [/^Dassault\s+/i, "達索 ", "达索 "],
  [/^(?:Embraer\s+)?Phenom\s+/i, "飛鴻 ", "飞鸿 "],
  [/^(?:Embraer\s+)?Legacy\s+/i, "萊格賽 ", "莱格赛 "],
  [/^(?:Embraer\s+)?Praetor\s+/i, "巴航工業領航 ", "巴航工业领航 "],
  [/^(?:Embraer\s+)?Lineage\s+/i, "世襲 ", "世袭 "],
  [/^Embraer\s+/i, "巴西航空工業 ", "巴航工业 "],
  [/^(?:Cessna\s+)?Citation\s+Latitude\b\s*/i, "獎狀緯度 ", "奖状纬度 "],
  [/^(?:Cessna\s+)?Citation\s+Longitude\b\s*/i, "獎狀經度 ", "奖状经度 "],
  [/^(?:Cessna\s+)?Citation\s+Sovereign\b\s*/i, "獎狀君主 ", "奖状君主 "],
  [/^(?:Cessna\s+)?Citation\s+Mustang\b\s*/i, "獎狀野馬 ", "奖状野马 "],
  [/^(?:Cessna\s+)?Citation\s+/i, "獎狀 ", "奖状 "],
  [/^(?:Cessna\s+)?Grand\s+Caravan\b\s*/i, "大篷車 ", "大篷车 "],
  [/^(?:Cessna\s+)?Caravan\b\s*/i, "大篷車 ", "大篷车 "],
  [/^Cessna\s+/i, "塞斯納 ", "赛斯纳 "],
  [/^Hawker\s+/i, "豪客 ", "豪客 "],
  [/^(?:Beechcraft\s+)?King\s+Air\s+/i, "空中國王 ", "空中国王 "],
  [/^(?:Beechcraft\s+)?Premier\b\s*/i, "比奇首相 ", "比奇首相 "],
  [/^Beechcraft\s+/i, "比奇 ", "比奇 "],
  [/^Pilatus\s+/i, "皮拉圖斯 ", "皮拉图斯 "],
  [/^Daher\s+/i, "達赫 ", "达赫 "],
  [/^Piaggio\s+/i, "比亞喬 ", "比亚乔 "],
  [/^Boeing\s+BBJ\b\s*/i, "波音公務機 ", "波音公务机 "],
  [/^Boeing\s+/i, "波音 ", "波音 "],
  [/^Airbus\s+(?=ACJ)/i, "空中巴士公務機 ", "空客公务机 "],
  [/^Airbus\s+(?=(?:H\d|EC\d|AS\d))/i, "空中巴士直升機 ", "空客直升机 "],
  [/^Airbus\s+/i, "空中巴士 ", "空客 "],
  [/^Leonardo\s+/i, "李安納度 ", "莱昂纳多 "],
  [/^Sikorsky\s+/i, "西科斯基 ", "西科斯基 "],
  [/^Bell\s+/i, "貝爾 ", "贝尔 "],
  [/^Robinson\s+/i, "羅賓遜 ", "罗宾逊 "],
  [/^(?:Honda\s+)?HondaJet\b\s*/i, "本田噴氣飛機 ", "本田喷气飞机 "],
  [/^(?:Cirrus\s+)?Vision\s+Jet\b\s*/i, "西銳 ", "西锐 "],
  [/^Cirrus\s+/i, "西銳 ", "西锐 "],
];

/** The Chinese name of an aircraft type ("Gulfstream G650ER" -> "灣流 G650ER"), or null when not a Chinese quote or unknown. */
export function aircraftNameZh(lang: string, type: string): string | null {
  if (lang !== "zh-Hant" && lang !== "zh-Hans") return null;
  const name = type.trim();
  for (const [re, hant, hans] of RULES) {
    const m = name.match(re);
    if (!m) continue;
    const rest = name.slice(m[0].length).trim();
    return `${lang === "zh-Hans" ? hans : hant}${rest}`.trim();
  }
  return null;
}

/** The name on a Chinese quote: Chinese first, the English in brackets ("灣流 G650ER（Gulfstream G650ER）"); other languages unchanged. */
export function quoteAircraftName(lang: string, type: string): string {
  const zh = aircraftNameZh(lang, type);
  return zh ? `${zh}（${type.trim()}）` : type;
}
