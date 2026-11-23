"use client";

/** Browser speech recognition (Chrome, Edge, Samsung Internet, Safari). Typed minimally: it is not in the standard DOM typings. */
export interface Recognition {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null;
  start(): void; stop(): void;
}
type RecognitionCtor = new () => Recognition;

export const getRecognition = (): RecognitionCtor | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

const VOICE_KEY = "chocksVoice";
/** The voice language picked next to Toy's microphone on this device, if one was picked. */
export function savedVoice(): string | null {
  try { return window.localStorage.getItem(VOICE_KEY); } catch { return null; }
}
export function saveVoice(v: string) {
  try { window.localStorage.setItem(VOICE_KEY, v); } catch { /* storage blocked: kept for this visit only */ }
}

/** The voice language: the one picked next to Toy's microphone, else the one that goes with Toy's language. */
export function voiceLang(): string {
  const picked = savedVoice();
  if (picked) return picked;
  try {
    const l = window.localStorage.getItem("chocksLang");
    return l === "zh-Hant" ? "zh-HK" : l === "zh-Hans" ? "zh-CN" : "en-US";
  } catch { return "en-US"; }
}

/**
 * Listen until `stop()` is called, or until `silenceMs` passes with nothing new. The browser ends a session after a
 * short pause, so it is restarted and the words are joined. Calls `onText` with everything heard so far.
 */
export function listen(opts: { lang?: string; silenceMs?: number; onText: (text: string, final: boolean) => void; onEnd: (text: string) => void; onError?: (message: string) => void }) {
  const Ctor = getRecognition();
  if (!Ctor) { opts.onError?.("Voice input isn't available in this browser. Use the microphone on your keyboard instead."); opts.onEnd(""); return () => {}; }
  let want = true;
  let committed = "";
  let session = "";
  let empty = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let rec: Recognition | null = null;
  const finish = () => {
    if (!want) return;
    want = false;
    if (timer) clearTimeout(timer);
    rec?.stop();
    opts.onEnd((committed + session).replace(/\s+/g, " ").trim());
  };
  const arm = () => {
    if (timer) clearTimeout(timer);
    if (opts.silenceMs) timer = setTimeout(finish, opts.silenceMs);
  };
  const start = () => {
    if (!want) return;
    const r = new Ctor();
    r.lang = opts.lang ?? voiceLang();
    r.interimResults = true;
    r.continuous = true;
    session = "";
    r.onresult = (e) => {
      session = Array.from(e.results).map((x) => x[0].transcript).join(" ").trim();
      empty = 0;
      opts.onText((committed + session).replace(/\s+/g, " ").trim(), false);
      arm();
    };
    r.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      opts.onError?.(e.error === "not-allowed" ? "The microphone is blocked. Allow it for this site in the browser's settings." : `Voice input stopped (${e.error}).`);
      finish();
    };
    r.onend = () => {
      if (session) committed += session + " ";
      else empty += 1;
      session = "";
      if (want && empty < 3) { setTimeout(start, 150); return; }
      finish();
    };
    rec = r;
    try { r.start(); } catch { /* already started */ }
  };
  start();
  arm();
  return finish;
}

// ---------------------------------------------------------------- page commands

/** What a page did with a spoken command. `followUp` is a button to press (sharing and copying need a tap). */
export interface CommandResult { said: string[]; followUp?: { label: string; run: () => void }; passOn?: string }
type Handler = (text: string) => CommandResult | null;

let handler: Handler | null = null;
/** A page that understands spoken commands registers here; returns the function that removes it. */
export function registerCommands(h: Handler) {
  handler = h;
  return () => { if (handler === h) handler = null; };
}
export const pageCommands = () => handler;
