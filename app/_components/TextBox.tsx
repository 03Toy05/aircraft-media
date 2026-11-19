"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Icon from "./Icon";
import { getRecognition, listen } from "./voice";
import { clearStyles, parseStyled, toggleMark, toggleUnderline, type Edit } from "@/domain/textStyle";

/**
 * A text box with a small toolbar: Bold, Italic, Underline, Strikethrough, Clear styles, and a microphone that types
 * what you say at the cursor. The toolbar shows while the box is in use, so a page of boxes stays tidy.
 */
export default function TextBox({ value, onChange, rows = 2, dir, placeholder, single, styles = true, ariaLabel, speechLang, name }: {
  name?: string; value: string; onChange: (v: string) => void; rows?: number; dir?: "ltr" | "rtl"; placeholder?: string;
  /** One line (an input) instead of a text area. */
  single?: boolean;
  /** Show the Bold/Italic/Underline buttons (the microphone is always there). */
  styles?: boolean;
  ariaLabel?: string; speechLang?: string;
}) {
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const [active, setActive] = useState(false);
  const [listening, setListening] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [canListen, setCanListen] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => setCanListen(!!getRecognition()), []);
  useEffect(() => () => stopRef.current?.(), []);

  const apply = (fn: (t: string, s: number, e: number) => Edit) => {
    const el = ref.current;
    if (!el) return;
    const r = fn(value, el.selectionStart ?? 0, el.selectionEnd ?? 0);
    onChange(r.text);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(r.start, r.end); });
  };

  const mic = () => {
    if (listening) { stopRef.current?.(); return; }
    const el = ref.current;
    const at = el?.selectionStart ?? value.length;
    const before = value.slice(0, at);
    const after = value.slice(el?.selectionEnd ?? at);
    const lead = before && !/\s$/.test(before) ? " " : "";
    setNote(null);
    setListening(true);
    stopRef.current = listen({
      lang: speechLang,
      silenceMs: 6000,
      onText: (t) => onChange(before + lead + t + after),
      onEnd: () => { setListening(false); stopRef.current = null; },
      onError: setNote,
    });
  };

  // Buttons keep the focus (and the phone keyboard) in the box.
  const keep = (e: React.PointerEvent | React.MouseEvent) => e.preventDefault();
  const show = active || listening;
  const common = {
    ref, dir, value, placeholder, name, "aria-label": ariaLabel,
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => onChange(e.target.value),
    onFocus: () => setActive(true),
    onBlur: (e: React.FocusEvent) => { if (!wrapRef.current?.contains(e.relatedTarget as Node)) setActive(false); },
  };
  return (
    <div className="textbox" ref={wrapRef}>
      {single ? <input {...common} /> : <textarea {...common} rows={rows} />}
      {(show || listening) && (
        <div className="fmt-bar" role="toolbar" aria-label="Text style">
          {styles && (
            <>
              <button type="button" onPointerDown={keep} onMouseDown={keep} onClick={() => apply((t, s, e) => toggleMark(t, s, e, "bold"))} title="Bold (*text*)" aria-label="Bold"><b>B</b></button>
              <button type="button" onPointerDown={keep} onMouseDown={keep} onClick={() => apply((t, s, e) => toggleMark(t, s, e, "italic"))} title="Italic (_text_)" aria-label="Italic"><i>I</i></button>
              <button type="button" onPointerDown={keep} onMouseDown={keep} onClick={() => apply(toggleUnderline)} title="Underline" aria-label="Underline"><u>U</u></button>
              <button type="button" onPointerDown={keep} onMouseDown={keep} onClick={() => apply((t, s, e) => toggleMark(t, s, e, "strike"))} title="Strikethrough (~text~)" aria-label="Strikethrough"><s>S</s></button>
              <button type="button" onPointerDown={keep} onMouseDown={keep} onClick={() => apply(clearStyles)} title="Remove styles from the selection (or the whole box)" aria-label="Remove styles">Tx</button>
            </>
          )}
          {canListen && (
            <button type="button" className={listening ? "on" : undefined} onPointerDown={keep} onMouseDown={keep} onClick={mic} aria-pressed={listening} aria-label={listening ? "Stop dictating" : "Dictate"} title={listening ? "Stop" : "Speak to type here"}>
              <Icon name="mic" size={16} />{listening ? "Stop" : ""}
            </button>
          )}
          {styles && <span className="fmt-hint small muted">Select words, then tap a style. Tap again to remove it.</span>}
        </div>
      )}
      {note && <p className="small" style={{ color: "var(--warn)", margin: "4px 0 0" }}>{note}</p>}
    </div>
  );
}

/** Text as WhatsApp shows it: *bold*, _italic_, ~strike~ and underline drawn, the markers hidden. */
export function Styled({ text }: { text: string }) {
  return (
    <>
      {parseStyled(text).map((s, i) => {
        let n: ReactNode = s.text;
        if (s.bold) n = <b>{n}</b>;
        if (s.italic) n = <i>{n}</i>;
        if (s.strike) n = <s>{n}</s>;
        if (s.underline) n = <u>{n}</u>;
        return <span key={i}>{n}</span>;
      })}
    </>
  );
}
