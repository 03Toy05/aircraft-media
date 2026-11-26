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

export const QUESTIONS = ["what", "begins", "price"] as const;
export type QuestionKey = (typeof QUESTIONS)[number];
export function parseQuestion(v: string | string[] | undefined): QuestionKey | null {
  const s = Array.isArray(v) ? v[0] : v;
  return (QUESTIONS as readonly string[]).includes(s ?? "") ? (s as QuestionKey) : null;
}

export type Copy = {
  tagline: string;
  /** "Hi, I'm Toy." with the airplane as its full stop (TOY-14): `lead` + "Toy" + plane; `plain` for screen readers. */
  greeting: { lead: string; plain: string };
  promise: string;
  signIn: string;
  languageLabel: string;
  backToStart: string;
  answerLabel: string;
  questionsLabel: string;
  initial: { title: string; body: string };
  questions: Record<QuestionKey, string>;
  what: { headline: string; items: string[]; next: string };
  /** The film section of the front page: the selling point, the video (or "coming soon"), the broker's pains and the claim. */
  demo: { intro: string; watch: string; close: string; draft: string; again: string; screen: string; soon: string; soonNote: string; transcript: string; painTitle: string; pains: string[]; claim: string };
  /** The brand signature (TOY-14): `lead` + `tail`, then the airplane in place of the final period; `plain` is what screen readers hear. */
  begins: { lead: string; tail: string; plain: string; founderVideo: string; paragraphs: string[]; vision: string };
  price: { headline: string; body: string; soon: string };
  cta: string;
  footer: { rights: string; privacy: string; terms: string; contact: string };
};

export const COPY: Record<SiteLang, Copy> = {
  en: {
    tagline: "A little help for aviation.",
    greeting: { lead: "Hi, I'm ", plain: "Hi, I'm Toy." },
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
    questions: { what: "What can Toy do?", begins: "How it begins", price: "How much?" },
    what: {
      headline: "Leave the repetitive work to me.",
      items: [
        "Prepare client quotations with photos in a few clicks, as a message, a PDF or a link.",
        "Put your own logo and colour on every PDF and link.",
        "Organize and manage your aircraft photos.",
        "Find aircraft and operator information.",
        "Work with typed commands.",
      ],
      next: "Coming next: itineraries for confirmed trips.",
    },
    demo: {
      intro: "Generate a text, weblink or PDF quotation with photos in just a few clicks!",
      watch: "Watch the demo",
      close: "Close the demo",
      draft: "Draft your first quote",
      again: "Watch again",
      screen: "Toy's screen",
      soon: "Demo coming soon",
      soonNote: "The video is being made. It will play here, with captions.",
      transcript: "Read the transcript",
      painTitle: "Have you experienced this?",
      pains: [
        "Ummm… what's the YOM and capacity of this aircraft?",
        "Ohhhh man… I forgot where I saved the photos again!!",
        "It's so late now. I still have 2 more quotes to generate.",
      ],
      claim: "A quotation can take up to 5–10 minutes. With Toy's help, you can have your quote in seconds!",
    },
    begins: {
      lead: "Everything begins as a ",
      tail: "Toy",
      plain: "Everything begins as a Toy.",
      founderVideo: "A word from my creator",
      paragraphs: [
        "My creator spent 14 years as an aviation charter butler. After years of preparing quotations, searching for aircraft photos and juggling platforms, he wanted to build the assistant he always wished he had.",
        "Not every broker can afford an assistant. So he decided to build one.",
        "He believes that learning begins with play. And that's how I came to be.",
        "I'm his first creation.",
        "Now I prepare a quotation with photos in just a few clicks.",
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
    greeting: { lead: "我是", plain: "我是Toy。" },
    promise: "每位代理都值得擁有一位助理。",
    signIn: "登入",
    languageLabel: "語言",
    backToStart: "回到開始",
    answerLabel: "Toy 的回答",
    questionsLabel: "問問 Toy",
    initial: {
      title: "你想知道什麼？",
      body: "我可以協助你處理飛機相片、飛機資料和報價。你少花一點功夫，就能多花一點時間在客戶身上。",
    },
    questions: { what: "Toy 可以做什麼？", begins: "故事由此開始", price: "收費如何？" },
    what: {
      headline: "重複的工作，交給我。",
      items: [
        "幾下點擊，為客戶準備附相片的報價：訊息、PDF 或連結。",
        "每份 PDF 和連結都用上你自己的標誌和顏色。",
        "整理和管理你的飛機相片。",
        "查找飛機和營運商資料。",
        "以輸入指令的方式與我合作。",
      ],
      next: "即將推出：已確認行程的行程表。",
    },
    demo: {
      intro: "只需幾下點擊，就能生成附相片的文字、網頁連結或 PDF 報價！",
      watch: "觀看示範",
      close: "關閉示範",
      draft: "草擬您的第一份報價",
      again: "再看一次",
      screen: "Toy 的螢幕",
      soon: "示範影片即將推出",
      soonNote: "影片製作中，完成後會在這裡播放，並附字幕。",
      transcript: "閱讀文字稿",
      painTitle: "你也遇過這些情況嗎？",
      pains: [
        "嗯……這架飛機的出廠年份和座位數是多少？",
        "哎呀……我又忘了相片存在哪裡了！！",
        "已經這麼晚了，我還有兩份報價要做。",
      ],
      claim: "一份報價可能要花 5 至 10 分鐘。有 Toy 幫忙，幾秒就能完成！",
    },
    begins: {
      lead: "一切從Toy",
      tail: "開始",
      plain: "一切從Toy開始。",
      founderVideo: "我的創造者想說幾句",
      paragraphs: [
        "我的創造者在私人飛機行業做了 14 年包機管家。多年來，他不斷準備報價單、尋找飛機相片、在不同平台之間周旋，於是想打造一位他一直希望擁有的助理。",
        "不是每位代理都請得起助理。所以，他決定自己造一個。",
        "他相信，學習始於玩樂。我，就是這樣誕生的。",
        "我是他的第一個作品。",
        "如今，我只需幾下點擊，就能準備好附有相片的報價單。",
      ],
      vision: "小小的開始，紮實的腳步，邁向無限可能。",
    },
    price: {
      headline: "一點協助，不必花很多錢。",
      body: "專屬於你的工作空間、飛機資料庫、報價工具和個人助理。",
      soon: "收費資訊即將公布。",
    },
    cta: "擁有Toy吧!",
    footer: { rights: "© 2026 Aircraft Media", privacy: "私隱", terms: "條款", contact: "聯絡我們" },
  },
  "zh-hans": {
    tagline: "为航空业带来一点帮助。",
    greeting: { lead: "我是", plain: "我是Toy。" },
    promise: "每位代理都值得拥有一位助理。",
    signIn: "登录",
    languageLabel: "语言",
    backToStart: "回到开始",
    answerLabel: "Toy 的回答",
    questionsLabel: "问问 Toy",
    initial: {
      title: "你想知道什么？",
      body: "我可以协助你处理飞机照片、飞机资料和报价。你少花一点功夫，就能多花一点时间在客户身上。",
    },
    questions: { what: "Toy 可以做什么？", begins: "故事由此开始", price: "收费如何？" },
    what: {
      headline: "重复的工作，交给我。",
      items: [
        "几下点击，为客户准备附照片的报价：消息、PDF 或链接。",
        "每份 PDF 和链接都用上你自己的标志和颜色。",
        "整理和管理你的飞机照片。",
        "查找飞机和运营商资料。",
        "以输入指令的方式与我合作。",
      ],
      next: "即将推出：已确认行程的行程表。",
    },
    demo: {
      intro: "只需几下点击，就能生成附照片的文字、网页链接或 PDF 报价！",
      watch: "观看演示",
      close: "关闭演示",
      draft: "起草您的第一份报价",
      again: "再看一次",
      screen: "Toy 的屏幕",
      soon: "演示视频即将推出",
      soonNote: "视频制作中，完成后会在这里播放，并附字幕。",
      transcript: "阅读文字稿",
      painTitle: "你也遇过这些情况吗？",
      pains: [
        "嗯……这架飞机的出厂年份和座位数是多少？",
        "哎呀……我又忘了照片存在哪里了！！",
        "已经这么晚了，我还有两份报价要做。",
      ],
      claim: "一份报价可能要花 5 至 10 分钟。有 Toy 帮忙，几秒就能完成！",
    },
    begins: {
      lead: "一切从Toy",
      tail: "开始",
      plain: "一切从Toy开始。",
      founderVideo: "我的创造者想说几句",
      paragraphs: [
        "我的创造者在私人飞机行业做了 14 年包机管家。多年来，他不断准备报价单、寻找飞机照片、在不同平台之间周旋，于是想打造一位他一直希望拥有的助理。",
        "不是每位代理都请得起助理。所以，他决定自己造一个。",
        "他相信，学习始于玩乐。我，就是这样诞生的。",
        "我是他的第一个作品。",
        "如今，我只需几下点击，就能准备好附有照片的报价单。",
      ],
      vision: "小小的开始，扎实的脚步，迈向无限可能。",
    },
    price: {
      headline: "一点协助，不必花很多钱。",
      body: "专属于你的工作空间、飞机资料库、报价工具和个人助理。",
      soon: "收费信息即将公布。",
    },
    cta: "拥有Toy吧!",
    footer: { rights: "© 2026 Aircraft Media", privacy: "隐私", terms: "条款", contact: "联系我们" },
  },
};
