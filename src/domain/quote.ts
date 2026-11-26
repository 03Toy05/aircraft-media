import type { WifiStatus, YesNoStatus } from "./constants";
import { quoteAircraftName } from "./aircraftNamesZh";

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
  smoking: string;
  pets: string;
  cleaningFee: string;
  /** Smoking / pets: allowed or not. */
  allowed: string;
  notAllowed: string;
  price: string;
  notes: string;
  colon: string; // ":" or the full-width "："
  /** The routing line of a quote made for a request, and its passenger count. */
  routing: string;
  pax: (n: number) => string;
  /** Departure, arrival, "local time", and a flight time (12h 45m). */
  dep: string;
  arr: string;
  lt: string;
  duration: (h: number, m: number) => string;
  /** Table headings on the PDF and the client's page. */
  from: string; to: string; date: string; flightTime: string; option: string; options: string;
}

export const QUOTE_LANGUAGES = ["en", "zh-Hant", "zh-Hans", "ja", "ko", "vi", "th", "id", "fr", "de", "ru", "ar"] as const;
export type QuoteLanguage = (typeof QUOTE_LANGUAGES)[number];

/** How dates are written in each quote language. */
export const QUOTE_LOCALE: Record<QuoteLanguage, string> = {
  en: "en-GB", "zh-Hant": "zh-HK", "zh-Hans": "zh-CN", ja: "ja-JP", ko: "ko-KR", vi: "vi-VN", th: "th-TH", id: "id-ID", fr: "fr-FR", de: "de-DE", ru: "ru-RU", ar: "ar",
};

/** The default subject of a quote email, in the quote's language. */
export const QUOTE_SUBJECT: Record<QuoteLanguage, string> = {
  en: "Aircraft options", "zh-Hant": "飛機選項", "zh-Hans": "飞机选项", ja: "航空機のご提案", ko: "항공기 옵션", vi: "Các lựa chọn máy bay",
  th: "ตัวเลือกเครื่องบิน", id: "Pilihan pesawat", fr: "Options d'avion", de: "Flugzeugoptionen", ru: "Варианты самолётов", ar: "خيارات الطائرات",
};

export const QUOTE_WORDS: Record<QuoteLanguage, QuoteWords> = {
  en: {
    name: "English", hello: "Hello, here are the aircraft options:", thanks: "Please let me know if you would like more details or photos.",
    aircraft: "Aircraft", operator: "Operator", tail: "Tail number", base: "Base", yom: "Manufacture", yor: "Refurbished",
    capacity: "Capacity", seats: (n) => `${n} seat${n === 1 ? "" : "s"}`, wifi: "WIFI", wifiYes: "Yes", wifiNo: "No", wifiTbc: "TBC",
    smoking: "Smoking", pets: "Pets", cleaningFee: "Cleaning fee", allowed: "Allowed", notAllowed: "Not allowed",
    price: "Price", notes: "Notes", colon: ": ", routing: "Routing", pax: (n) => `${n} pax`, dep: "Dep", arr: "Arr", lt: "LT", from: "From", to: "To", date: "Date", flightTime: "Flight time", option: "Option", options: "Options", duration: (h, m) => `${h}h ${String(m).padStart(2, "0")}m`,
  },
  "zh-Hant": {
    name: "繁體中文", hello: "您好，以下是飛機選項：", thanks: "如需更多資料或照片，請隨時告訴我。",
    aircraft: "飛機", operator: "營運商", tail: "機尾編號", base: "基地", yom: "出廠年份", yor: "翻新年份",
    capacity: "載客量", seats: (n) => `${n} 座`, wifi: "WIFI", wifiYes: "有", wifiNo: "無", wifiTbc: "待確認",
    smoking: "吸煙", pets: "寵物", cleaningFee: "清潔費", allowed: "可以", notAllowed: "不可以",
    price: "價格", notes: "備註", colon: "：", routing: "航程", pax: (n) => `${n} 位乘客`, dep: "出發", arr: "抵達", lt: "當地時間", from: "出發地", to: "目的地", date: "日期", flightTime: "飛行時間", option: "選項", options: "選項", duration: (h, m) => `${h}小時${m}分`,
  },
  "zh-Hans": {
    name: "简体中文", hello: "您好，以下是飞机选项：", thanks: "如需更多资料或照片，请随时告诉我。",
    aircraft: "飞机", operator: "运营商", tail: "机尾编号", base: "基地", yom: "出厂年份", yor: "翻新年份",
    capacity: "载客量", seats: (n) => `${n} 座`, wifi: "WIFI", wifiYes: "有", wifiNo: "无", wifiTbc: "待确认",
    smoking: "吸烟", pets: "宠物", cleaningFee: "清洁费", allowed: "可以", notAllowed: "不可以",
    price: "价格", notes: "备注", colon: "：", routing: "航程", pax: (n) => `${n} 位乘客`, dep: "出发", arr: "抵达", lt: "当地时间", from: "出发地", to: "目的地", date: "日期", flightTime: "飞行时间", option: "选项", options: "选项", duration: (h, m) => `${h}小时${m}分`,
  },
  ja: {
    name: "日本語", hello: "お世話になっております。機体のご案内です。", thanks: "詳細や写真が必要でしたらお知らせください。",
    aircraft: "機体", operator: "運航会社", tail: "登録番号", base: "拠点", yom: "製造年", yor: "改装年",
    capacity: "座席数", seats: (n) => `${n}席`, wifi: "WIFI", wifiYes: "あり", wifiNo: "なし", wifiTbc: "確認中",
    smoking: "喫煙", pets: "ペット", cleaningFee: "清掃料", allowed: "可", notAllowed: "不可",
    price: "価格", notes: "備考", colon: "：", routing: "行程", pax: (n) => `${n}名`, dep: "出発", arr: "到着", lt: "現地時間", from: "出発地", to: "到着地", date: "日付", flightTime: "飛行時間", option: "オプション", options: "オプション", duration: (h, m) => `${h}時間${m}分`,
  },
  ko: {
    name: "한국어", hello: "안녕하세요, 항공기 옵션을 안내드립니다.", thanks: "자세한 정보나 사진이 필요하시면 말씀해 주세요.",
    aircraft: "항공기", operator: "운항사", tail: "등록번호", base: "기지", yom: "제조 연도", yor: "개조 연도",
    capacity: "좌석 수", seats: (n) => `${n}석`, wifi: "WIFI", wifiYes: "있음", wifiNo: "없음", wifiTbc: "확인 중",
    smoking: "흡연", pets: "반려동물", cleaningFee: "청소비", allowed: "가능", notAllowed: "불가",
    price: "가격", notes: "비고", colon: ": ", routing: "일정", pax: (n) => `${n}명`, dep: "출발", arr: "도착", lt: "현지 시간", from: "출발지", to: "도착지", date: "날짜", flightTime: "비행 시간", option: "옵션", options: "옵션", duration: (h, m) => `${h}시간 ${m}분`,
  },
  vi: {
    name: "Tiếng Việt", hello: "Xin chào, dưới đây là các lựa chọn máy bay:", thanks: "Vui lòng cho tôi biết nếu bạn cần thêm thông tin hoặc hình ảnh.",
    aircraft: "Máy bay", operator: "Nhà khai thác", tail: "Số đăng ký", base: "Căn cứ", yom: "Năm sản xuất", yor: "Năm tân trang",
    capacity: "Sức chứa", seats: (n) => `${n} chỗ`, wifi: "WIFI", wifiYes: "Có", wifiNo: "Không", wifiTbc: "Chưa xác nhận",
    smoking: "Hút thuốc", pets: "Thú cưng", cleaningFee: "Phí vệ sinh", allowed: "Được phép", notAllowed: "Không được phép",
    price: "Giá", notes: "Ghi chú", colon: ": ", routing: "Hành trình", pax: (n) => `${n} khách`, dep: "Khởi hành", arr: "Đến", lt: "giờ địa phương", from: "Từ", to: "Đến", date: "Ngày", flightTime: "Thời gian bay", option: "Lựa chọn", options: "Các lựa chọn", duration: (h, m) => `${h} giờ ${m} phút`,
  },
  th: {
    name: "ไทย", hello: "สวัสดีครับ/ค่ะ นี่คือตัวเลือกเครื่องบิน:", thanks: "หากต้องการข้อมูลหรือรูปภาพเพิ่มเติม โปรดแจ้งได้เลย",
    aircraft: "เครื่องบิน", operator: "ผู้ให้บริการ", tail: "ทะเบียนเครื่อง", base: "ฐานประจำ", yom: "ปีที่ผลิต", yor: "ปีที่ปรับปรุง",
    capacity: "ความจุ", seats: (n) => `${n} ที่นั่ง`, wifi: "WIFI", wifiYes: "มี", wifiNo: "ไม่มี", wifiTbc: "รอยืนยัน",
    smoking: "การสูบบุหรี่", pets: "สัตว์เลี้ยง", cleaningFee: "ค่าทำความสะอาด", allowed: "อนุญาต", notAllowed: "ไม่อนุญาต",
    price: "ราคา", notes: "หมายเหตุ", colon: ": ", routing: "เส้นทางบิน", pax: (n) => `${n} ท่าน`, dep: "ออก", arr: "ถึง", lt: "เวลาท้องถิ่น", from: "จาก", to: "ถึง", date: "วันที่", flightTime: "เวลาบิน", option: "ตัวเลือก", options: "ตัวเลือก", duration: (h, m) => `${h} ชม. ${m} นาที`,
  },
  id: {
    name: "Bahasa Indonesia", hello: "Halo, berikut pilihan pesawat:", thanks: "Beri tahu saya jika Anda memerlukan detail atau foto tambahan.",
    aircraft: "Pesawat", operator: "Operator", tail: "Nomor registrasi", base: "Pangkalan", yom: "Tahun Produksi", yor: "Tahun Renovasi",
    capacity: "Kapasitas", seats: (n) => `${n} kursi`, wifi: "WIFI", wifiYes: "Ya", wifiNo: "Tidak", wifiTbc: "Menunggu konfirmasi",
    smoking: "Merokok", pets: "Hewan peliharaan", cleaningFee: "Biaya pembersihan", allowed: "Diizinkan", notAllowed: "Tidak diizinkan",
    price: "Harga", notes: "Catatan", colon: ": ", routing: "Rute", pax: (n) => `${n} penumpang`, dep: "Berangkat", arr: "Tiba", lt: "waktu setempat", from: "Dari", to: "Ke", date: "Tanggal", flightTime: "Waktu terbang", option: "Opsi", options: "Opsi", duration: (h, m) => `${h} j ${m} m`,
  },
  fr: {
    name: "Français", hello: "Bonjour, voici les options d'avions :", thanks: "N'hésitez pas à me demander plus de détails ou des photos.",
    aircraft: "Appareil", operator: "Opérateur", tail: "Immatriculation", base: "Base", yom: "Année de fabrication", yor: "Année de rénovation",
    capacity: "Capacité", seats: (n) => `${n} place${n === 1 ? "" : "s"}`, wifi: "WIFI", wifiYes: "Oui", wifiNo: "Non", wifiTbc: "À confirmer",
    smoking: "Fumeur", pets: "Animaux", cleaningFee: "Frais de nettoyage", allowed: "Autorisé", notAllowed: "Non autorisé",
    price: "Prix", notes: "Remarques", colon: " : ", routing: "Itinéraire", pax: (n) => `${n} passager${n === 1 ? "" : "s"}`, dep: "Départ", arr: "Arrivée", lt: "heure locale", from: "De", to: "À", date: "Date", flightTime: "Temps de vol", option: "Option", options: "Options", duration: (h, m) => `${h} h ${String(m).padStart(2, "0")}`,
  },
  de: {
    name: "Deutsch", hello: "Guten Tag, hier sind die Flugzeugoptionen:", thanks: "Gerne sende ich Ihnen weitere Details oder Fotos.",
    aircraft: "Flugzeug", operator: "Betreiber", tail: "Kennzeichen", base: "Heimatbasis", yom: "Baujahr", yor: "Renovierungsjahr",
    capacity: "Kapazität", seats: (n) => `${n} ${n === 1 ? "Sitz" : "Sitze"}`, wifi: "WIFI", wifiYes: "Ja", wifiNo: "Nein", wifiTbc: "Noch zu bestätigen",
    smoking: "Rauchen", pets: "Haustiere", cleaningFee: "Reinigungsgebühr", allowed: "Erlaubt", notAllowed: "Nicht erlaubt",
    price: "Preis", notes: "Hinweise", colon: ": ", routing: "Route", pax: (n) => `${n} Passagier${n === 1 ? "" : "e"}`, dep: "Abflug", arr: "Ankunft", lt: "Ortszeit", from: "Von", to: "Nach", date: "Datum", flightTime: "Flugzeit", option: "Option", options: "Optionen", duration: (h, m) => `${h} Std. ${m} Min.`,
  },
  ru: {
    name: "Русский", hello: "Здравствуйте, вот варианты самолётов:", thanks: "Сообщите, если нужны дополнительные сведения или фотографии.",
    aircraft: "Самолёт", operator: "Оператор", tail: "Бортовой номер", base: "База", yom: "Год выпуска", yor: "Год реновации",
    capacity: "Вместимость",
    seats: (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? "место" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "места" : "мест"}`,
    wifi: "WIFI", wifiYes: "Да", wifiNo: "Нет", wifiTbc: "Уточняется",
    smoking: "Курение", pets: "Животные", cleaningFee: "Плата за уборку", allowed: "Разрешено", notAllowed: "Запрещено",
    price: "Цена", notes: "Примечания", colon: ": ", routing: "Маршрут", pax: (n) => `${n} пасс.`, dep: "Вылет", arr: "Прилёт", lt: "местное время", from: "Откуда", to: "Куда", date: "Дата", flightTime: "Время полёта", option: "Вариант", options: "Варианты", duration: (h, m) => `${h} ч ${m} мин`,
  },
  ar: {
    name: "العربية", hello: "مرحباً، إليكم خيارات الطائرات:", thanks: "يرجى إبلاغي إن كنتم ترغبون في مزيد من التفاصيل أو الصور.",
    aircraft: "الطائرة", operator: "المشغّل", tail: "رقم التسجيل", base: "القاعدة", yom: "سنة الصنع", yor: "سنة التجديد",
    capacity: "السعة", seats: (n) => `${n} مقعد`, wifi: "WIFI", wifiYes: "نعم", wifiNo: "لا", wifiTbc: "قيد التأكيد",
    smoking: "التدخين", pets: "الحيوانات الأليفة", cleaningFee: "رسوم التنظيف", allowed: "مسموح", notAllowed: "غير مسموح",
    price: "السعر", notes: "ملاحظات", colon: ": ", routing: "المسار", pax: (n) => `${n} ركاب`, dep: "المغادرة", arr: "الوصول", lt: "التوقيت المحلي", from: "من", to: "إلى", date: "التاريخ", flightTime: "مدة الرحلة", option: "خيار", options: "الخيارات", duration: (h, m) => `${h} س ${m} د`,
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
  /** Smoking and pets on board, and the cleaning fee (never translated). */
  smoking?: YesNoStatus;
  pets?: YesNoStatus;
  cleaningFee?: string | null;
  tail?: string | null;
  operator?: string | null;
  base?: string | null;
  notes?: string | null;
  /** Typed by the broker for this quote; left blank to fill in later. */
  price?: string;
  /** Extra lines the broker adds to this aircraft for this quote only. Added at the end of its block; never translated. */
  extra?: string;
}

export interface QuoteOptions {
  language: QuoteLanguage;
  /** Off by default: a broker normally does not tell the client who operates the aircraft. */
  includeOperator?: boolean;
  includeTail?: boolean;
  includeBase?: boolean;
  includeNotes?: boolean;
  /** The opening line. */
  greeting?: boolean;
  /** The closing line. When not given, follows `greeting`. */
  closing?: boolean;
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
  /** The heading above a request's routing ("Routing"). */
  routing: string;
  /** Times in the routing: "utc" = local and UTC, "local" = local only. */
  times: string;
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
  { key: "smoking", help: "smoking allowed or not" },
  { key: "pets", help: "pets allowed or not" },
  { key: "cleaning_fee", help: "the cleaning fee you saved" },
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
      `${w.smoking}${c}{smoking}`,
      `${w.pets}${c}{pets}`,
      `${w.cleaningFee}${c}{cleaning_fee}`,
      `${w.notes}${c}{notes}`,
      `${w.price}${c}{price}`,
    ].join("\n"),
    closing: w.thanks,
    yes: w.wifiYes,
    no: w.wifiNo,
    tbc: w.wifiTbc,
    seats: "",
    routing: w.routing,
    times: "utc",
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
  if (t.times !== undefined && t.times !== "utc" && t.times !== "local") return "Times must be “local and UTC” or “local only”";
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
      aircraft: quoteAircraftName(opts.language, a.type), // Chinese quotes: "灣流 G650ER（Gulfstream G650ER）"
      tail: opts.includeTail && a.tail ? a.tail : "",
      operator: opts.includeOperator && a.operator ? a.operator : "",
      base: opts.includeBase && a.base ? a.base : "",
      yom: a.yom != null ? String(a.yom) : "",
      yor: a.yor != null ? String(a.yor) : "",
      capacity: a.capacity != null ? (t.seats ? t.seats.replace(/\{n\}/g, String(a.capacity)) : w.seats(a.capacity)) : "",
      capacity_number: a.capacity != null ? String(a.capacity) : "",
      wifi,
      smoking: a.smoking === "yes" ? w.allowed : a.smoking === "no" ? w.notAllowed : "",
      pets: a.pets === "yes" ? w.allowed : a.pets === "no" ? w.notAllowed : "",
      cleaning_fee: a.cleaningFee?.trim() ?? "",
      notes: opts.includeNotes && a.notes ? a.notes : "",
      price: (a.price ?? "").trim(),
    };
    const lines = t.block
      .split(/\r?\n/)
      .map((line) => {
        const keys = [...line.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]);
        // A line made only of fields that are empty disappears; the price line always stays so it can be filled in.
        if (keys.length > 0 && !keys.includes("price") && keys.every((k) => k === "n" || !values[k])) return null;
        return line.replace(/\{([a-z_]+)\}/g, (_m, k: string) => values[k] ?? "");
      })
      .filter((x): x is string => x !== null);
    const extra = (a.extra ?? "").trim();
    return [...lines, ...(extra ? [extra] : [])].join("\n");
  });
  const closing = opts.closing ?? opts.greeting;
  return { greeting: opts.greeting ? t.greeting : null, blocks, closing: closing ? t.closing : null };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The option number belongs to the aircraft's place in the message, never to the text. A block rewritten by hand
 * keeps the broker's words, but its "Aircraft 3" label is renumbered to where the aircraft now is ("Aircraft 1"),
 * or loses the number when only one aircraft is quoted. Only the first line that starts with the template's label
 * (before {n}, bold/italic marks allowed) followed by a colon is touched.
 */
export function renumberBlock(text: string, opts: { language: QuoteLanguage; template?: Partial<QuoteTemplate> | null }, position: number, total: number): string {
  const block = opts.template?.block?.trim() ? opts.template.block : defaultQuoteTemplate(opts.language).block;
  const line = block.split(/\r?\n/).find((l) => l.includes("{n}"));
  const label = line?.slice(0, line.indexOf("{n}")).replace(/\{[a-z_]+\}/g, "").trim();
  if (!label) return text;
  const re = new RegExp(`^(\\s*[*_~]*\\s*${escapeRe(label)})(?:\\s*\\d+)?(?=\\s*[*_~]*\\s*[:：])`, "m");
  return text.replace(re, (_m, head: string) => (total > 1 ? `${head} ${position}` : head));
}

/**
 * "Aircraft: Gulfstream G550 / Manufacture: 2013 / Refurbished: 2020 / Capacity: 13 seats / WIFI: Yes, at USD 10/MB / Price:"
 * Lines for unknown values are left out; Price is always present so it can be filled in.
 */
export function buildQuote(items: QuoteAircraft[], opts: QuoteOptions): string {
  const p = buildQuoteParts(items, opts);
  return [p.greeting, ...p.blocks, p.closing].filter((x): x is string => !!x).join("\n\n");
}

/** The title at the top of the PDF and the client's page. */
export const PROPOSAL_TITLE: Record<QuoteLanguage, string> = {
  en: "Your Charter Proposal", "zh-Hant": "您的包機方案", "zh-Hans": "您的包机方案", ja: "チャーターのご提案", ko: "전세기 제안서",
  vi: "Đề xuất chuyến bay thuê riêng", th: "ข้อเสนอเที่ยวบินเช่าเหมาลำ", id: "Proposal Charter Anda", fr: "Votre proposition de vol privé",
  de: "Ihr Charterangebot", ru: "Ваше чартерное предложение", ar: "عرض رحلتك الخاصة",
};

/** The sticker on an aircraft whose owner must approve the flight. */
export const OWNER_APPROVAL: Record<QuoteLanguage, string> = {
  en: "Owner's approval required", "zh-Hant": "需經機主批准", "zh-Hans": "需经机主批准", ja: "オーナーの承認が必要", ko: "소유주 승인 필요",
  vi: "Cần chủ máy bay chấp thuận", th: "ต้องได้รับอนุมัติจากเจ้าของ", id: "Perlu persetujuan pemilik", fr: "Accord du propriétaire requis",
  de: "Zustimmung des Eigentümers erforderlich", ru: "Требуется согласие владельца", ar: "يتطلب موافقة المالك",
};

/** The price in a block written by hand: the text after "Price:" (or "價格：", in the quote's language), without *bold* marks. */
export function priceInText(block: string | undefined, priceWord: string): string {
  if (!block) return "";
  const esc = priceWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = block.match(new RegExp(`^[\\s*_~]*${esc}[\\s*_~]*[:：][\\s*_~]*(.+?)[\\s*_~]*$`, "mi"));
  return m ? m[1].trim().slice(0, 120) : "";
}
