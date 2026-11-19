"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { chocksTurnAction, type TurnResult } from "../chatActions";
import type { ChocksPhoto, Draft } from "@/domain/chocks";
import { CLASSIFICATION_LABEL, type Classification } from "@/domain/constants";
import { prepareShareAction, type SharePayload } from "../shareActions";
import { ShareBox } from "./ShareBox";
import { copyText } from "./copyText";
import Icon from "./Icon";
import { CHAT_LANGUAGES, parseChatLang, toHans, trClassification, type ChatLang } from "@/domain/chocksText";

/** The words on the chat itself. Chocks's own sentences come from the server in the chosen language. */
const UI_EN = {
  hi: "Hi, I'm Chocks.",
  intro: "What can I do for you?",
  doQuote: "Draft a quote", doAdd: "Add an aircraft or photos", doFind: "Find aircraft",
  addHint: "Fill in what you know (leave the rest blank), attach photos if you have them, then press Send. Nothing is saved until you confirm.",
  askHint: "Or just type or say what you need, e.g. “Give me CapaJet's G550 quote and photos”.",
  template: "Operator: \nRegion: \nAircraft type: \nTail number: \nYOM: \nCapacity: ",
  placeholderNew: "Ask Chocks, or tap Template…",
  placeholderReply: "Reply to Chocks, or add more details…",
  templateBtn: "Template", speak: "Speak", stop: "Stop", send: "Send", attach: "Photos", voiceOptions: "Voice options",
  readAloud: "Chocks reads replies aloud", autoSend: "Send when I stop speaking", voiceLanguage: "Voice language", language: "Language",
  listening: "Listening… keep talking, pauses are fine. Press Stop listening when you are done (or tick “Send when I stop speaking”). Say something like “Operator Advanced Aviation, aircraft type G280, capacity 10”.",
  noVoice: "Voice input isn't available in this browser. Chrome or Edge work best.",
  blocked: "The microphone is blocked. Allow it in the browser's address bar.",
  stopped: "Voice input stopped ({e}).", nothingHeard: "I stopped listening because I heard nothing for a while.",
  files: "{n} file(s) attached", checking: "Chocks is checking…", sorry: "Sorry, something went wrong on my side. Please try that again.",
  attached: "Attached:", copy: "Copy message", copied: "Copied. Paste it into your chat or email.",
  copyFail: "Could not copy automatically. Select the message above and copy it.",
  openAircraft: "Open the aircraft →", review: "Review queue →", view: "view?",
  sharePhotos: "Share {n} photos + message", preparing: "Preparing…",
  shared: "Shared. If the message text did not come through, paste it from Copy message.",
  cannotShare: "This browser cannot share photos directly. Open the quote on your phone, or use Open the quote.",
  photoFail: "A photo could not be loaded. Try again.",
  sendKinds: "Photos to send:", sendOption: "Option {i} · {name}: {n} photo{s} + message",
  allAtOnce: "Or everything at once: {n} photo{s}, then one message",
  optionShared: "Option {i} shared. Now share option {j} to the same chat.", allShared: "All options shared.",
  byOption: "Each button sends that option's photos, then its message. Pick the same chat each time.",
  noCombined: "No combined photo yet for {names}: it is made once the aircraft has 1 exterior, 2 cabin and 1 floor plan photo.",
  singlesInstead: "Its single photos are sent instead.",
};
type UI = typeof UI_EN;
const UI_HANT: UI = {
  hi: "你好，我是 Chocks。",
  intro: "有什麼可以幫你？",
  doQuote: "草擬報價", doAdd: "新增飛機或相片", doFind: "搜尋飛機",
  addHint: "填上你知道的資料（其餘留空），有相片可一併附上，然後按傳送。確認前不會儲存任何內容。",
  askHint: "也可以直接輸入或說出你的需要，例如「給我 CapaJet 的 G550 報價和相片」。",
  template: "營運商：\n地區：\n機型：\n機尾號：\n出廠年份：\n載客量：",
  placeholderNew: "問 Chocks，或按「範本」…",
  placeholderReply: "回覆 Chocks，或補充更多資料…",
  templateBtn: "範本", speak: "語音輸入", stop: "停止", send: "傳送", attach: "相片", voiceOptions: "語音選項",
  readAloud: "由 Chocks 朗讀回覆", autoSend: "停止說話後自動傳送", voiceLanguage: "語音語言", language: "語言",
  listening: "正在收音…請繼續說，停頓沒關係。說完後按「停止收音」（或勾選「停止說話後自動傳送」）。可以這樣說：「營運商 Advanced Aviation，機型 G280，載客量 10」。",
  noVoice: "此瀏覽器不支援語音輸入。建議使用 Chrome 或 Edge。",
  blocked: "麥克風已被封鎖。請在瀏覽器網址列允許使用麥克風。",
  stopped: "語音輸入已停止（{e}）。", nothingHeard: "因為一段時間沒有聽到聲音，已停止收音。",
  files: "已附上 {n} 個檔案", checking: "Chocks 正在查核…", sorry: "抱歉，我這邊出了問題，請再試一次。",
  attached: "附件：", copy: "複製訊息", copied: "已複製。請貼到你的聊天或電郵中。",
  copyFail: "無法自動複製。請選取上面的訊息再複製。",
  openAircraft: "打開飛機 →", review: "審核隊列 →", view: "角度？",
  sharePhotos: "分享 {n} 張相片及訊息", preparing: "準備中…",
  shared: "已分享。如訊息文字未有一併傳送，請用「複製訊息」再貼上。",
  cannotShare: "此瀏覽器無法直接分享相片。請在手機上打開，或按「打開報價」。",
  photoFail: "有相片未能載入，請再試一次。",
  sendKinds: "要傳送的相片：", sendOption: "選項 {i} · {name}：{n} 張相片及訊息",
  allAtOnce: "或一次過傳送：{n} 張相片，然後一段訊息",
  optionShared: "已分享選項 {i}。請把選項 {j} 分享到同一個對話。", allShared: "所有選項已分享。",
  byOption: "每個按鈕會先傳送該選項的相片，再傳送它的訊息。每次請選同一個對話。",
  noCombined: "{names} 仍未有組合圖：飛機要有 1 張外觀、2 張客艙及 1 張平面圖才會製作。",
  singlesInstead: "會改為傳送單張相片。",
};
const UI_HANS: UI = Object.fromEntries(Object.entries(UI_HANT).map(([k, v]) => [k, toHans(v)])) as UI;
const uiFor = (l: ChatLang): UI => (l === "zh-Hant" ? UI_HANT : l === "zh-Hans" ? UI_HANS : UI_EN);
const VOICES: { id: string; name: string }[] = [
  { id: "en-US", name: "English (US)" }, { id: "en-GB", name: "English (UK)" }, { id: "en-HK", name: "English (HK)" },
  { id: "zh-HK", name: "廣東話" }, { id: "zh-TW", name: "國語 (台灣)" }, { id: "zh-CN", name: "普通话" },
];

/** "Copy message": puts the quotation text Chocks just showed on the clipboard. */
function CopyButton({ text, ui }: { text: string; ui: UI }) {
  const [done, setDone] = useState<string | null>(null);
  return (
    <p style={{ margin: "6px 0" }}>
      <button type="button" onClick={async () => {
        setDone((await copyText(text)) ? ui.copied : ui.copyFail);
      }}>{ui.copy}</button>
      {done && <span className="small muted"> {done}</span>}
    </p>
  );
}

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));
const KINDS: Classification[] = ["exterior", "cabin", "floor_plan", "combined"];

/**
 * The quote's photos with what to send: tick the kinds (EXT, CABIN, FLOOR PLAN, COMBINED), then share option by
 * option (option 1's photos and message, then option 2's...), or everything at once.
 */
function QuoteSend({ photos, options, text, ui, lang }: { photos: ChocksPhoto[]; options: { title: string; text: string }[]; text?: string; ui: UI; lang: ChatLang }) {
  const [kinds, setKinds] = useState<Set<string>>(new Set(["exterior", "cabin", "floor_plan", "unclassified"]));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [sent, setSent] = useState<Set<number>>(new Set());
  const present = KINDS.filter((k) => photos.some((p) => p.classification === k));
  /** An option's photos of the ticked kinds. If only Combined is ticked and it has none, its single photos go instead. */
  const forOption = (i: number) => {
    const mine = photos.filter((p) => p.option === i);
    const picked = mine.filter((p) => kinds.has(p.classification ?? "unclassified"));
    if (picked.length || !kinds.has("combined") || mine.some((p) => p.classification === "combined")) return picked;
    return mine.filter((p) => p.classification !== "combined");
  };
  const all = options.flatMap((_, i) => forOption(i));
  const lacksCombined = (i: number) => !photos.some((p) => p.option === i && p.classification === "combined");
  const noCombined = kinds.has("combined") ? options.filter((_, i) => lacksCombined(i)).map((o) => o.title) : [];
  // Only say "single photos instead" when that is what happens (no single kinds ticked).
  const fallback = kinds.has("combined") && !KINDS.some((k) => k !== "combined" && kinds.has(k));

  async function share(list: ChocksPhoto[], message: string | undefined, after: () => void) {
    setBusy(true); setDone(null);
    try {
      const files = await Promise.all(list.map(async (p, i) => {
        const res = await fetch(`/api/media/${p.id}`);
        if (!res.ok) throw new Error(ui.photoFail);
        const blob = await res.blob();
        const name = `${String(i + 1).padStart(2, "0")} ${p.label}`.replace(/[\\/:*?"<>|]/g, "-");
        return new File([blob], `${name}.${EXT[blob.type] ?? "jpg"}`, { type: blob.type || "image/jpeg" });
      }));
      if (files.length && (!navigator.canShare || !navigator.canShare({ files }))) { setDone(ui.cannotShare); return; }
      // WhatsApp shows the photos first, then the message.
      await navigator.share(files.length ? (message ? { files, text: message } : { files }) : { text: message ?? "" });
      after();
    } catch (e) {
      if ((e as Error).name !== "AbortError") setDone((e as Error).message || ui.photoFail);
    } finally { setBusy(false); }
  }

  return (
    <div style={{ margin: "8px 0" }}>
      <div className="thumbs" style={{ margin: "0 0 8px" }}>
        {photos.map((p) => {
          const on = all.includes(p);
          return (
            <a key={p.id} href={`/api/media/${p.id}`} target="_blank" title={p.label} style={on ? undefined : { opacity: 0.35 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/media/${p.id}`} alt={p.label} style={{ width: 110, height: 80, objectFit: p.classification === "combined" ? "contain" : "cover", background: "#fff" }} />
            </a>
          );
        })}
      </div>
      {present.length > 1 && (
        <div className="chips" style={{ marginBottom: 6, alignItems: "center" }}>
          <span className="small">{ui.sendKinds}</span>
          {present.map((k) => {
            const on = kinds.has(k);
            return (
              <button key={k} type="button" className={`chip small${on ? " on" : ""}`} aria-pressed={on}
                onClick={() => setKinds((cur) => { const n = new Set(cur); if (n.has(k)) n.delete(k); else n.add(k); return n; })}>
                {on ? "✓ " : ""}{trClassification(lang, k, CLASSIFICATION_LABEL[k])}
              </button>
            );
          })}
        </div>
      )}
      {noCombined.length > 0 && <p className="small muted" style={{ margin: "0 0 6px" }}>{fill(ui.noCombined, { names: noCombined.join(", ") })}{fallback ? ` ${ui.singlesInstead}` : ""}</p>}
      {options.length > 1 ? (
        <>
          <div className="option-sends">
            {options.map((o, i) => {
              const n = forOption(i).length;
              const next = !sent.has(i) && [...Array(i).keys()].every((j) => sent.has(j));
              return (
                <button key={i} type="button" className={next ? undefined : "secondary"} disabled={busy}
                  onClick={() => share(forOption(i), o.text, () => { setSent((s) => new Set(s).add(i)); setDone(i < options.length - 1 ? fill(ui.optionShared, { i: i + 1, j: i + 2 }) : ui.allShared); })}>
                  <Icon name="share" />{sent.has(i) ? "✓ " : ""}{fill(ui.sendOption, { i: i + 1, name: o.title, n, s: n === 1 ? "" : "s" })}
                </button>
              );
            })}
          </div>
          <p className="small muted" style={{ margin: "4px 0" }}>{ui.byOption}</p>
          <button type="button" className="secondary" disabled={busy || all.length === 0} onClick={() => share(all, text, () => setDone(ui.shared))}>{fill(ui.allAtOnce, { n: all.length, s: all.length === 1 ? "" : "s" })}</button>
        </>
      ) : (
        <button type="button" onClick={() => share(all, text, () => setDone(ui.shared))} disabled={busy || all.length === 0}><Icon name="share" />{busy ? ui.preparing : ui.sharePhotos.replace("{n}", String(all.length))}</button>
      )}
      {done && <p className="small muted" style={{ margin: "4px 0 0" }}>{done}</p>}
    </div>
  );
}

/** The Send panel Chocks shows after "send the G280 to Mr Chan". */
function SharePanel({ aircraftId, contactId }: { aircraftId: string; contactId: string }) {
  const [p, setP] = useState<SharePayload | null | undefined>(undefined);
  useEffect(() => { prepareShareAction(aircraftId, contactId).then(setP, () => setP(null)); }, [aircraftId, contactId]);
  if (p === undefined) return <p className="muted small">Preparing…</p>;
  if (p === null) return <p className="small">I couldn't prepare that one. Try again.</p>;
  return <div style={{ marginTop: 6 }}><ShareBox aircraftId={p.aircraftId} tail={p.tail} cardText={p.cardText} items={p.items} contact={p.contact} /></div>;
}

type Msg =
  | { id: string; role: "user"; text: string; files: string[] }
  | { id: string; role: "chocks"; say: string[]; chips: { label: string; send: string }[]; draft: Draft; done?: boolean; aircraftId?: string | null; failures: string[]; share?: { aircraftId: string; contactId: string }; link?: { href: string; label: string }; photos?: ChocksPhoto[]; copy?: string; options?: { title: string; text: string }[] };

// Browser speech APIs (Chrome, Edge, Safari). Typed minimally because they are not in the standard DOM typings.
interface Recognition {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
  start(): void; stop(): void;
}
type RecognitionCtor = new () => Recognition;
const getRecognition = (): RecognitionCtor | null => {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export default function ChatClient() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [draft, setDraft] = useState<string>("");
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const [adding, setAdding] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const textRef = useRef(text);
  textRef.current = text;

  // voice
  const [canListen, setCanListen] = useState(false);
  const [canSpeak, setCanSpeak] = useState(false);
  const [listening, setListening] = useState(false);
  const [speak, setSpeak] = useState(false);
  const [autoSend, setAutoSend] = useState(false);
  const [voice, setVoice] = useState("en-US");
  const [chatLang, setChatLang] = useState<ChatLang>("en");
  const ui = uiFor(chatLang);
  const chatLangRef = useRef<ChatLang>("en");
  chatLangRef.current = chatLang;
  const [voiceMsg, setVoiceMsg] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const sendRef = useRef<(t: string) => void>(() => {});
  const autoSendRef = useRef(false);

  useEffect(() => { setCanListen(!!getRecognition()); setCanSpeak("speechSynthesis" in window); }, []);
  // Remember the chosen language on this device.
  useEffect(() => {
    try {
      const saved = parseChatLang(window.localStorage.getItem("chocksLang"));
      if (saved !== "en") { setChatLang(saved); setVoice(saved === "zh-Hans" ? "zh-CN" : "zh-HK"); }
    } catch { /* storage blocked: stay in English */ }
  }, []);
  const changeChatLang = (l: ChatLang) => {
    setChatLang(l);
    setVoice(l === "zh-Hans" ? "zh-CN" : l === "zh-Hant" ? "zh-HK" : "en-US");
    try { window.localStorage.setItem("chocksLang", l); } catch { /* ignore */ }
  };
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs]);

  const send = (override?: { text: string; label?: string }) => {
    const t = override?.text ?? text;
    if (!t.trim() && files.length === 0) return;
    const fd = new FormData();
    fd.set("text", t);
    fd.set("draft", draft);
    fd.set("lang", chatLangRef.current);
    for (const f of files) fd.append("files", f);
    setMsgs((m) => [...m, { id: crypto.randomUUID(), role: "user", text: override?.label ?? t, files: files.map((f) => f.name) }]);
    if (!override) setText("");
    setFiles([]);
    if (fileRef.current) fileRef.current.value = "";
    start(async () => {
      let r: TurnResult;
      try {
        r = await chocksTurnAction(fd);
      } catch {
        setMsgs((m) => [...m, { id: crypto.randomUUID(), role: "chocks", say: [ui.sorry], chips: [], draft: JSON.parse(draft || "null") ?? ({ photos: [] } as unknown as Draft), failures: [] }]);
        return;
      }
      setDraft(JSON.stringify(r.draft));
      setMsgs((m) => [...m, { id: crypto.randomUUID(), role: "chocks", say: r.reply.say, chips: r.reply.chips, draft: r.draft, done: r.reply.done, aircraftId: r.applied?.aircraftId, failures: r.failures, share: r.reply.share, link: r.reply.link, photos: r.reply.photos, copy: r.reply.copy, options: r.reply.options }]);
      if (speak && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(r.reply.say.join(" ").replace(/[•“”]/g, ""));
        u.lang = voice;
        window.speechSynthesis.speak(u);
      }
    });
  };
  sendRef.current = (t) => send({ text: t });
  autoSendRef.current = autoSend;

  // "/?ask=…": a spoken command from another page (the Ask Chocks microphone). Send it once, then tidy the address.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    const ask = new URLSearchParams(window.location.search).get("ask");
    if (!ask) return;
    window.history.replaceState(null, "", "/");
    setTimeout(() => sendRef.current(ask), 0);
  }, []);

  // Voice: keeps listening through pauses until you press Stop (the browser ends a session after a short silence,
  // so it is restarted and the words are joined together). With "Send when I stop speaking", a quiet spell of 3 seconds sends.
  const wantListening = useRef(false);
  const committed = useRef("");
  const baseText = useRef("");
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emptyRuns = useRef(0);

  const stopListening = (sendAfter: boolean) => {
    wantListening.current = false;
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    rec.current?.stop();
    setListening(false);
    const spoken = (baseText.current + committed.current).trim();
    if (sendAfter && spoken) setTimeout(() => sendRef.current(spoken), 0);
  };

  const startSession = () => {
    const Ctor = getRecognition();
    if (!Ctor || !wantListening.current) return;
    const r = new Ctor();
    r.lang = voice;
    r.interimResults = true;
    r.continuous = true;
    let sessionText = "";
    r.onresult = (e) => {
      sessionText = Array.from(e.results).map((x) => x[0].transcript).join(" ").trim();
      emptyRuns.current = 0;
      setText((baseText.current + committed.current + sessionText).replace(/\s+/g, " "));
      if (silenceTimer.current) clearTimeout(silenceTimer.current);
      if (autoSendRef.current) silenceTimer.current = setTimeout(() => { committed.current += sessionText + " "; sessionText = ""; stopListening(true); }, 3000);
    };
    r.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return; // quiet spell: onend restarts
      wantListening.current = false;
      setVoiceMsg(e.error === "not-allowed" ? ui.blocked : ui.stopped.replace("{e}", e.error));
    };
    r.onend = () => {
      if (sessionText) committed.current += sessionText + " ";
      else emptyRuns.current += 1;
      if (wantListening.current && emptyRuns.current < 4) { setTimeout(startSession, 150); return; }
      if (wantListening.current) setVoiceMsg(ui.nothingHeard);
      wantListening.current = false;
      setListening(false);
    };
    rec.current = r;
    try { r.start(); } catch { /* already started */ }
  };

  const toggleMic = () => {
    if (listening) { stopListening(false); return; }
    if (!getRecognition()) return;
    setVoiceMsg(null);
    wantListening.current = true;
    committed.current = "";
    emptyRuns.current = 0;
    baseText.current = textRef.current ? textRef.current.replace(/\s*$/, " ") : "";
    setListening(true);
    startSession();
  };

  // The microphone in the phone's bottom bar.
  const toggleRef = useRef(toggleMic);
  toggleRef.current = toggleMic;
  useEffect(() => {
    const on = () => toggleRef.current();
    window.addEventListener("chocks:mic", on);
    return () => window.removeEventListener("chocks:mic", on);
  }, []);
  useEffect(() => { window.dispatchEvent(new CustomEvent("chocks:listening", { detail: listening })); }, [listening]);

  const lastChocks = [...msgs].reverse().find((m) => m.role === "chocks");
  /** "Add an aircraft or photos" / Template: put the labelled template in the box and focus it. */
  const startAdd = () => {
    setAdding(true);
    setText((v) => (v.trim() ? v : ui.template));
    setTimeout(() => boxRef.current?.focus(), 0);
  };

  return (
    <div>
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "start" }}>
          <p style={{ margin: 0 }}><b>{ui.hi}</b><br />{ui.intro}</p>
          <select value={chatLang} onChange={(e) => changeChatLang(e.target.value as ChatLang)} style={{ width: "auto", flex: "0 0 auto" }} aria-label={ui.language}>
            {CHAT_LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div className="welcome-actions">
          <Link href="/quote" className="btn"><Icon name="quote" />{ui.doQuote}</Link>
          <button type="button" className="secondary" onClick={startAdd} aria-pressed={adding}><Icon name="upload" />{ui.doAdd}</button>
          <Link href="/fleet" className="btn secondary"><Icon name="search" />{ui.doFind}</Link>
        </div>
        <p className="small muted" style={{ margin: "8px 0 0" }}>{adding ? ui.addHint : ui.askHint}</p>
      </div>

      {msgs.map((m) =>
        m.role === "user" ? (
          <div key={m.id} className="card" style={{ marginLeft: "15%", background: "var(--chip, #eef4ff)" }}>
            {m.text && <pre className="cardtext" style={{ margin: 0 }}>{m.text}</pre>}
            {m.files.length > 0 && <p className="small muted" style={{ margin: "6px 0 0" }}>{ui.attached} {m.files.join(", ")}</p>}
          </div>
        ) : (
          <div key={m.id} className="card" style={{ marginRight: "8%" }}>
            <p className="small" style={{ margin: "0 0 6px" }}><b>Chocks</b></p>
            {m.failures.map((f, i) => <div key={i} className="flash err">{f}</div>)}
            {m.say.map((l, i) => <p key={i} style={{ margin: "4px 0", whiteSpace: "pre-wrap" }}>{l}</p>)}
            {m === lastChocks && m.draft.photos.length > 0 && !m.done && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0" }}>
                {m.draft.photos.map((p) => (
                  <div key={p.mediaId} className="small" style={{ width: 96 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {p.contentVersionId && <img src={`/api/media/${p.contentVersionId}`} alt="" style={{ width: 96, height: 68, objectFit: "cover", borderRadius: 4 }} />}
                    <div className="muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.classification === "unclassified" ? ui.view : p.classification.replace(/_/g, " ")}</div>
                  </div>
                ))}
              </div>
            )}
            {m.photos && m.photos.length > 0 && m.options && m.options.length > 0 && <QuoteSend photos={m.photos} options={m.options} text={m.copy} ui={ui} lang={chatLang} />}
            {m.photos && m.photos.length > 0 && !(m.options && m.options.length > 0) && (
              <div className="thumbs" style={{ margin: "8px 0" }}>
                {m.photos.map((p) => (
                  <a key={p.id} href={`/api/media/${p.id}`} target="_blank" title={p.label}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/media/${p.id}`} alt={p.label} style={{ width: 110, height: 80 }} />
                  </a>
                ))}
              </div>
            )}
            {m.copy && <CopyButton text={m.copy} ui={ui} />}
            {m.link && <p className="small"><Link href={m.link.href}>{m.link.label} →</Link></p>}
            {m.share && <SharePanel aircraftId={m.share.aircraftId} contactId={m.share.contactId} />}
            {m.done && !m.share && (
              <p className="small">
                {m.aircraftId && <><Link href={`/aircraft/${m.aircraftId}`}>{ui.openAircraft}</Link>{" "}</>}
                <Link href="/review">{ui.review}</Link>
              </p>
            )}
            {m === lastChocks && !m.done && m.chips.length > 0 && (
              <div className="row" style={{ marginTop: 6 }}>
                {m.chips.map((c) => (
                  <div key={c.label} style={{ flex: "0 0 auto" }}>
                    <button type="button" className={c.send.toLowerCase() === "confirm" ? undefined : "secondary"} disabled={pending} onClick={() => send({ text: c.send, label: c.label })}>{c.label}</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ),
      )}
      {pending && <div className="card muted" style={{ marginRight: "8%" }}>{ui.checking}</div>}
      <div ref={endRef} />

      <div className="card composer">
        <textarea
          ref={boxRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }}
          rows={Math.min(8, Math.max(2, text.split("\n").length))}
          placeholder={lastChocks && !lastChocks.done ? ui.placeholderReply : ui.placeholderNew}
          style={{ width: "100%" }}
        />
        <input ref={fileRef} type="file" hidden accept="image/jpeg,image/png,image/webp,application/pdf" multiple onChange={(e) => setFiles([...(e.target.files ?? [])])} />
        <div className="composer-bar">
          <button type="button" className="secondary" onClick={() => fileRef.current?.click()} aria-label={ui.attach}><Icon name="photos" />{files.length > 0 && <b>{files.length}</b>}<span className="lbl">{files.length > 0 ? "" : ui.attach}</span></button>
          <button type="button" className="secondary" onClick={startAdd}>{ui.templateBtn}</button>
          {canListen && <button type="button" className={listening ? "danger" : "secondary"} onClick={toggleMic} aria-pressed={listening}><Icon name="mic" /><span className="lbl">{listening ? ui.stop : ui.speak}</span></button>}
          <button type="button" className="send" onClick={() => send()} disabled={pending || (!text.trim() && files.length === 0)}><Icon name="send" />{ui.send}</button>
        </div>
        {listening && <p className="small muted">{ui.listening}</p>}
        {voiceMsg && <p className="small" style={{ color: "var(--warn)" }}>{voiceMsg}</p>}
        {files.length > 0 && <p className="small muted" style={{ margin: "6px 0 0" }}>{ui.files.replace("{n}", String(files.length))}</p>}
        <details className="voice-opts">
          <summary className="small muted">{ui.voiceOptions}</summary>
          {(canListen || canSpeak) ? (
            <div className="row small" style={{ marginTop: 6, alignItems: "center" }}>
              <label style={{ flex: "0 0 auto" }}><input type="checkbox" checked={speak} onChange={(e) => setSpeak(e.target.checked)} /> {ui.readAloud}</label>
              {canListen && <label style={{ flex: "0 0 auto" }}><input type="checkbox" checked={autoSend} onChange={(e) => setAutoSend(e.target.checked)} /> {ui.autoSend}</label>}
              {canListen && (
                <select value={voice} onChange={(e) => setVoice(e.target.value)} style={{ flex: "0 0 auto", width: "auto" }} aria-label={ui.voiceLanguage}>
                  {VOICES.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              )}
            </div>
          ) : null}
          {!canListen && <p className="small muted" style={{ margin: "6px 0 0" }}>{ui.noVoice}</p>}
        </details>
      </div>
    </div>
  );
}
