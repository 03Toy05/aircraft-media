"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { chocksTurnAction, type TurnResult } from "../chatActions";
import type { Draft } from "@/domain/chocks";
import { prepareShareAction, type SharePayload } from "../shareActions";
import { ShareBox } from "./ShareBox";

/** "Copy message": puts the quotation text Chocks just showed on the clipboard. */
function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState<string | null>(null);
  return (
    <p style={{ margin: "6px 0" }}>
      <button type="button" onClick={async () => {
        try { await navigator.clipboard.writeText(text); setDone("Copied. Paste it into your chat or email."); }
        catch { setDone("Could not copy automatically. Select the message above and copy it."); }
      }}>Copy message</button>
      {done && <span className="small muted"> {done}</span>}
    </p>
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

const TEMPLATE = "Operator: \nRegion: \nAircraft type: \nTail number: \nYOM: \nCapacity: ";

type Msg =
  | { id: string; role: "user"; text: string; files: string[] }
  | { id: string; role: "chocks"; say: string[]; chips: { label: string; send: string }[]; draft: Draft; done?: boolean; aircraftId?: string | null; failures: string[]; share?: { aircraftId: string; contactId: string }; link?: { href: string; label: string }; photos?: { id: string; label: string }[]; copy?: string };

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
  const autoSendRef = useRef(false);

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
      setMsgs((m) => [...m, { id: crypto.randomUUID(), role: "chocks", say: r.reply.say, chips: r.reply.chips, draft: r.draft, done: r.reply.done, aircraftId: r.applied?.aircraftId, failures: r.failures, share: r.reply.share, link: r.reply.link, photos: r.reply.photos, copy: r.reply.copy }]);
      if (speak && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(r.reply.say.join(" ").replace(/[•“”]/g, ""));
        u.lang = lang;
        window.speechSynthesis.speak(u);
      }
    });
  };
  sendRef.current = (t) => send({ text: t });
  autoSendRef.current = autoSend;

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
    r.lang = lang;
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
      setVoiceMsg(e.error === "not-allowed" ? "The microphone is blocked. Allow it in the browser's address bar." : `Voice input stopped (${e.error}).`);
    };
    r.onend = () => {
      if (sessionText) committed.current += sessionText + " ";
      else emptyRuns.current += 1;
      if (wantListening.current && emptyRuns.current < 4) { setTimeout(startSession, 150); return; }
      if (wantListening.current) setVoiceMsg("I stopped listening because I heard nothing for a while.");
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
            {m.photos && m.photos.length > 0 && (
              <div className="thumbs" style={{ margin: "8px 0" }}>
                {m.photos.map((p) => (
                  <a key={p.id} href={`/api/media/${p.id}`} target="_blank" title={p.label}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/media/${p.id}`} alt={p.label} style={{ width: 110, height: 80 }} />
                  </a>
                ))}
              </div>
            )}
            {m.copy && <CopyButton text={m.copy} />}
            {m.link && <p className="small"><Link href={m.link.href}>{m.link.label} →</Link></p>}
            {m.share && <SharePanel aircraftId={m.share.aircraftId} contactId={m.share.contactId} />}
            {m.done && !m.share && (
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
              <button type="button" className={listening ? "danger" : "secondary"} onClick={toggleMic} aria-pressed={listening}>{listening ? "Stop listening" : "Speak"}</button>
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
        {listening && <p className="small muted">Listening… keep talking, pauses are fine. Press Stop listening when you are done (or tick “Send when I stop speaking”). Say something like “Operator Advanced Aviation, aircraft type G280, capacity 10”.</p>}
        {voiceMsg && <p className="small" style={{ color: "var(--warn)" }}>{voiceMsg}</p>}
        {!canListen && <p className="small muted">Voice input isn't available in this browser. Chrome or Edge work best.</p>}
        {files.length > 0 && <p className="small muted">{files.length} file(s) attached</p>}
      </div>
    </div>
  );
}
