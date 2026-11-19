"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { getRecognition, listen, pageCommands, type CommandResult } from "./voice";

/**
 * The "Ask Chocks" microphone on every page. Say what you want done. The page you are on carries it out when it can
 * (on the Quote page: "add the Jet Aviation G650ER, Chinese, price 85,000"); anything else goes to Chocks.
 */
export default function VoiceCommand() {
  const path = usePathname() ?? "/";
  const router = useRouter();
  const [can, setCan] = useState(false);
  const [state, setState] = useState<"idle" | "listening" | "done">("idle");
  const [heard, setHeard] = useState("");
  const [result, setResult] = useState<CommandResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => setCan(!!getRecognition()), []);
  useEffect(() => { stop.current?.(); setState("idle"); }, [path]);

  if (!can || path === "/") return null; // Chocks's own page has its microphone in the message box

  const run = (text: string) => {
    if (!text) { setState("idle"); return; }
    const r = pageCommands()?.(text) ?? null;
    if (r && !r.passOn) { setResult(r); setState("done"); return; }
    setState("idle");
    router.push(`/?ask=${encodeURIComponent(r?.passOn ?? text)}`);
  };

  const start = () => {
    if (state === "listening") { stop.current?.(); return; }
    setHeard(""); setResult(null); setErr(null);
    setState("listening");
    stop.current = listen({ silenceMs: 2500, onText: setHeard, onEnd: (t) => { stop.current = null; run(t); }, onError: setErr });
  };

  return (
    <>
      {state !== "idle" && (
        <div className="voice-bubble card" role="status">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <b className="small">{state === "listening" ? "Listening…" : "Chocks"}</b>
            <button type="button" className="secondary" style={{ minHeight: 0, padding: "0 8px" }} onClick={() => { stop.current?.(); setState("idle"); }} aria-label="Close">✕</button>
          </div>
          <p className="small" style={{ margin: "4px 0" }}>{heard || (state === "listening" ? "Say what to do, e.g. “add the G280, Chinese, price 40,000”." : "")}</p>
          {result?.said.map((s, i) => <p key={i} className="small muted" style={{ margin: "2px 0" }}>{s}</p>)}
          {result?.followUp && <button type="button" onClick={() => { result.followUp!.run(); setState("idle"); }}>{result.followUp.label}</button>}
          {err && <p className="small" style={{ color: "var(--warn)" }}>{err}</p>}
        </div>
      )}
      <button type="button" className={`voice-fab${state === "listening" ? " on" : ""}`} onClick={start} aria-label={state === "listening" ? "Stop listening" : "Ask Chocks by voice"} title="Ask Chocks by voice">
        <Icon name="mic" size={24} />
      </button>
    </>
  );
}
