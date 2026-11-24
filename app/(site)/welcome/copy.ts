/**
 * Every word on the public site, in one place (TOY-05: English, Traditional and Simplified Chinese, kept equivalent).
 * English is the approved copy. The Chinese is a first draft and must be checked by the owner before the site is published.
 */
export const LANGS = ["en", "zh-hant", "zh-hans"] as const;
export type SiteLang = (typeof LANGS)[number];
export const LANG_NAMES: Record<SiteLang, string> = { en: "English", "zh-hant": "繁體中文", "zh-hans": "简体中文" };
export const HTML_LANG: Record<SiteLang, string> = { en: "en", "zh-hant": "zh-Hant", "zh-hans": "zh-Hans" };

export function parseLang(v: string | string[] | undefined): SiteLang {
  const s = Array.isArray(v) ? v[0] : v;
  return (LANGS as readonly string[]).includes(s ?? "") ? (s as SiteLang) : "en";
}

export const QUESTIONS = ["what", "show", "begins", "price"] as const;
export type QuestionKey = (typeof QUESTIONS)[number];
export function parseQuestion(v: string | string[] | undefined): QuestionKey | null {
  const s = Array.isArray(v) ? v[0] : v;
  return (QUESTIONS as readonly string[]).includes(s ?? "") ? (s as QuestionKey) : null;
}

export type Copy = {
  tagline: string;
  greeting: string;
  promise: string;
  signIn: string;
  languageLabel: string;
  backToStart: string;
  answerLabel: string;
  questionsLabel: string;
  initial: { title: string; body: string };
  questions: Record<QuestionKey, string>;
  what: { headline: string; items: string[]; next: string };
  show: { headline: string; soon: string; caption: string };
  begins: { headline: string; paragraphs: string[]; vision: string };
  price: { headline: string; body: string; soon: string };
  cta: string;
  footer: { rights: string; privacy: string; terms: string; contact: string };
};

export const COPY: Record<SiteLang, Copy> = {
  en: {
    tagline: "A little help for aviation.",
    greeting: "Hi, I'm Toy.",
    promise: "Every broker deserves an assistant.",
    signIn: "Sign in",
    languageLabel: "Language",
    backToStart: "Back to the start",
    answerLabel: "Toy's answer",
    questionsLabel: "Ask Toy",
    initial: {
      title: "What would you like to know?",
      body: "I help you with aircraft photos, aircraft information and quotations. A little less work for you, a little more time for your clients.",
    },
    questions: { what: "What can you do?", show: "Show me how", begins: "How it begins", price: "How much?" },
    what: {
      headline: "Leave the repetitive work to me.",
      items: [
        "Organize and manage your aircraft photos.",
        "Find aircraft and operator information.",
        "Prepare client quotations with photos.",
        "Work with typed commands.",
      ],
      next: "Coming next: PDF quotations with your own template.",
    },
    show: { headline: "Watch me at work.", soon: "Demo coming soon", caption: "Upload. Organize. Ask. Quote." },
    begins: {
      headline: "Everything begins as a Toy.",
      paragraphs: [
        "My creator spent 14 years as an aviation charter broker. After years of searching for aircraft photos, juggling platforms and preparing quotations, he wanted to build the assistant he always wished he had.",
        "Not every broker can afford an assistant. So he decided to build one.",
        "He believes that learning begins with play. And that's how I came to be.",
        "I'm his first creation.",
      ],
      vision: "Small beginning. Useful and reliable product. Bigger possibilities.",
    },
    price: {
      headline: "A little help shouldn't cost a lot.",
      body: "Your own workspace, aircraft library, quotation tools and personal assistant.",
      soon: "Pricing coming soon.",
    },
    cta: "Make Toy yours",
    footer: { rights: "© 2026 Aircraft Media", privacy: "Privacy", terms: "Terms", contact: "Contact" },
  },
  "zh-hant": {
    tagline: "為航空業帶來一點幫助。",
    greeting: "你好，我是 Toy。",
    promise: "每位經紀都值得擁有一位助理。",
    signIn: "登入",
    languageLabel: "語言",
    backToStart: "回到開始",
    answerLabel: "Toy 的回答",
    questionsLabel: "問問 Toy",
    initial: {
      title: "你想知道什麼？",
      body: "我可以協助你處理飛機相片、飛機資料和報價。你少花一點功夫，就能多花一點時間在客戶身上。",
    },
    questions: { what: "你可以做什麼？", show: "示範給我看", begins: "故事由此開始", price: "收費如何？" },
    what: {
      headline: "重複的工作，交給我。",
      items: [
        "整理和管理你的飛機相片。",
        "查找飛機和營運商資料。",
        "為客戶準備附相片的報價。",
        "以輸入指令的方式與我合作。",
      ],
      next: "即將推出：使用你自己範本的 PDF 報價。",
    },
    show: { headline: "看我工作。", soon: "示範影片即將推出", caption: "上載。整理。詢問。報價。" },
    begins: {
      headline: "一切由一個 Toy 開始。",
      paragraphs: [
        "我的創造者當了 14 年航空包機經紀。多年來，他不斷尋找飛機相片、在不同平台之間周旋、製作報價，於是想打造一位他一直渴望擁有的助理。",
        "不是每位經紀都請得起助理。所以他決定自己造一個。",
        "他相信學習始於玩樂。我就是這樣誕生的。",
        "我是他的第一個作品。",
      ],
      vision: "小小的開始。實用可靠的產品。更大的可能。",
    },
    price: {
      headline: "一點協助，不必花很多錢。",
      body: "專屬於你的工作空間、飛機資料庫、報價工具和個人助理。",
      soon: "收費資訊即將公布。",
    },
    cta: "讓 Toy 屬於你",
    footer: { rights: "© 2026 Aircraft Media", privacy: "私隱", terms: "條款", contact: "聯絡我們" },
  },
  "zh-hans": {
    tagline: "为航空业带来一点帮助。",
    greeting: "你好，我是 Toy。",
    promise: "每位经纪都值得拥有一位助理。",
    signIn: "登录",
    languageLabel: "语言",
    backToStart: "回到开始",
    answerLabel: "Toy 的回答",
    questionsLabel: "问问 Toy",
    initial: {
      title: "你想知道什么？",
      body: "我可以协助你处理飞机照片、飞机资料和报价。你少花一点功夫，就能多花一点时间在客户身上。",
    },
    questions: { what: "你可以做什么？", show: "演示给我看", begins: "故事由此开始", price: "收费如何？" },
    what: {
      headline: "重复的工作，交给我。",
      items: [
        "整理和管理你的飞机照片。",
        "查找飞机和运营商资料。",
        "为客户准备附照片的报价。",
        "以输入指令的方式与我合作。",
      ],
      next: "即将推出：使用你自己模板的 PDF 报价。",
    },
    show: { headline: "看我工作。", soon: "演示视频即将推出", caption: "上传。整理。询问。报价。" },
    begins: {
      headline: "一切由一个 Toy 开始。",
      paragraphs: [
        "我的创造者当了 14 年航空包机经纪。多年来，他不断寻找飞机照片、在不同平台之间周旋、制作报价，于是想打造一位他一直渴望拥有的助理。",
        "不是每位经纪都请得起助理。所以他决定自己造一个。",
        "他相信学习始于玩乐。我就是这样诞生的。",
        "我是他的第一个作品。",
      ],
      vision: "小小的开始。实用可靠的产品。更大的可能。",
    },
    price: {
      headline: "一点协助，不必花很多钱。",
      body: "专属于你的工作空间、飞机资料库、报价工具和个人助理。",
      soon: "收费信息即将公布。",
    },
    cta: "让 Toy 属于你",
    footer: { rights: "© 2026 Aircraft Media", privacy: "隐私", terms: "条款", contact: "联系我们" },
  },
};
