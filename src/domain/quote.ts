import type { WifiStatus } from "./constants";

/**
 * Quotation text for a client. Pure and client-safe: the page builds it live, the broker edits it, copies it,
 * and shares it with the photos. Only the field labels and fixed words are translated (a fixed table, no AI);
 * names, tail numbers and any notes the owner typed stay exactly as written.
 *
 * The wording of each language is a sensible default. A native speaker should read each one once and tell us
 * what to change; the table below is the only place to edit.
 */
export interface QuoteWords {
  name: string; // shown in the language picker, in that language
  hello: string;
  thanks: string;
  aircraft: string;
  operator: string;
  tail: string;
  base: string;
  yom: string;
  yor: string;
  capacity: string;
  seats: (n: number) => string;
  wifi: string;
  wifiYes: string;
  wifiNo: string;
  wifiTbc: string;
  price: string;
  notes: string;
  colon: string; // ":" or the full-width "："
}

export const QUOTE_LANGUAGES = ["en", "zh-Hant", "zh-Hans", "ja", "ko", "vi", "th", "id", "fr", "de", "ru", "ar"] as const;
export type QuoteLanguage = (typeof QUOTE_LANGUAGES)[number];

export const QUOTE_WORDS: Record<QuoteLanguage, QuoteWords> = {
  en: {
    name: "English", hello: "Hello, here are the aircraft options:", thanks: "Please let me know if you would like more details or photos.",
    aircraft: "Aircraft", operator: "Operator", tail: "Tail number", base: "Base", yom: "Manufacture", yor: "Refurbished",
    capacity: "Capacity", seats: (n) => `${n} seat${n === 1 ? "" : "s"}`, wifi: "WIFI", wifiYes: "Yes", wifiNo: "No", wifiTbc: "TBC",
    price: "Price", notes: "Notes", colon: ": ",
  },
  "zh-Hant": {
    name: "繁體中文", hello: "您好，以下是飛機選項：", thanks: "如需更多資料或照片，請隨時告訴我。",
    aircraft: "飛機", operator: "營運商", tail: "機尾編號", base: "基地", yom: "出廠年份", yor: "翻新年份",
    capacity: "載客量", seats: (n) => `${n} 座`, wifi: "WIFI", wifiYes: "有", wifiNo: "無", wifiTbc: "待確認",
    price: "價格", notes: "備註", colon: "：",
  },
  "zh-Hans": {
    name: "简体中文", hello: "您好，以下是飞机选项：", thanks: "如需更多资料或照片，请随时告诉我。",
    aircraft: "飞机", operator: "运营商", tail: "机尾编号", base: "基地", yom: "出厂年份", yor: "翻新年份",
    capacity: "载客量", seats: (n) => `${n} 座`, wifi: "WIFI", wifiYes: "有", wifiNo: "无", wifiTbc: "待确认",
    price: "价格", notes: "备注", colon: "：",
  },
  ja: {
    name: "日本語", hello: "お世話になっております。機体のご案内です。", thanks: "詳細や写真が必要でしたらお知らせください。",
    aircraft: "機体", operator: "運航会社", tail: "登録番号", base: "拠点", yom: "製造年", yor: "改装年",
    capacity: "座席数", seats: (n) => `${n}席`, wifi: "WIFI", wifiYes: "あり", wifiNo: "なし", wifiTbc: "確認中",
    price: "価格", notes: "備考", colon: "：",
  },
  ko: {
    name: "한국어", hello: "안녕하세요, 항공기 옵션을 안내드립니다.", thanks: "자세한 정보나 사진이 필요하시면 말씀해 주세요.",
    aircraft: "항공기", operator: "운항사", tail: "등록번호", base: "기지", yom: "제조 연도", yor: "개조 연도",
    capacity: "좌석 수", seats: (n) => `${n}석`, wifi: "WIFI", wifiYes: "있음", wifiNo: "없음", wifiTbc: "확인 중",
    price: "가격", notes: "비고", colon: ": ",
  },
  vi: {
    name: "Tiếng Việt", hello: "Xin chào, dưới đây là các lựa chọn máy bay:", thanks: "Vui lòng cho tôi biết nếu bạn cần thêm thông tin hoặc hình ảnh.",
    aircraft: "Máy bay", operator: "Nhà khai thác", tail: "Số đăng ký", base: "Căn cứ", yom: "Năm sản xuất", yor: "Năm tân trang",
    capacity: "Sức chứa", seats: (n) => `${n} chỗ`, wifi: "WIFI", wifiYes: "Có", wifiNo: "Không", wifiTbc: "Chưa xác nhận",
    price: "Giá", notes: "Ghi chú", colon: ": ",
  },
  th: {
    name: "ไทย", hello: "สวัสดีครับ/ค่ะ นี่คือตัวเลือกเครื่องบิน:", thanks: "หากต้องการข้อมูลหรือรูปภาพเพิ่มเติม โปรดแจ้งได้เลย",
    aircraft: "เครื่องบิน", operator: "ผู้ให้บริการ", tail: "ทะเบียนเครื่อง", base: "ฐานประจำ", yom: "ปีที่ผลิต", yor: "ปีที่ปรับปรุง",
    capacity: "ความจุ", seats: (n) => `${n} ที่นั่ง`, wifi: "WIFI", wifiYes: "มี", wifiNo: "ไม่มี", wifiTbc: "รอยืนยัน",
    price: "ราคา", notes: "หมายเหตุ", colon: ": ",
  },
  id: {
    name: "Bahasa Indonesia", hello: "Halo, berikut pilihan pesawat:", thanks: "Beri tahu saya jika Anda memerlukan detail atau foto tambahan.",
    aircraft: "Pesawat", operator: "Operator", tail: "Nomor registrasi", base: "Pangkalan", yom: "Tahun Produksi", yor: "Tahun Renovasi",
    capacity: "Kapasitas", seats: (n) => `${n} kursi`, wifi: "WIFI", wifiYes: "Ya", wifiNo: "Tidak", wifiTbc: "Menunggu konfirmasi",
    price: "Harga", notes: "Catatan", colon: ": ",
  },
  fr: {
    name: "Français", hello: "Bonjour, voici les options d'avions :", thanks: "N'hésitez pas à me demander plus de détails ou des photos.",
    aircraft: "Appareil", operator: "Opérateur", tail: "Immatriculation", base: "Base", yom: "Année de fabrication", yor: "Année de rénovation",
    capacity: "Capacité", seats: (n) => `${n} place${n === 1 ? "" : "s"}`, wifi: "WIFI", wifiYes: "Oui", wifiNo: "Non", wifiTbc: "À confirmer",
    price: "Prix", notes: "Remarques", colon: " : ",
  },
  de: {
    name: "Deutsch", hello: "Guten Tag, hier sind die Flugzeugoptionen:", thanks: "Gerne sende ich Ihnen weitere Details oder Fotos.",
    aircraft: "Flugzeug", operator: "Betreiber", tail: "Kennzeichen", base: "Heimatbasis", yom: "Baujahr", yor: "Renovierungsjahr",
    capacity: "Kapazität", seats: (n) => `${n} ${n === 1 ? "Sitz" : "Sitze"}`, wifi: "WIFI", wifiYes: "Ja", wifiNo: "Nein", wifiTbc: "Noch zu bestätigen",
    price: "Preis", notes: "Hinweise", colon: ": ",
  },
  ru: {
    name: "Русский", hello: "Здравствуйте, вот варианты самолётов:", thanks: "Сообщите, если нужны дополнительные сведения или фотографии.",
    aircraft: "Самолёт", operator: "Оператор", tail: "Бортовой номер", base: "База", yom: "Год выпуска", yor: "Год реновации",
    capacity: "Вместимость",
    seats: (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? "место" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "места" : "мест"}`,
    wifi: "WIFI", wifiYes: "Да", wifiNo: "Нет", wifiTbc: "Уточняется",
    price: "Цена", notes: "Примечания", colon: ": ",
  },
  ar: {
    name: "العربية", hello: "مرحباً، إليكم خيارات الطائرات:", thanks: "يرجى إبلاغي إن كنتم ترغبون في مزيد من التفاصيل أو الصور.",
    aircraft: "الطائرة", operator: "المشغّل", tail: "رقم التسجيل", base: "القاعدة", yom: "سنة الصنع", yor: "سنة التجديد",
    capacity: "السعة", seats: (n) => `${n} مقعد`, wifi: "WIFI", wifiYes: "نعم", wifiNo: "لا", wifiTbc: "قيد التأكيد",
    price: "السعر", notes: "ملاحظات", colon: ": ",
  },
};

export interface QuoteAircraft {
  /** Manufacturer and model, e.g. "Gulfstream G650ER". Never translated. */
  type: string;
  yom: number | null;
  yor: number | null;
  capacity: number | null;
  wifi: WifiStatus;
  /** Typed once on the aircraft ("at USD 10/MB") and carried into every quote. Never translated. */
  wifiDetail?: string | null;
  tail?: string | null;
  operator?: string | null;
  base?: string | null;
  notes?: string | null;
  /** Typed by the broker for this quote; left blank to fill in later. */
  price?: string;
}

export interface QuoteOptions {
  language: QuoteLanguage;
  /** Off by default: a broker normally does not tell the client who operates the aircraft. */
  includeOperator?: boolean;
  includeTail?: boolean;
  includeBase?: boolean;
  includeNotes?: boolean;
  greeting?: boolean;
  /** The owner's saved wording for this language; anything not set falls back to the built-in default. */
  template?: Partial<QuoteTemplate> | null;
}

/**
 * The wording the owner can change in Settings, per language. `block` is written once per aircraft and
 * its {placeholders} are filled from that aircraft. A line whose placeholders are all empty is dropped
 * (so an unknown refurbishment year leaves no blank line); a line containing {price} always stays.
 */
export interface QuoteTemplate {
  greeting: string;
  block: string;
  closing: string;
  yes: string;
  no: string;
  tbc: string;
  /** Pattern for the seat count, e.g. "{n} seats". Empty = the language's own plural rules. */
  seats: string;
}

export const TEMPLATE_PLACEHOLDERS = [
  { key: "n", help: "the aircraft number, only when quoting several (\" 1\", \" 2\")" },
  { key: "aircraft", help: "manufacturer and model" },
  { key: "tail", help: "tail number (only if “Show the tail number” is ticked)" },
  { key: "operator", help: "operator (only if “Show the operator” is ticked)" },
  { key: "base", help: "base (only if “Show the base” is ticked)" },
  { key: "yom", help: "year of manufacture" },
  { key: "yor", help: "year of refurbishment" },
  { key: "capacity", help: "seats, for example “13 seats”" },
  { key: "capacity_number", help: "just the number of seats" },
  { key: "wifi", help: "Yes / No / TBC, plus the WIFI details you saved" },
  { key: "notes", help: "notes (only if “Show notes” is ticked)" },
  { key: "price", help: "the price, left empty for you to fill in" },
] as const;

export function defaultQuoteTemplate(language: QuoteLanguage): QuoteTemplate {
  const w = QUOTE_WORDS[language] ?? QUOTE_WORDS.en;
  const c = w.colon;
  return {
    greeting: w.hello,
    block: [
      `${w.aircraft}{n}${c}{aircraft}`,
      `${w.operator}${c}{operator}`,
      `${w.tail}${c}{tail}`,
      `${w.base}${c}{base}`,
      `${w.yom}${c}{yom}`,
      `${w.yor}${c}{yor}`,
      `${w.capacity}${c}{capacity}`,
      `${w.wifi}${c}{wifi}`,
      `${w.notes}${c}{notes}`,
      `${w.price}${c}{price}`,
    ].join("\n"),
    closing: w.thanks,
    yes: w.wifiYes,
    no: w.wifiNo,
    tbc: w.wifiTbc,
    seats: "",
  };
}

/** Returns a message for the owner when the template cannot be saved, otherwise null. */
export function validateQuoteTemplate(t: Partial<QuoteTemplate>): string | null {
  const known = new Set<string>(TEMPLATE_PLACEHOLDERS.map((p) => p.key));
  for (const [field, value] of Object.entries(t)) {
    if (typeof value !== "string") return `${field} must be text`;
    if (value.length > 2000) return `${field} is too long (2000 characters at most)`;
  }
  for (const m of (t.block ?? "").matchAll(/\{([^{}]*)\}/g)) if (!known.has(m[1])) return `{${m[1]}} is not a field. Use: ${[...known].map((k) => `{${k}}`).join(", ")}`;
  if (t.block !== undefined && !t.block.includes("{aircraft}")) return "The aircraft block must contain {aircraft}, otherwise the message would not say which aircraft it is about";
  if (t.seats && !t.seats.includes("{n}")) return "The seats pattern must contain {n}, for example “{n} seats”";
  return null;
}

export interface QuoteParts { greeting: string | null; blocks: string[]; closing: string | null }

/** The message in pieces, so each aircraft's block can be edited on its own and kept when other aircraft are added. */
export function buildQuoteParts(items: QuoteAircraft[], opts: QuoteOptions): QuoteParts {
  const w = QUOTE_WORDS[opts.language] ?? QUOTE_WORDS.en;
  const base = defaultQuoteTemplate(opts.language);
  const t: QuoteTemplate = { ...base, ...Object.fromEntries(Object.entries(opts.template ?? {}).filter(([k, v]) => typeof v === "string" && (v.trim() !== "" || k === "greeting" || k === "closing"))) };
  const blocks = items.map((a, i) => {
    const word = a.wifi === "yes" ? t.yes : a.wifi === "no" ? t.no : a.wifi === "tbc" ? t.tbc : "";
    const wifi = word ? (a.wifiDetail?.trim() && a.wifi !== "tbc" ? `${word}, ${a.wifiDetail.trim()}` : word) : "";
    const values: Record<string, string> = {
      n: items.length > 1 ? ` ${i + 1}` : "",
      aircraft: a.type,
      tail: opts.includeTail && a.tail ? a.tail : "",
      operator: opts.includeOperator && a.operator ? a.operator : "",
      base: opts.includeBase && a.base ? a.base : "",
      yom: a.yom != null ? String(a.yom) : "",
      yor: a.yor != null ? String(a.yor) : "",
      capacity: a.capacity != null ? (t.seats ? t.seats.replace(/\{n\}/g, String(a.capacity)) : w.seats(a.capacity)) : "",
      capacity_number: a.capacity != null ? String(a.capacity) : "",
      wifi,
      notes: opts.includeNotes && a.notes ? a.notes : "",
      price: (a.price ?? "").trim(),
    };
    return t.block
      .split(/\r?\n/)
      .map((line) => {
        const keys = [...line.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]);
        // A line made only of fields that are empty disappears; the price line always stays so it can be filled in.
        if (keys.length > 0 && !keys.includes("price") && keys.every((k) => k === "n" || !values[k])) return null;
        return line.replace(/\{([a-z_]+)\}/g, (_m, k: string) => values[k] ?? "");
      })
      .filter((x): x is string => x !== null)
      .join("\n");
  });
  return { greeting: opts.greeting ? t.greeting : null, blocks, closing: opts.greeting ? t.closing : null };
}

/**
 * "Aircraft: Gulfstream G550 / Manufacture: 2013 / Refurbished: 2020 / Capacity: 13 seats / WIFI: Yes, at USD 10/MB / Price:"
 * Lines for unknown values are left out; Price is always present so it can be filled in.
 */
export function buildQuote(items: QuoteAircraft[], opts: QuoteOptions): string {
  const p = buildQuoteParts(items, opts);
  return [p.greeting, ...p.blocks, p.closing].filter((x): x is string => !!x).join("\n\n");
}
