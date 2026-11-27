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

export const QUESTIONS = ["what", "try", "begins", "price"] as const;
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
  /** Under the promise: what Toy does, the benefit, the demo button and the founder credential. */
  hero: { does: string; benefit: string; watch: string; watchSub: string; builtBy: string };
  /** "Let me try": a few taps on sample data (no real workspace). */
  tryIt: { headline: string; intro: string; chips: string[]; found: string; interior: string; rooms: string[]; quoteDone: string; quote: string; quoteWays: string; sample: string; soon: string; clientLink: string };
  /** Toy's next question at the end of each answer. */
  next: { start: string; what: string; tryIt: string; begins: string };
  /** The time calculator inside "How much?" (illustrative: the visitor's own numbers). */
  calc: { title: string; intro: string; perDay: string; minutes: string; days: string; monthly: string; equiv: string; hours: string; workdays: string; note: string; closing: string };
  /** "Before you ask": honest answers to the usual hesitations (fact-checked against the app, 27 Nov 2026). */
  faq: { title: string; items: { q: string; a: string }[] };
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
  begins: { lead: string; tail: string; plain: string; founderVideo: string; founderCta: string; paragraphs: string[]; vision: string };
  price: { headline: string; body: string; soon: string };
  cta: string;
  footer: { rights: string; privacy: string; terms: string; contact: string };
};

export const COPY: Record<SiteLang, Copy> = {
  en: {
    tagline: "A little help for aviation.",
    greeting: { lead: "Hey! I'm ", plain: "Hey! I'm Toy." },
    promise: "Every broker deserves an assistant.",
    hero: {
      does: "Find aircraft photos. Organize your library. Prepare client quotations.",
      benefit: "Less admin. More brokering.",
      watch: "Watch me at work",
      watchSub: "Meet your assistant in under 2 minutes",
      builtBy: "Built by a broker, for brokers.",
    },
    tryIt: {
      headline: "Give me something to do!",
      intro: "Tap one. This is sample data, not a real workspace.",
      soon: "Coming soon: try me with real aircraft and photos, right here.",
      clientLink: "See what your client receives",
      chips: ["Find me a Gulfstream G650", "Show me the aircraft interior", "Prepare a client quotation"],
      found: "Found it! Gulfstream G650 · Sample Air · based in Hong Kong · made in 2016 · 14 seats · WIFI.",
      interior: "Here you go: the cabin, the bedroom and the galley.",
      rooms: ["Cabin", "Bedroom", "Galley"],
      quoteDone: "Done! Here's your quote:",
      quote: "Hello, here are the aircraft options:\n\nAircraft: Gulfstream G650\nOperator: Sample Air\nBase: Hong Kong\nManufacture: 2016\nCapacity: 14 seats\nWIFI: Yes\nPrice: USD [your price]\n\nPlease let me know if you would like more details or photos.",
      quoteWays: "Your client gets it as a message, a web link or a PDF, with the photos.",
      sample: "Sample data",
    },
    next: { start: "What can you do?", what: "Want to see me in action?", tryIt: "How much time could I save you?", begins: "Want to see me in action?" },
    calc: {
      title: "How much time could Toy give you back?",
      intro: "Adjust the numbers to match your own working day.",
      perDay: "Quotations per day",
      minutes: "Minutes saved per quotation",
      days: "Working days per month",
      monthly: "Time back each month",
      equiv: "Equivalent 8-hour working days",
      hours: "hours",
      workdays: "days",
      note: "An estimate from your numbers, not measured product performance.",
      closing: "More time for your clients. More time for brokering.",
    },
    faq: {
      title: "Before you ask",
      items: [
        { q: "Can other brokers see my aircraft library?", a: "No. Your operators, aircraft, photos, contacts and quotes stay in your own workspace. Aircraft Media also keeps a shared photo library: your photos join it only if you switch on sharing in Settings and we approve each one. It never includes prices, quotes, contacts or notes. Our platform admin can view any workspace, read-only." },
        { q: "Who can see my client information?", a: "Your quotes, saved requests and contacts are private to your workspace. Contacts are optional: if you save the people you send aircraft to (name and messenger), only you see them. The client link you share shows the quote: aircraft, routing, prices and photos, never your contacts. Anyone who has the link can open it. It is a long random code, and you can switch it off or give it an end date. Our platform admin can view any workspace, read-only." },
        { q: "Can I use my existing aircraft photos?", a: "Yes. Upload JPG, PNG or WebP photos, or operator brochures as PDFs, and I take the photos out of them. Choose many files at once. You decide what each photo shows (exterior, cabin, floor plan), and nothing is used until you approve it. Your originals are kept. HEIC photos are not supported." },
        { q: "Can I use Toy on my phone?", a: "Yes, in your phone's browser. There is no app to install. Talk or type to me, build quotes, review photos and send through WhatsApp or any app on your phone. Our conversation carries over between your phone and your computer." },
        { q: "Can I cancel?", a: "Yes, you can cancel or delete your account yourself in Settings. Cancelling makes your workspace view-only and keeps everything, and you can reopen it anytime. Deleting removes your workspace for good. Your free trial lasts 14 days from your first sign-in, with no payment and no card, and we email you 3 days before it ends." },
        { q: "Does Toy need AI credits or charge per use?", a: "No, not at this stage: there are no AI credits and no per-use charges. As I become more advanced, token charges may apply. You can send up to 40 quote emails a day." },
      ],
    },
    signIn: "Sign in",
    languageLabel: "Language",
    backToStart: "Back to the start",
    answerLabel: "Toy's answer",
    questionsLabel: "Ask Toy",
    initial: {
      title: "What would you like to know?",
      body: "I help you with aircraft photos, aircraft information and quotations. A little less work for you, a little more time for your clients.",
    },
    questions: { what: "What can Toy do?", try: "Let me try", begins: "How it begins", price: "How much?" },
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
      founderCta: "See Toy draft a quote",
      paragraphs: [
        "My creator spent 14 years as an aviation charter butler. After years of preparing quotations, searching for aircraft photos and juggling platforms, he wanted to build the assistant he always wished he had.",
        "Not every broker can afford an assistant. So he decided to build one.",
        "He believes that learning begins with play. And that's how I came to be.",
        "I'm his first creation.",
        "Now I prepare a quotation with photos in just a few clicks.",
        "And I'd love to be your assistant too.",
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
    hero: {
      does: "尋找飛機相片。整理你的資料庫。準備客戶報價。",
      benefit: "少點雜務，專心代理。",
      watch: "看我工作",
      watchSub: "兩分鐘內認識你的助理",
      builtBy: "由代理打造，為代理而設。",
    },
    tryIt: {
      headline: "給我一點工作吧！",
      intro: "點一個試試。這是示範資料，不是真實的工作區。",
      soon: "即將推出：在這裡用真實的飛機和相片試試我。",
      clientLink: "看看客戶會收到甚麼",
      chips: ["幫我找一架 Gulfstream G650", "給我看機艙內部", "準備一份客戶報價"],
      found: "找到了！Gulfstream G650 · Sample Air · 基地香港 · 2016 年出廠 · 14 座 · 有 WIFI。",
      interior: "給你：主艙、睡房和廚房。",
      rooms: ["主艙", "睡房", "廚房"],
      quoteDone: "完成！這是你的報價：",
      quote: "你好，以下是飛機選擇：\n\n飛機：Gulfstream G650\n營運商：Sample Air\n基地：香港\n出廠年份：2016\n座位：14 座\nWIFI：有\n價格：USD [你的價格]\n\n如需更多資料或相片，請告訴我。",
      quoteWays: "客戶會收到訊息、網頁連結或 PDF，連同相片。",
      sample: "示範資料",
    },
    next: { start: "你可以做什麼？", what: "想看我實際操作嗎？", tryIt: "我可以幫你省多少時間？", begins: "想看我實際操作嗎？" },
    calc: {
      title: "Toy 可以幫你省回多少時間？",
      intro: "按你自己的工作日調整數字。",
      perDay: "每天報價數量",
      minutes: "每份報價節省的分鐘",
      days: "每月工作天數",
      monthly: "每月省回的時間",
      equiv: "相當於 8 小時工作天",
      hours: "小時",
      workdays: "天",
      note: "按你輸入的數字估算，並非實際量度的產品表現。",
      closing: "多點時間陪客戶，多點時間做代理。",
    },
    faq: {
      title: "你可能想問",
      items: [
        { q: "其他代理看得到我的飛機資料庫嗎？", a: "看不到。你的營運商、飛機、相片、聯絡人和報價都留在你自己的工作空間。Aircraft Media 另有一個共享相片庫：只有你在設定中開啟分享，並由我們逐張批准，你的相片才會加入。共享庫永不包括價格、報價、聯絡人或備註。平台管理員可以唯讀方式查看任何工作空間。" },
        { q: "誰可以看到我的客戶資料？", a: "你的報價、已儲存的請求和聯絡人只屬於你的工作空間。聯絡人是可選的：如果你儲存了收件人（名字和通訊工具），只有你看得到。你分享的客戶連結只會顯示報價：飛機、航線、價格和相片，永不顯示你的聯絡人。任何持有連結的人都能打開；連結是一串很長的隨機碼，你可以隨時關閉，或設定到期日。平台管理員可以唯讀方式查看任何工作空間。" },
        { q: "可以用我現有的飛機相片嗎？", a: "可以。上載 JPG、PNG 或 WebP 相片，或營運商的 PDF 小冊子，我會把裡面的相片取出來。可以一次選擇多個檔案。每張相片拍的是甚麼（外觀、機艙、平面圖）由你決定，經你批准後才會使用。原檔會保留。暫不支援 HEIC 相片。" },
        { q: "可以在手機上用 Toy 嗎？", a: "可以，用手機瀏覽器就行，不用安裝應用程式。跟我說話或打字、製作報價、審閱相片，再經 WhatsApp 或手機上任何應用程式發送。我們的對話在手機和電腦之間同步。" },
        { q: "可以取消嗎？", a: "可以，你可以在設定中自行取消或刪除帳戶。取消後工作空間會變成只供查看，所有資料都會保留，你隨時可以重新開啟。刪除會永久移除你的工作空間。免費試用由你首次登入起計 14 天，不用付款，也不用信用卡，結束前 3 天我們會電郵通知你。" },
        { q: "Toy 需要 AI 點數或按次收費嗎？", a: "現階段不需要：沒有 AI 點數，也不按次收費。隨著我變得更先進，日後可能會收取 token 費用。每天最多可發送 40 封報價電郵。" },
      ],
    },
    signIn: "登入",
    languageLabel: "語言",
    backToStart: "回到開始",
    answerLabel: "Toy 的回答",
    questionsLabel: "問問 Toy",
    initial: {
      title: "你想知道什麼？",
      body: "我可以協助你處理飛機相片、飛機資料和報價。你少花一點功夫，就能多花一點時間在客戶身上。",
    },
    questions: { what: "Toy 可以做什麼？", try: "讓我試試", begins: "故事由此開始", price: "收費如何？" },
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
      founderCta: "看 Toy 草擬報價",
      paragraphs: [
        "我的創造者在私人飛機行業做了 14 年包機管家。多年來，他不斷準備報價單、尋找飛機相片、在不同平台之間周旋，於是想打造一位他一直希望擁有的助理。",
        "不是每位代理都請得起助理。所以，他決定自己造一個。",
        "他相信，學習始於玩樂。我，就是這樣誕生的。",
        "我是他的第一個作品。",
        "如今，我只需幾下點擊，就能準備好附有相片的報價單。",
        "我也很想成為你的助理。",
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
    hero: {
      does: "寻找飞机照片。整理你的资料库。准备客户报价。",
      benefit: "少点杂务，专心代理。",
      watch: "看我工作",
      watchSub: "两分钟内认识你的助理",
      builtBy: "由代理打造，为代理而设。",
    },
    tryIt: {
      headline: "给我一点工作吧！",
      intro: "点一个试试。这是示范资料，不是真实的工作区。",
      soon: "即将推出：在这里用真实的飞机和照片试试我。",
      clientLink: "看看客户会收到什么",
      chips: ["帮我找一架 Gulfstream G650", "给我看机舱内部", "准备一份客户报价"],
      found: "找到了！Gulfstream G650 · Sample Air · 基地香港 · 2016 年出厂 · 14 座 · 有 WIFI。",
      interior: "给你：主舱、卧室和厨房。",
      rooms: ["主舱", "卧室", "厨房"],
      quoteDone: "完成！这是你的报价：",
      quote: "你好，以下是飞机选择：\n\n飞机：Gulfstream G650\n运营商：Sample Air\n基地：香港\n出厂年份：2016\n座位：14 座\nWIFI：有\n价格：USD [你的价格]\n\n如需更多资料或照片，请告诉我。",
      quoteWays: "客户会收到信息、网页链接或 PDF，连同照片。",
      sample: "示范资料",
    },
    next: { start: "你可以做什么？", what: "想看我实际操作吗？", tryIt: "我可以帮你省多少时间？", begins: "想看我实际操作吗？" },
    calc: {
      title: "Toy 可以帮你省回多少时间？",
      intro: "按你自己的工作日调整数字。",
      perDay: "每天报价数量",
      minutes: "每份报价节省的分钟",
      days: "每月工作天数",
      monthly: "每月省回的时间",
      equiv: "相当于 8 小时工作天",
      hours: "小时",
      workdays: "天",
      note: "按你输入的数字估算，并非实际量度的产品表现。",
      closing: "多点时间陪客户，多点时间做代理。",
    },
    faq: {
      title: "你可能想问",
      items: [
        { q: "其他代理看得到我的飞机资料库吗？", a: "看不到。你的运营商、飞机、照片、联系人和报价都留在你自己的工作空间。Aircraft Media 另有一个共享照片库：只有你在设置中开启分享，并由我们逐张批准，你的照片才会加入。共享库永不包括价格、报价、联系人或备注。平台管理员可以只读方式查看任何工作空间。" },
        { q: "谁可以看到我的客户资料？", a: "你的报价、已保存的请求和联系人只属于你的工作空间。联系人是可选的：如果你保存了收件人（名字和通讯工具），只有你看得到。你分享的客户链接只会显示报价：飞机、航线、价格和照片，永不显示你的联系人。任何持有链接的人都能打开；链接是一串很长的随机码，你可以随时关闭，或设置到期日。平台管理员可以只读方式查看任何工作空间。" },
        { q: "可以用我现有的飞机照片吗？", a: "可以。上传 JPG、PNG 或 WebP 照片，或运营商的 PDF 宣传册，我会把里面的照片取出来。可以一次选择多个文件。每张照片拍的是什么（外观、机舱、平面图）由你决定，经你批准后才会使用。原文件会保留。暂不支持 HEIC 照片。" },
        { q: "可以在手机上用 Toy 吗？", a: "可以，用手机浏览器就行，不用安装应用。跟我说话或打字、制作报价、审阅照片，再经 WhatsApp 或手机上任何应用发送。我们的对话在手机和电脑之间同步。" },
        { q: "可以取消吗？", a: "可以，你可以在设置中自行取消或删除账户。取消后工作空间会变成只能查看，所有资料都会保留，你随时可以重新开启。删除会永久移除你的工作空间。免费试用由你首次登录起计 14 天，不用付款，也不用信用卡，结束前 3 天我们会发邮件通知你。" },
        { q: "Toy 需要 AI 点数或按次收费吗？", a: "现阶段不需要：没有 AI 点数，也不按次收费。随着我变得更先进，日后可能会收取 token 费用。每天最多可发送 40 封报价邮件。" },
      ],
    },
    signIn: "登录",
    languageLabel: "语言",
    backToStart: "回到开始",
    answerLabel: "Toy 的回答",
    questionsLabel: "问问 Toy",
    initial: {
      title: "你想知道什么？",
      body: "我可以协助你处理飞机照片、飞机资料和报价。你少花一点功夫，就能多花一点时间在客户身上。",
    },
    questions: { what: "Toy 可以做什么？", try: "让我试试", begins: "故事由此开始", price: "收费如何？" },
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
      founderCta: "看 Toy 起草报价",
      paragraphs: [
        "我的创造者在私人飞机行业做了 14 年包机管家。多年来，他不断准备报价单、寻找飞机照片、在不同平台之间周旋，于是想打造一位他一直希望拥有的助理。",
        "不是每位代理都请得起助理。所以，他决定自己造一个。",
        "他相信，学习始于玩乐。我，就是这样诞生的。",
        "我是他的第一个作品。",
        "如今，我只需几下点击，就能准备好附有照片的报价单。",
        "我也很想成为你的助理。",
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
