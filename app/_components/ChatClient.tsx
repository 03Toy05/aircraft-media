"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { chocksTurnAction, type TurnResult } from "../chatActions";
import type { Draft } from "@/domain/chocks";

const TEMPLATE = "Operator: \nAircraft type: \nTail number: \nYOM: \nCapacity: ";

type Msg =
  | { id: string; role: "user"; text: string; files: string[] }
  | { id: string; role: "chocks"; say: string[]; chips: { label: string; send: string }[]; draft: Draft; done?: boolean; aircraftId?: string | null; failures: string[] };

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
  const endRef = useRef<HTMLDivElement>(null);
  const textRef = useRef(text);
  textRef.current = text;

  // voice
  const [canListen, setCanListen] = useState(false);
  const [listening, setListening] = useState(false);
  const [speak, setSpeak] = useState(false);
  const [autoSend, setAutoSend] = useState(false);
  const [lang, setLang] = useState("en-US");
  const [voiceMsg, setVoiceMsg] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const sendRef = useRef<(t: string) => void>(() => {});

  useEffect(() => { setCanListen(!!getRecognition()); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs]);

  const send = (override?: { text: string; label?: string }) => {
    const t = override?.text ?? text;
    if (!t.trim() && files.length === 0) return;
    const fd = new FormData();
    fd.set("text", t);
    fd.set("draft", draft);
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
        setMsgs((m) => [...m, { id: crypto.randomUUID(), role: "chocks", say: ["Sorry, something went wrong on my side. Please try that again."], chips: [], draft: JSON.parse(draft || "null") ?? ({ photos: [] } as unknown as Draft), failures: [] }]);
        return;
      }
      setDraft(JSON.stringify(r.draft));
      setMsgs((m) => [...m, { id: crypto.randomUUID(), role: "chocks", say: r.reply.say, chips: r.reply.chips, draft: r.draft, done: r.reply.done, aircraftId: r.applied?.aircraftId, failures: r.failures }]);
      if (speak && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(r.reply.say.join(" ").replace(/[•“”]/g, ""));
        u.lang = lang;
        window.speechSynthesis.speak(u);
      }
    });
  };
  sendRef.current = (t) => send({ text: t });

  const toggleMic = () => {
    if (listening) { rec.current?.stop(); return; }
    const Ctor = getRecognition();
    if (!Ctor) return;
    setVoiceMsg(null);
    const r = new Ctor();
    r.lang = lang;
    r.interimResults = true;
    r.continuous = false;
    const base = textRef.current ? textRef.current.replace(/\s*$/, " ") : "";
    let heard = "";
    r.onresult = (e) => {
      heard = Array.from(e.results).map((x) => x[0].transcript).join(" ").trim();
      setText(base + heard);
    };
    r.onerror = (e) => setVoiceMsg(e.error === "not-allowed" ? "The microphone is blocked. Allow it in the browser's address bar." : e.error === "no-speech" ? "I didn't hear anything." : `Voice input stopped (${e.error}).`);
    r.onend = () => {
      setListening(false);
      if (autoSend && heard) setTimeout(() => sendRef.current(base + heard), 0);
    };
    rec.current = r;
    setListening(true);
    r.start();
  };

  const lastChocks = [...msgs].reverse().find((m) => m.role === "chocks");

  return (
    <div>
      <div className="card" style={{ marginBottom: 12 }}>
        <p style={{ margin: 0 }}><b>Hi, I'm Chocks.</b> Send me photos and details and I'll check what you already have, ask about anything unclear, and file it once you confirm.</p>
        <pre className="cardtext" style={{ marginBottom: 0 }}>{TEMPLATE}</pre>
      </div>

      {msgs.map((m) =>
        m.role === "user" ? (
          <div key={m.id} className="card" style={{ marginLeft: "15%", background: "var(--chip, #eef4ff)" }}>
            {m.text && <pre className="cardtext" style={{ margin: 0 }}>{m.text}</pre>}
            {m.files.length > 0 && <p className="small muted" style={{ margin: "6px 0 0" }}>Attached: {m.files.join(", ")}</p>}
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
                    <div className="muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.classification === "unclassified" ? "view?" : p.classification.replace(/_/g, " ")}</div>
                  </div>
                ))}
              </div>
            )}
            {m.done && (
              <p className="small">
                {m.aircraftId && <><Link href={`/aircraft/${m.aircraftId}`}>Open the aircraft →</Link>{" "}</>}
                <Link href="/review">Review queue →</Link>
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
      {pending && <div className="card muted" style={{ marginRight: "8%" }}>Chocks is checking…</div>}
      <div ref={endRef} />

      <div className="card" style={{ position: "sticky", bottom: 8 }}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }}
          rows={Math.min(8, Math.max(2, text.split("\n").length))}
          placeholder={lastChocks && !lastChocks.done ? "Reply to Chocks, or add more details…" : "Operator: \nAircraft type: \nYOM: \nCapacity: "}
          style={{ width: "100%" }}
        />
        <div className="row" style={{ marginTop: 6, alignItems: "center" }}>
          <div style={{ flex: "0 0 auto" }}>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple onChange={(e) => setFiles([...(e.target.files ?? [])])} />
          </div>
          <div style={{ flex: "0 0 auto" }}><button type="button" className="secondary" onClick={() => setText((v) => (v.trim() ? v : TEMPLATE))}>Template</button></div>
          {canListen && (
            <div style={{ flex: "0 0 auto" }}>
              <button type="button" className={listening ? "danger" : "secondary"} onClick={toggleMic} aria-pressed={listening}>{listening ? "Stop" : "Speak"}</button>
            </div>
          )}
          <div style={{ flex: "0 0 auto" }}><button type="button" onClick={() => send()} disabled={pending || (!text.trim() && files.length === 0)}>Send</button></div>
        </div>
        {(canListen || "speechSynthesis" in (typeof window === "undefined" ? {} : window)) && (
          <div className="row small" style={{ marginTop: 6, alignItems: "center" }}>
            <label style={{ flex: "0 0 auto" }}><input type="checkbox" checked={speak} onChange={(e) => setSpeak(e.target.checked)} /> Chocks reads replies aloud</label>
            {canListen && <label style={{ flex: "0 0 auto" }}><input type="checkbox" checked={autoSend} onChange={(e) => setAutoSend(e.target.checked)} /> Send when I stop speaking</label>}
            {canListen && (
              <select value={lang} onChange={(e) => setLang(e.target.value)} style={{ flex: "0 0 auto", width: "auto" }} aria-label="Voice language">
                <option value="en-US">English (US)</option><option value="en-GB">English (UK)</option><option value="en-HK">English (HK)</option>
              </select>
            )}
          </div>
        )}
        {listening && <p className="small muted">Listening… say something like “Operator Advanced Aviation, aircraft type G280, capacity 10”.</p>}
        {voiceMsg && <p className="small" style={{ color: "var(--warn)" }}>{voiceMsg}</p>}
        {!canListen && <p className="small muted">Voice input isn't available in this browser. Chrome or Edge work best.</p>}
        {files.length > 0 && <p className="small muted">{files.length} file(s) attached</p>}
      </div>
    </div>
  );
}
